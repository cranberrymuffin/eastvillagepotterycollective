// Shared by the members page and the My account page.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

// Arrived from an invite email (an account the studio created). Read before
// the Supabase client clears the link details from the URL.
export const arrivedFromInvite = /[#&?]type=invite\b/.test(window.location.href);

export const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

export const emailRedirectTo = `${window.location.origin}/members/`;

// Lets <site-nav> switch between "Login" and "My account".
export const announceAuthChange = () =>
  window.dispatchEvent(new Event("member-auth-change"));

// Shown in place of the page when /members/config.js is empty.
export const showNotConfigured = () => {
  const status = document.querySelector("#page-status");
  status.textContent = "Member login isn't set up yet. Please check back soon.";
  status.hidden = false;
};

// <site-nav> shows studio admins their admin links. Only changes which
// links are shown; the database decides what an admin can do.
const ADMIN_KEY = "evpc-studio-admin";

export const isRememberedAdmin = () => {
  try {
    return localStorage.getItem(ADMIN_KEY) === "1";
  } catch {
    return false;
  }
};

const rememberAdmin = (isAdmin) => {
  try {
    if (isAdmin === isRememberedAdmin()) return;
    if (isAdmin) localStorage.setItem(ADMIN_KEY, "1");
    else localStorage.removeItem(ADMIN_KEY);
    announceAuthChange();
  } catch {
    // Storage blocked: the nav just shows member links.
  }
};

export const forgetAdmin = () => rememberAdmin(false);

// Loads the signed-in member's profile row (name, tier, payment details…).
export const loadProfile = async (userId) => {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) console.error(error);
  if (data) rememberAdmin(Boolean(data.is_admin));
  return data;
};

// The auth server no longer recognises this browser's login (e.g. it was
// signed out elsewhere or the account was changed in the dashboard). The
// stored token still looks valid locally, so detect it from the error.
const DEAD_SESSION_CODES = [
  "session_not_found",
  "refresh_token_not_found",
  "user_not_found",
  "bad_jwt",
];

export const isSessionGone = (error) => DEAD_SESSION_CODES.includes(error?.code);

// Clears the dead login from this browser and returns to the login form.
export const endStaleSession = async () => {
  await supabase.auth.signOut({ scope: "local" });
  forgetAdmin();
  window.location.assign("/members/?expired");
};

// Checks the stored login with the auth server; ends it if it's gone.
export const verifySession = async () => {
  const { error } = await supabase.auth.getUser();
  if (isSessionGone(error)) {
    await endStaleSession();
    return false;
  }
  return true;
};

export const setStatus = (form, message, isError = false) => {
  const status = form.querySelector(".form-status");
  status.textContent = message;
  status.classList.toggle("is-error", isError);
};

// Runs a Supabase call with the form's buttons disabled.
export const withForm = async (form, pendingMessage, action) => {
  const buttons = form.querySelectorAll("button");
  buttons.forEach((button) => (button.disabled = true));
  setStatus(form, pendingMessage);
  try {
    await action();
  } finally {
    buttons.forEach((button) => (button.disabled = false));
  }
};

// Supabase's email sender is rate limited (one email per address per minute,
// and a few per hour overall on the built-in mailer).
export const authErrorMessage = (error) => {
  if (error.status === 429 || error.code?.startsWith("over_")) {
    return "Too many emails were requested. Please wait a minute and try again, and check your inbox for one we already sent.";
  }
  if (error.code === "weak_password") {
    return "Please choose a stronger password.";
  }
  return "Something went wrong. Please try again.";
};

// For pages only members can see: calls onMember(user) once the login is
// confirmed, and sends anyone else to the login form.
export const requireMember = (onMember) => {
  let started = false;
  supabase.auth.onAuthStateChange((_event, session) => {
    // Defer so Supabase calls made in response don't deadlock the auth lock.
    setTimeout(async () => {
      announceAuthChange();
      if (!session) {
        window.location.replace("/members/");
        return;
      }
      if (started) return;
      started = true;
      if (await verifySession()) onMember(session.user);
    });
  });
};

// Other members' names (not emails or payment details), keyed by id.
export const loadMemberNames = async (ids) => {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const { data, error } = await supabase
    .from("member_names")
    .select("id, full_name, pronouns, is_admin")
    .in("id", unique);
  if (error) console.error(error);
  return new Map((data ?? []).map((member) => [member.id, member]));
};

export const memberName = (member) => member?.full_name || "A member";

export const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

// "Sep 27, 3:04 PM", with the year only when it isn't this year.
export const formatWhen = (iso) => {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== new Date().getFullYear() && { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
};

// A member's name with their pronouns and a "Studio" tag for admins.
export const renderByline = (member) => {
  const byline = el("span", "byline");
  byline.append(el("strong", null, memberName(member)));
  if (member?.pronouns) byline.append(el("span", "byline-pronouns", member.pronouns));
  if (member?.is_admin) byline.append(el("span", "byline-tag", "Studio"));
  return byline;
};

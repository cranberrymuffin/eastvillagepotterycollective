// Shared by the members page and the My account page.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

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

// Loads the signed-in member's profile row (name, tier, payment details…).
export const loadProfile = async (userId) => {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) console.error(error);
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

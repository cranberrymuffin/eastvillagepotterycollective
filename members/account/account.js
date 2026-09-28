import {
  supabase,
  emailRedirectTo,
  announceAuthChange,
  showNotConfigured,
  loadProfile,
  setStatus,
  withForm,
  authErrorMessage,
  isSessionGone,
  endStaleSession,
  verifySession,
} from "../shared.js?v=2";
import { TIERS, formatPlainDate } from "../studio.js?v=3";
import "../components/tier-picker.js";
import "../components/payment-fields.js";

const accountView = document.querySelector("#account-view");
const profileForm = document.querySelector("#profile-form");
const tierForm = document.querySelector("#tier-form");
const tierPicker = tierForm.querySelector("tier-picker");
const paymentForm = document.querySelector("#payment-form");
const paymentFields = paymentForm.querySelector("payment-fields");
const emailForm = document.querySelector("#email-form");
const passwordForm = document.querySelector("#password-form");

if (!supabase) {
  showNotConfigured();
  throw new Error("Supabase is not configured in /members/config.js");
}

let user = null;
let profile = null;

// Filling in the page ------------------------------------------------------

const showProfile = () => {
  profileForm.full_name.value = profile.full_name ?? "";
  profileForm.pronouns.value = profile.pronouns ?? "";
  profileForm.bio.value = profile.bio ?? "";
  tierPicker.value = profile.tier;
  paymentFields.setSaved(profile.payment_method, profile.payment_handle);
  showPaymentStatus();
};

// Which tier the member had when, newest first (from membership_periods).
const loadTierHistory = async () => {
  const { data: periods, error } = await supabase
    .from("membership_periods")
    .select("tier, starts_on, ends_on")
    .order("starts_on", { ascending: false });
  if (error) console.error(error);

  const history = document.querySelector("#tier-history");
  history.hidden = !periods?.length;
  document.querySelector("#tier-history-list").replaceChildren(
    ...(periods ?? []).map((period) => {
      const item = document.createElement("li");
      const name = document.createElement("strong");
      name.textContent = TIERS[period.tier]?.name ?? period.tier;
      const from = formatPlainDate(period.starts_on, "short");
      item.append(
        name,
        period.ends_on
          ? ` · ${from} – ${formatPlainDate(period.ends_on, "short")}`
          : ` · since ${from}`,
      );
      return item;
    }),
  );
};

const showPaymentStatus = () => {
  const status = document.querySelector("#payment-status");
  status.hidden = !profile.payment_handle;
  status.classList.toggle("is-verified", Boolean(profile.payment_verified));
  status.textContent = profile.payment_verified
    ? "✓ Verified by the studio"
    : "Not verified yet. The studio will verify it when your first payment arrives.";
};

const start = async (sessionUser) => {
  if (!(await verifySession())) return;
  user = sessionUser;
  emailForm.email.value = user.email;
  profile = (await loadProfile(user.id)) ?? { id: user.id };
  accountView.hidden = false;
  showProfile();
  loadTierHistory();

  // Arrived from a "reset your password" email.
  if (window.location.hash === "#password") {
    setStatus(passwordForm, "Choose a new password.");
    passwordForm.password.focus();
  }
};

supabase.auth.onAuthStateChange((_event, session) => {
  // Defer so Supabase calls made in response don't deadlock the auth lock.
  setTimeout(() => {
    announceAuthChange();
    if (!session) {
      window.location.replace("/members/");
    } else if (user?.id !== session.user.id) {
      start(session.user);
    } else {
      user = session.user;
    }
  });
});

// Saving -------------------------------------------------------------------

// Updates the member's profile row and refreshes the page from the result.
const saveProfile = async (form, changes, successMessage) => {
  const { data, error } = await supabase
    .from("profiles")
    .update(changes)
    .eq("id", user.id)
    .select()
    .single();

  if (error) {
    console.error(error);
    setStatus(form, "Couldn't save. Please try again.", true);
    return;
  }
  profile = data;
  showProfile();
  setStatus(form, successMessage);
  // Tier changes are recorded in the tier history.
  if ("tier" in changes) loadTierHistory();
};

profileForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(profileForm);
  withForm(profileForm, "Saving…", () =>
    saveProfile(
      profileForm,
      {
        full_name: data.get("full_name").trim(),
        pronouns: data.get("pronouns").trim() || null,
        bio: data.get("bio").trim() || null,
      },
      "Profile saved.",
    ),
  );
});

tierForm.addEventListener("submit", (event) => {
  event.preventDefault();
  withForm(tierForm, "Saving…", () =>
    saveProfile(tierForm, { tier: tierPicker.value }, "Membership tier saved."),
  );
});

paymentForm.addEventListener("submit", (event) => {
  event.preventDefault();
  withForm(paymentForm, "Saving…", () =>
    saveProfile(
      paymentForm,
      {
        payment_method: paymentFields.method,
        payment_handle: paymentFields.handle,
      },
      "Payment details saved.",
    ),
  );
});

emailForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const email = emailForm.email.value.trim();
  if (email === user.email) {
    setStatus(emailForm, "That's already your email.");
    return;
  }

  withForm(emailForm, "Saving…", async () => {
    const { data, error } = await supabase.auth.updateUser(
      { email },
      { emailRedirectTo },
    );
    if (isSessionGone(error)) {
      await endStaleSession();
    } else if (error) {
      console.error(error);
      setStatus(
        emailForm,
        error.code === "email_exists"
          ? "Another account already uses that email."
          : authErrorMessage(error),
        true,
      );
    } else if (data.user.email === email) {
      setStatus(emailForm, "Email updated.");
    } else {
      // Supabase emails a confirmation link first (to both addresses when
      // "secure email change" is on); the change applies once it's clicked.
      setStatus(
        emailForm,
        `We've sent a confirmation link to ${email}. Your email changes once you click it (you may also get a link at your current address).`,
      );
    }
  });
});

passwordForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(passwordForm);
  if (data.get("password") !== data.get("confirm")) {
    setStatus(passwordForm, "Passwords don't match.", true);
    return;
  }

  withForm(passwordForm, "Saving…", async () => {
    const { error } = await supabase.auth.updateUser({
      password: data.get("password"),
    });
    if (isSessionGone(error)) {
      await endStaleSession();
    } else if (error) {
      console.error(error);
      setStatus(
        passwordForm,
        error.code === "same_password"
          ? "That's already your password. Choose a different one."
          : authErrorMessage(error),
        true,
      );
    } else {
      passwordForm.reset();
      setStatus(passwordForm, "Password saved.");
    }
  });
});

import {
  supabase,
  emailRedirectTo,
  announceAuthChange,
  showNotConfigured,
  loadProfile,
  setStatus,
  withForm,
  authErrorMessage,
  verifySession,
  arrivedFromInvite,
  forgetAdmin,
} from "./shared.js?v=3";
import "./components/member-feed.js?v=2";
import "./components/event-calendar.js?v=3";

const loginView = document.querySelector("#login-view");
const signupView = document.querySelector("#signup-view");
const appView = document.querySelector("#app-view");
const loginForm = document.querySelector("#login-form");
const signupForm = document.querySelector("#signup-form");
const resendButton = document.querySelector("#resend-confirmation");

if (!supabase) {
  showNotConfigured();
  throw new Error("Supabase is not configured in /members/config.js");
}

let currentUser = null;

// Auth ---------------------------------------------------------------------

// Sent back here after a login that had ended elsewhere.
if (new URLSearchParams(window.location.search).has("expired")) {
  setStatus(loginForm, "Your session expired. Please log in again.");
  history.replaceState(null, "", window.location.pathname);
}

let authView = "login";

const showAuthView = (view) => {
  authView = view;
  loginView.hidden = view !== "login";
  signupView.hidden = view !== "signup";
};

document.querySelectorAll("[data-auth-view]").forEach((button) => {
  button.addEventListener("click", () => {
    showAuthView(button.dataset.authView);
    (authView === "login" ? loginForm : signupForm).querySelector("input").focus();
  });
});

const showSignedOut = () => {
  currentUser = null;
  forgetAdmin();
  appView.hidden = true;
  showAuthView(authView);
};

const showSignedIn = async (user) => {
  if (currentUser?.id === user.id) return;
  currentUser = user;
  if (!(await verifySession())) return;
  loginView.hidden = true;
  signupView.hidden = true;
  appView.hidden = false;

  // The home page: shared calendar and posts.
  const profile = (await loadProfile(user.id)) ?? { id: user.id };
  const member = { user, isAdmin: Boolean(profile.is_admin) };
  document.querySelector("event-calendar").start(member);
  document.querySelector("member-feed").start(member);
};

supabase.auth.onAuthStateChange((event, session) => {
  // Defer so Supabase calls made in response don't deadlock the auth lock.
  setTimeout(() => {
    announceAuthChange();
    // Arrived from a "reset your password" email: set it on My account.
    if (event === "PASSWORD_RECOVERY") {
      window.location.assign("/members/account/#password");
      return;
    }
    // Invited by the studio: choose a password first.
    if (session && arrivedFromInvite) {
      window.location.assign("/members/account/#password");
      return;
    }
    if (session) showSignedIn(session.user);
    else showSignedOut();
  });
});

const loginEmail = () => {
  const input = loginForm.email;
  return input.reportValidity() ? input.value.trim() : null;
};

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  resendButton.hidden = true;
  const data = new FormData(loginForm);

  withForm(loginForm, "Logging in…", async () => {
    const { error } = await supabase.auth.signInWithPassword({
      email: data.get("email").trim(),
      password: data.get("password"),
    });
    if (!error) return setStatus(loginForm, "");

    console.error(error);
    if (error.code === "email_not_confirmed") {
      resendButton.hidden = false;
      setStatus(
        loginForm,
        "Please confirm your email first. Check your inbox for the confirmation link.",
        true,
      );
    } else if (error.code === "invalid_credentials") {
      setStatus(
        loginForm,
        "Incorrect email or password. If you haven't set a password yet, choose \"Forgot password?\".",
        true,
      );
    } else {
      setStatus(loginForm, authErrorMessage(error), true);
    }
  });
});

resendButton.addEventListener("click", () => {
  const email = loginEmail();
  if (!email) return;
  withForm(loginForm, "Sending…", async () => {
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo },
    });
    if (error) {
      console.error(error);
      setStatus(loginForm, authErrorMessage(error), true);
    } else {
      resendButton.hidden = true;
      setStatus(loginForm, "Confirmation email sent. Check your inbox.");
    }
  });
});

document.querySelector("#forgot-password").addEventListener("click", () => {
  const email = loginEmail();
  if (!email) return;
  withForm(loginForm, "Sending…", async () => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: emailRedirectTo,
    });
    if (error) {
      console.error(error);
      setStatus(loginForm, authErrorMessage(error), true);
    } else {
      setStatus(
        loginForm,
        "If there's an account for that email, we've sent a link to set a new password.",
      );
    }
  });
});

// Only emails the studio registered on the Members page can sign up; the
// database refuses the rest (require_registration), which Supabase reports
// as a generic server error.
signupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(signupForm);

  withForm(signupForm, "Creating your account…", async () => {
    const { data: result, error } = await supabase.auth.signUp({
      email: data.get("email").trim(),
      password: data.get("password"),
      options: { emailRedirectTo },
    });

    if (error) {
      console.error(error);
      let message = authErrorMessage(error);
      if (error.code === "user_already_exists") {
        message = "You already have an account. Log in instead.";
      } else if (error.status === 500 || error.code === "unexpected_failure") {
        message =
          "That email hasn't been registered by the studio. Check it's the email you gave the studio, or ask them to add you.";
      }
      setStatus(signupForm, message, true);
    } else if (result.user?.identities?.length === 0) {
      // Supabase hides whether an email is registered by returning a user
      // with no identities instead of an error.
      setStatus(signupForm, "You already have an account. Log in instead.", true);
    } else {
      signupForm.reset();
      // With email confirmation off, signUp logs the member straight in and
      // onAuthStateChange shows the home page.
      setStatus(
        signupForm,
        result.session
          ? "Account created."
          : "Almost done! Check your email and click the link to confirm your account.",
      );
    }
  });
});

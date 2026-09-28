import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const BUCKET = "piece-photos";
const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const FIRING_RATE_PER_CUBIC_INCH = 0.06;

const pageStatus = document.querySelector("#page-status");
const loginView = document.querySelector("#login-view");
const signupView = document.querySelector("#signup-view");
const appView = document.querySelector("#app-view");
const loginForm = document.querySelector("#login-form");
const signupForm = document.querySelector("#signup-form");
const pieceForm = document.querySelector("#piece-form");
const pieceList = document.querySelector("#piece-list");
const piecesEmpty = document.querySelector("#pieces-empty");
const volumeEstimate = document.querySelector("#volume-estimate");

const setStatus = (form, message, isError = false) => {
  const status = form.querySelector(".form-status");
  status.textContent = message;
  status.classList.toggle("is-error", isError);
};

const cubicInches = (length, width, height) => length * width * height;

const formatVolume = (volume) =>
  `${volume.toLocaleString(undefined, { maximumFractionDigits: 1 })} in³ · est. $${(
    volume * FIRING_RATE_PER_CUBIC_INCH
  ).toFixed(2)} to fire`;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  pageStatus.textContent =
    "Member login isn't set up yet. Please check back soon.";
  pageStatus.hidden = false;
  throw new Error("Supabase is not configured in /members/config.js");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let currentUser = null;

// Auth ---------------------------------------------------------------------

const emailRedirectTo = `${window.location.origin}/members/`;
const passwordView = document.querySelector("#password-view");
const passwordForm = document.querySelector("#password-form");
const resendButton = document.querySelector("#resend-confirmation");

// Supabase's email sender is rate limited (one email per address per minute,
// and a few per hour overall on the built-in mailer).
const isRateLimited = (error) =>
  error.status === 429 || error.code?.startsWith("over_");

const authErrorMessage = (error) => {
  if (isRateLimited(error)) {
    return "Too many emails were requested. Please wait a minute and try again, and check your inbox for one we already sent.";
  }
  if (error.code === "weak_password") {
    return "Please choose a stronger password.";
  }
  return "Something went wrong. Please try again.";
};

// Runs a Supabase call with the form's buttons disabled and reports errors.
const withForm = async (form, pendingMessage, action) => {
  const buttons = form.querySelectorAll("button");
  buttons.forEach((button) => (button.disabled = true));
  setStatus(form, pendingMessage);
  try {
    await action();
  } finally {
    buttons.forEach((button) => (button.disabled = false));
  }
};

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
  appView.hidden = true;
  passwordView.hidden = true;
  showAuthView(authView);
  pieceList.replaceChildren();
};

const showSignedIn = (user) => {
  if (currentUser?.id === user.id) return;
  currentUser = user;
  document.querySelector("#member-name").textContent =
    user.user_metadata?.full_name || user.email;
  loginView.hidden = true;
  signupView.hidden = true;
  appView.hidden = false;
  loadPieces();
};

const showPasswordForm = () => {
  passwordForm.reset();
  setStatus(passwordForm, "");
  passwordView.hidden = false;
  passwordForm.password.focus();
};

supabase.auth.onAuthStateChange((event, session) => {
  // Defer so Supabase calls made in response don't deadlock the auth lock.
  setTimeout(() => {
    if (!session) return showSignedOut();
    showSignedIn(session.user);
    // Arrived from a "reset your password" email.
    if (event === "PASSWORD_RECOVERY") showPasswordForm();
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

const PAYMENT_HANDLE_LABELS = {
  venmo: ["Venmo username", "@username"],
  zelle: ["Zelle email or phone number", "you@example.com or 212-555-0123"],
};

signupForm.addEventListener("change", (event) => {
  if (event.target.name !== "payment_method") return;
  const [label, placeholder] = PAYMENT_HANDLE_LABELS[event.target.value];
  document.querySelector("#payment-handle-label").textContent = label;
  signupForm.payment_handle.placeholder = placeholder;
});

signupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(signupForm);

  withForm(signupForm, "Creating your account…", async () => {
    const { data: result, error } = await supabase.auth.signUp({
      email: data.get("email").trim(),
      password: data.get("password"),
      options: {
        // Copied into public.profiles by the on_auth_user_created trigger.
        data: {
          full_name: data.get("name").trim(),
          tier: data.get("tier"),
          payment_method: data.get("payment_method"),
          payment_handle: data.get("payment_handle").trim(),
        },
        emailRedirectTo,
      },
    });

    if (error) {
      console.error(error);
      setStatus(
        signupForm,
        error.code === "user_already_exists"
          ? "An account with that email already exists. Log in instead."
          : authErrorMessage(error),
        true,
      );
    } else if (result.user?.identities?.length === 0) {
      // Supabase hides whether an email is registered by returning a user
      // with no identities instead of an error.
      setStatus(
        signupForm,
        "An account with that email already exists. Log in instead.",
        true,
      );
    } else {
      signupForm.reset();
      document.querySelector("#payment-handle-label").textContent =
        "Venmo username or Zelle email/phone";
      signupForm.payment_handle.placeholder = "";
      // With email confirmation off, signUp signs the member straight in and
      // onAuthStateChange shows the members area. If confirmation is ever
      // turned back on in Supabase, there's no session until they confirm.
      setStatus(
        signupForm,
        result.session
          ? "Account created."
          : "Almost done! Check your email and click the link to confirm your account.",
      );
    }
  });
});

document
  .querySelector("#show-password-form")
  .addEventListener("click", showPasswordForm);

document.querySelector("#cancel-password").addEventListener("click", () => {
  passwordView.hidden = true;
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
    if (error) {
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
      setStatus(passwordForm, "Password saved. You can use it to log in next time.");
    }
  });
});

document.querySelector("#sign-out").addEventListener("click", () => {
  supabase.auth.signOut();
});

// Submitting a piece -------------------------------------------------------

// Read fields via FormData: form.title and form.length are built-in properties.
const dimensions = (data) =>
  ["length", "width", "height"].map((name) => Number(data.get(name)));

pieceForm.addEventListener("input", () => {
  const [length, width, height] = dimensions(new FormData(pieceForm));
  volumeEstimate.textContent =
    length && width && height
      ? formatVolume(cubicInches(length, width, height))
      : "";
});

pieceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(pieceForm);
  // The photo field is removed from the form for now, so this is empty.
  // Re-adding <input type="file" name="photos"> turns uploads back on.
  const photos = data.getAll("photos").filter((photo) => photo.size > 0);

  if (photos.length > MAX_PHOTOS) {
    setStatus(pieceForm, `Please attach at most ${MAX_PHOTOS} photos.`, true);
    return;
  }
  if (photos.some((photo) => photo.size > MAX_PHOTO_BYTES)) {
    setStatus(pieceForm, "Each photo must be under 10 MB.", true);
    return;
  }

  const button = pieceForm.querySelector("button");
  button.disabled = true;
  setStatus(pieceForm, "Saving…");

  const pieceId = crypto.randomUUID();
  const photoPaths = [];

  try {
    for (const [index, photo] of photos.entries()) {
      const extension = photo.name.split(".").pop().toLowerCase();
      const path = `${currentUser.id}/${pieceId}/${index}.${extension}`;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, photo, { contentType: photo.type });
      if (error) throw error;
      photoPaths.push(path);
    }

    const [length, width, height] = dimensions(data);
    const { error } = await supabase.from("pieces").insert({
      id: pieceId,
      title: data.get("title").trim(),
      description: data.get("description").trim() || null,
      length_in: length,
      width_in: width,
      height_in: height,
      photo_paths: photoPaths,
    });
    if (error) throw error;

    pieceForm.reset();
    volumeEstimate.textContent = "";
    setStatus(
      pieceForm,
      `Piece submitted ${new Date().toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })}.`,
    );
    loadPieces();
  } catch (error) {
    console.error(error);
    if (photoPaths.length) {
      await supabase.storage.from(BUCKET).remove(photoPaths);
    }
    setStatus(pieceForm, "Something went wrong saving your piece. Please try again.", true);
  } finally {
    button.disabled = false;
  }
});

// Listing pieces -----------------------------------------------------------

const STATUS_LABELS = {
  submitted: "Waiting for bisque",
  bisque_fired: "Bisque fired",
};

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

const renderPiece = (piece, photoUrls) => {
  const item = el("li", "piece");

  if (photoUrls.length) {
    const gallery = el("div", "piece-photos");
    photoUrls.forEach((url) => {
      const img = el("img");
      img.src = url;
      img.alt = piece.title;
      img.loading = "lazy";
      gallery.append(img);
    });
    item.append(gallery);
  }

  const body = el("div", "piece-body");
  const heading = el("div", "piece-heading");
  heading.append(
    el("h3", null, piece.title),
    el("span", `piece-status status-${piece.status}`, STATUS_LABELS[piece.status]),
  );
  body.append(heading);

  const submitted = new Date(piece.submitted_at);
  const date = el("p", "piece-date", "Submitted ");
  const time = el(
    "time",
    null,
    submitted.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
  );
  time.dateTime = piece.submitted_at;
  date.append(time);
  body.append(date);

  const length = Number(piece.length_in);
  const width = Number(piece.width_in);
  const height = Number(piece.height_in);
  body.append(
    el(
      "p",
      "piece-meta",
      `${length} × ${width} × ${height} in · ${formatVolume(
        cubicInches(length, width, height),
      )}`,
    ),
  );
  if (piece.description) body.append(el("p", "piece-description", piece.description));

  if (piece.status === "submitted") {
    const remove = el("button", "button button-quiet", "Remove");
    remove.type = "button";
    remove.addEventListener("click", () => deletePiece(piece));
    body.append(remove);
  }

  item.append(body);
  return item;
};

async function loadPieces() {
  const { data: pieces, error } = await supabase
    .from("pieces")
    .select("*")
    .order("submitted_at", { ascending: false });

  if (error) {
    console.error(error);
    piecesEmpty.textContent = "Couldn't load your pieces. Please refresh.";
    piecesEmpty.hidden = false;
    return;
  }

  const allPaths = pieces.flatMap((piece) => piece.photo_paths);
  const signedUrls = new Map();
  if (allPaths.length) {
    const { data } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(allPaths, 60 * 60);
    data?.forEach(({ path, signedUrl }) => signedUrl && signedUrls.set(path, signedUrl));
  }

  piecesEmpty.textContent = "You haven't logged any pieces yet.";
  piecesEmpty.hidden = pieces.length > 0;
  pieceList.replaceChildren(
    ...pieces.map((piece) =>
      renderPiece(
        piece,
        piece.photo_paths.map((path) => signedUrls.get(path)).filter(Boolean),
      ),
    ),
  );
}

async function deletePiece(piece) {
  if (!window.confirm(`Remove "${piece.title}"?`)) return;

  const { error } = await supabase.from("pieces").delete().eq("id", piece.id);
  if (error) {
    console.error(error);
    window.alert("Couldn't remove that piece. Please try again.");
    return;
  }
  if (piece.photo_paths.length) {
    await supabase.storage.from(BUCKET).remove(piece.photo_paths);
  }
  loadPieces();
}

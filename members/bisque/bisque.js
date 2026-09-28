import {
  supabase,
  showNotConfigured,
  requireMember,
  loadProfile,
  setStatus,
  withForm,
  el,
} from "../shared.js?v=3";
import { formatVolume, formatPieceNumber, PIECE_STATUSES } from "../studio.js?v=4";
import "../components/piece-fields.js";

const BUCKET = "piece-photos";
const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

const pieceForm = document.querySelector("#piece-form");
const pieceFields = pieceForm.querySelector("piece-fields");
const pieceList = document.querySelector("#piece-list");
const piecesEmpty = document.querySelector("#pieces-empty");

if (!supabase) {
  showNotConfigured();
  throw new Error("Supabase is not configured in /members/config.js");
}

let currentUser = null;

requireMember(async (user) => {
  // The studio account has no bisque log; it sees members' pieces on Invoices.
  if ((await loadProfile(user.id))?.is_admin) {
    window.location.replace("/members/invoices/");
    return;
  }
  currentUser = user;
  document.querySelector("#bisque-view").hidden = false;
  loadPieces();
});

// Submitting a piece -------------------------------------------------------

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

    const { error } = await supabase.from("pieces").insert({
      id: pieceId,
      ...pieceFields.value,
      photo_paths: photoPaths,
    });
    if (error) throw error;

    pieceForm.reset();
    pieceFields.reset();
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
  const title = el("div", "piece-title");
  if (piece.piece_number != null) {
    const number = el("span", "piece-number", formatPieceNumber(piece.piece_number));
    number.title = "Piece number: write this on your shelf tag";
    title.append(number);
  }
  title.append(el("h3", null, piece.title));
  heading.append(
    title,
    el("span", `piece-status status-${piece.status}`, PIECE_STATUSES[piece.status] ?? piece.status),
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
      `${length} × ${width} × ${height} in · ${formatVolume(length, width, height)}`,
    ),
  );
  if (piece.description) body.append(el("p", "piece-description", piece.description));

  // Members can change or remove a piece until it's been fired.
  if (piece.status === "submitted") {
    const actions = el("div", "piece-actions");
    const edit = el("button", "button button-quiet", "Edit");
    edit.type = "button";
    edit.addEventListener("click", () => {
      item.replaceChildren(renderEditForm(piece));
      // <piece-fields> renders once it's in the page, so fill it after.
      const fields = item.querySelector("piece-fields");
      fields.value = piece;
      fields.focus();
    });
    const remove = el("button", "button button-quiet", "Remove");
    remove.type = "button";
    remove.addEventListener("click", () => deletePiece(piece));
    actions.append(edit, remove);
    body.append(actions);
  }

  item.append(body);
  return item;
};

const renderEditForm = (piece) => {
  const form = el("form", "member-form piece-edit");
  const heading = el("h3", null, "Edit ");
  if (piece.piece_number != null) {
    heading.append(el("span", "piece-number", formatPieceNumber(piece.piece_number)));
  }
  const fields = el("piece-fields");
  const actions = el("div", "piece-actions");
  const save = el("button", "button", "Save changes");
  save.type = "submit";
  const cancel = el("button", "button button-quiet", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => loadPieces());
  actions.append(save, cancel);
  const status = el("p", "form-status");
  status.setAttribute("role", "status");

  form.append(heading, fields, actions, status);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    withForm(form, "Saving…", async () => {
      const { error } = await supabase
        .from("pieces")
        .update(fields.value)
        .eq("id", piece.id)
        .select()
        .single();
      if (error) {
        console.error(error);
        setStatus(form, "Couldn't save your changes. Please try again.", true);
      } else {
        loadPieces();
      }
    });
  });

  return form;
};

async function loadPieces() {
  // Filter to this member: admins can read everyone's pieces.
  const { data: pieces, error } = await supabase
    .from("pieces")
    .select("*")
    .eq("user_id", currentUser.id)
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

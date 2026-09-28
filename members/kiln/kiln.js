// Kiln page (studio admins only): every member's pieces grouped by where
// they are in the bisque firing, with buttons to move them along (or back,
// to fix a mistake). The database only lets admins change a piece's status.
import {
  supabase,
  showNotConfigured,
  requireMember,
  loadProfile,
  loadMemberNames,
  memberName,
  el,
} from "../shared.js?v=3";
import { formatVolume, formatPieceNumber, PIECE_STATUSES } from "../studio.js?v=4";

const view = document.querySelector("#kiln-view");

if (!supabase) {
  showNotConfigured();
  throw new Error("Supabase is not configured in /members/config.js");
}

// Each stage, with its move-forward and move-back actions.
const STAGES = [
  {
    status: "submitted",
    empty: "Nothing on the bisque shelf.",
    forward: { to: "in_kiln", label: "Load into kiln", all: "Load all into kiln" },
  },
  {
    status: "in_kiln",
    empty: "The kiln is empty.",
    forward: { to: "ready_for_pickup", label: "Ready for pickup", all: "Mark all ready for pickup" },
    back: { to: "submitted", label: "Back to shelf" },
  },
  {
    status: "ready_for_pickup",
    empty: "Nothing waiting for pickup.",
    back: { to: "in_kiln", label: "Back to kiln" },
  },
];

const setPieceStatus = async (ids, status) => {
  const { error } = await supabase.from("pieces").update({ status }).in("id", ids);
  if (error) {
    console.error(error);
    window.alert("Couldn't move those pieces. Please try again.");
  }
  await load();
};

const actionButton = (label, quiet, onClick) => {
  const button = el("button", quiet ? "button button-quiet" : "button", label);
  button.type = "button";
  button.addEventListener("click", async () => {
    button.disabled = true;
    await onClick();
  });
  return button;
};

const renderPiece = (piece, stage, names) => {
  const item = el("li", "kiln-piece");

  const title = el("div", "piece-title");
  title.append(
    el("span", "piece-number", formatPieceNumber(piece.piece_number)),
    el("strong", null, piece.title),
  );

  const length = Number(piece.length_in);
  const width = Number(piece.width_in);
  const height = Number(piece.height_in);
  const meta = el(
    "p",
    "piece-meta",
    `${memberName(names.get(piece.user_id))} · ${length} × ${width} × ${height} in · ${formatVolume(
      length,
      width,
      height,
    )}`,
  );

  const actions = el("div", "piece-actions");
  if (stage.forward) {
    actions.append(
      actionButton(stage.forward.label, false, () => setPieceStatus([piece.id], stage.forward.to)),
    );
  }
  if (stage.back) {
    actions.append(
      actionButton(stage.back.label, true, () => setPieceStatus([piece.id], stage.back.to)),
    );
  }

  item.append(title, meta, actions);
  return item;
};

async function load() {
  const { data: pieces, error } = await supabase
    .from("pieces")
    .select("id, piece_number, user_id, title, length_in, width_in, height_in, status")
    .order("piece_number");

  if (error) {
    console.error(error);
    view.replaceChildren(
      el("p", "agreement-section field-note", "Couldn't load pieces. Please refresh."),
    );
    return;
  }

  const names = await loadMemberNames(pieces.map((piece) => piece.user_id));

  view.replaceChildren(
    ...STAGES.map((stage) => {
      const stagePieces = pieces.filter((piece) => piece.status === stage.status);
      const section = el("section", "agreement-section");
      const heading = el("div", "kiln-stage-heading");
      heading.append(el("h2", null, `${PIECE_STATUSES[stage.status]} (${stagePieces.length})`));
      if (stage.forward && stagePieces.length > 1) {
        heading.append(
          actionButton(stage.forward.all, true, () =>
            setPieceStatus(
              stagePieces.map((piece) => piece.id),
              stage.forward.to,
            ),
          ),
        );
      }
      section.append(heading);

      if (!stagePieces.length) {
        section.append(el("p", "field-note", stage.empty));
      } else {
        const list = el("ul", "kiln-list");
        list.append(...stagePieces.map((piece) => renderPiece(piece, stage, names)));
        section.append(list);
      }
      return section;
    }),
  );
}

requireMember(async (user) => {
  const profile = await loadProfile(user.id);
  if (!profile?.is_admin) {
    const status = document.querySelector("#page-status");
    status.textContent = "This page is for the studio.";
    status.hidden = false;
    return;
  }
  view.hidden = false;
  load();
});

import {
  supabase,
  showNotConfigured,
  requireMember,
  loadProfile,
  el,
} from "../shared.js?v=3";
import {
  PIECE_COLUMNS,
  PERIOD_COLUMNS,
  buildInvoices,
  renderInvoice,
  monthKey,
  monthLabel,
  showStatements,
} from "../statements.js?v=2";
import { formatMoney } from "../studio.js?v=3";

const invoicesView = document.querySelector("#invoices-view");
const intro = document.querySelector("#invoices-intro");
const current = document.querySelector("#current-statement");
const currentEmpty = document.querySelector("#current-empty");
const past = document.querySelector("#past-statements");
const pastEmpty = document.querySelector("#past-empty");

if (!supabase) {
  showNotConfigured();
  throw new Error("Supabase is not configured in /members/config.js");
}

const showLoadError = (error) => {
  console.error(error);
  currentEmpty.textContent = "Couldn't load statements. Please refresh.";
  currentEmpty.hidden = false;
};

const sumTotals = (invoices) =>
  Math.round(invoices.reduce((sum, invoice) => sum + invoice.total * 100, 0)) / 100;

const memberCount = (count) => `${count} member${count === 1 ? "" : "s"}`;

// A member's own statements ------------------------------------------------

const loadOwnInvoices = async (userId) => {
  // Filter to this member: admins can read everyone's rows.
  const [{ data: pieces, error }, { data: periods, error: periodsError }] =
    await Promise.all([
      supabase.from("pieces").select(PIECE_COLUMNS).eq("user_id", userId),
      supabase
        .from("membership_periods")
        .select(PERIOD_COLUMNS)
        .eq("user_id", userId)
        .order("starts_on"),
    ]);
  if (error || periodsError) return showLoadError(error ?? periodsError);

  showStatements(pieces, periods, { current, currentEmpty, past, pastEmpty });
};

// The studio's view: every member's statements -------------------------------

const loadAllInvoices = async () => {
  const [
    { data: members, error: membersError },
    { data: pieces, error: piecesError },
    { data: periods, error: periodsError },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("is_admin", false)
      .order("full_name"),
    supabase.from("pieces").select(`user_id, ${PIECE_COLUMNS}`),
    supabase
      .from("membership_periods")
      .select(`user_id, ${PERIOD_COLUMNS}`)
      .order("starts_on"),
  ]);
  const error = membersError ?? piecesError ?? periodsError;
  if (error) return showLoadError(error);

  // Every member's statements, keyed by month.
  const byMonth = new Map();
  members.forEach((member) => {
    const invoices = buildInvoices(
      pieces.filter((piece) => piece.user_id === member.id),
      periods.filter((period) => period.user_id === member.id),
    );
    invoices.forEach((invoice) => {
      byMonth.set(invoice.month, [...(byMonth.get(invoice.month) ?? []), { member, invoice }]);
    });
  });
  const name = (member) => member.full_name || member.email;
  const renderRows = (rows, isCurrent) => {
    const list = el("ul", "invoice-list");
    list.append(
      ...rows.map(({ member, invoice }) => renderInvoice(invoice, isCurrent, name(member))),
    );
    return list;
  };
  const summary = (rows) =>
    `${formatMoney(sumTotals(rows.map((row) => row.invoice)))} · ${memberCount(rows.length)}`;

  const thisMonth = monthKey(new Date());
  const currentRows = byMonth.get(thisMonth) ?? [];
  currentEmpty.textContent = "Nothing billed this month yet.";
  currentEmpty.hidden = currentRows.length > 0;
  current.replaceChildren(
    ...(currentRows.length
      ? [
          el("p", "member-total", `${monthLabel(thisMonth)} so far: ${summary(currentRows)}`),
          renderRows(currentRows, true),
        ]
      : []),
  );

  // Past months, newest first, each one folded away.
  const pastMonths = [...byMonth.keys()].filter((month) => month < thisMonth).sort().reverse();
  pastEmpty.hidden = pastMonths.length > 0;
  past.replaceChildren(
    ...pastMonths.map((month) => {
      const rows = byMonth.get(month);
      const details = el("details", "invoice-month");
      details.append(
        el("summary", null, `${monthLabel(month)} · ${summary(rows)}`),
        renderRows(rows, false),
      );
      const item = el("li");
      item.append(details);
      return item;
    }),
  );
};

requireMember(async (user) => {
  const profile = await loadProfile(user.id);
  invoicesView.hidden = false;
  if (profile?.is_admin) {
    document.querySelector("h1").textContent = "Member invoices";
    intro.textContent =
      "Each member's statement is their membership fee plus firing fees ($0.06 per cubic inch) for the pieces they logged that month.";
    await loadAllInvoices();
  } else {
    await loadOwnInvoices(user.id);
  }
});

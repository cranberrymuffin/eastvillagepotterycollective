// Monthly statements: membership fee (from membership_periods) plus firing
// fees for the pieces logged that month. Used by the Invoices page and the
// studio admin page.
import { el } from "./shared.js?v=3";
import {
  TIERS,
  STUDIO_TIME_ZONE,
  firingCost,
  formatMoney,
  formatCubicInches,
  formatPieceNumber,
} from "./studio.js?v=3";

// Columns buildInvoices needs.
export const PIECE_COLUMNS = "piece_number, title, length_in, width_in, height_in, submitted_at";
export const PERIOD_COLUMNS = "id, tier, starts_on, ends_on";

// Months -------------------------------------------------------------------

// Months are keyed "2026-09", in the studio's time zone.
const monthKeyFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: STUDIO_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
});
export const monthKey = (date) => monthKeyFormat.format(date).slice(0, 7);

const parseMonth = (key) => key.split("-").map(Number);

const nextMonth = (key) => {
  const [year, month] = parseMonth(key);
  return month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, "0")}`;
};

export const monthLabel = (key) => {
  const [year, month] = parseMonth(key);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
};

// Every month from `first` to `last`, newest first.
const monthsBetween = (first, last) => {
  const months = [];
  for (let key = first; key <= last; key = nextMonth(key)) months.push(key);
  return months.reverse();
};

// Invoices -----------------------------------------------------------------

// Fees are due on the 1st, so a month is billed at the tier in effect then,
// or, in a month the membership starts, the tier it starts on. Periods come
// from membership_periods, oldest first; none means no membership fee.
const tierForMonth = (periods, month) => {
  const firstDay = `${month}-01`;
  const period =
    periods.find(
      (period) =>
        period.starts_on <= firstDay && (!period.ends_on || period.ends_on >= firstDay),
    ) ?? periods.find((period) => period.starts_on.startsWith(month));
  return period && TIERS[period.tier];
};

export const buildInvoices = (pieces, periods) => {
  const piecesByMonth = new Map();
  pieces.forEach((piece) => {
    // Pieces are billed in the month they were logged, fired or not.
    const month = monthKey(new Date(piece.submitted_at));
    piecesByMonth.set(month, [...(piecesByMonth.get(month) ?? []), piece]);
  });
  // From the first tier period or logged piece, whichever came first.
  const first = [periods[0]?.starts_on.slice(0, 7), ...piecesByMonth.keys()]
    .filter(Boolean)
    .sort()[0];
  if (!first) return [];

  return monthsBetween(first, monthKey(new Date())).map((month) => {
    const tier = tierForMonth(periods, month);
    const lines = [
      ...(tier ? [{ label: `Membership · ${tier.name}`, amount: tier.price }] : []),
      ...(piecesByMonth.get(month) ?? []).map((piece) => {
        const length = Number(piece.length_in);
        const width = Number(piece.width_in);
        const height = Number(piece.height_in);
        return {
          number: piece.piece_number,
          label: piece.title,
          detail: `Bisque + glaze firing · ${length} × ${width} × ${height} in · ${formatCubicInches(length, width, height)}`,
          amount: firingCost(length, width, height),
        };
      }),
    ];
    const total = Math.round(lines.reduce((sum, line) => sum + line.amount * 100, 0)) / 100;
    return { month, lines, total };
  }).filter((invoice) => invoice.lines.length);
};

// The current month's statement is a running tally; past ones are final.
// `title` replaces the month as the heading (the admin view uses names).
export const renderInvoice = ({ month, lines, total }, isCurrent, title = null) => {
  const item = el(isCurrent && !title ? "div" : "li", "invoice");

  const heading = el("div", "invoice-heading");
  heading.append(el("h3", null, title ?? monthLabel(month)));
  if (isCurrent) heading.append(el("span", "invoice-tag", "In progress"));
  item.append(heading);

  const table = el("table", "invoice-lines");
  const caption = el(
    "caption",
    "visually-hidden",
    `Statement for ${title ? `${title}, ` : ""}${monthLabel(month)}`,
  );
  const body = el("tbody");
  lines.forEach((line) => {
    const row = el("tr");
    const description = el("th");
    description.scope = "row";
    if (line.number != null) {
      description.append(el("span", "piece-number", formatPieceNumber(line.number)), " ");
    }
    description.append(line.label);
    if (line.detail) description.append(el("span", "invoice-detail", line.detail));
    row.append(description, el("td", null, formatMoney(line.amount)));
    body.append(row);
  });
  const foot = el("tfoot");
  const totalRow = el("tr");
  const totalLabel = el("th", null, isCurrent ? "Total so far" : "Total");
  totalLabel.scope = "row";
  totalRow.append(totalLabel, el("td", null, formatMoney(total)));
  foot.append(totalRow);
  table.append(caption, body, foot);
  item.append(table);

  if (isCurrent && !title) {
    item.append(
      el("p", "field-note", "Pieces you log later this month will be added here."),
    );
  }
  return item;
};

// Fills the "This month" and "Past statements" areas of a page.
export const showStatements = (pieces, periods, { current, currentEmpty, past, pastEmpty }) => {
  const thisMonth = monthKey(new Date());
  const invoices = buildInvoices(pieces, periods);
  const currentInvoice = invoices.find((invoice) => invoice.month === thisMonth);
  const pastInvoices = invoices.filter((invoice) => invoice.month < thisMonth);

  // Nothing to bill this month: no tier yet, or the membership has ended.
  currentEmpty.textContent = "Nothing on this month's statement.";
  currentEmpty.hidden = Boolean(currentInvoice);
  current.replaceChildren(...(currentInvoice ? [renderInvoice(currentInvoice, true)] : []));

  pastEmpty.hidden = pastInvoices.length > 0;
  past.replaceChildren(...pastInvoices.map((invoice) => renderInvoice(invoice, false)));
};

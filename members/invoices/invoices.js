import {
  supabase,
  showNotConfigured,
  loadProfile,
  requireMember,
  el,
} from "../shared.js";
import {
  TIERS,
  STUDIO_TIME_ZONE,
  firingCost,
  formatMoney,
  formatCubicInches,
  formatPlainDate,
  formatPieceNumber,
} from "../studio.js";

const invoicesView = document.querySelector("#invoices-view");
const memberSince = document.querySelector("#member-since");
const currentStatement = document.querySelector("#current-statement");
const currentEmpty = document.querySelector("#current-empty");
const pastStatements = document.querySelector("#past-statements");
const pastEmpty = document.querySelector("#past-empty");

if (!supabase) {
  showNotConfigured();
  throw new Error("Supabase is not configured in /members/config.js");
}

// Months -------------------------------------------------------------------

// Months are keyed "2026-09", in the studio's time zone.
const monthKeyFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: STUDIO_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
});
const monthKey = (date) => monthKeyFormat.format(date).slice(0, 7);

const parseMonth = (key) => key.split("-").map(Number);

const nextMonth = (key) => {
  const [year, month] = parseMonth(key);
  return month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, "0")}`;
};

const monthLabel = (key) => {
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

// Fees are due on the 1st, so a month is billed at the tier in effect then
// (or on the day they joined, in their first month). Periods come from
// membership_periods, oldest first; none in effect means no membership fee.
const tierForMonth = (periods, month, memberSince) => {
  const firstDay = `${month}-01`;
  const day = memberSince > firstDay ? memberSince : firstDay;
  const period = periods.find(
    (period) => period.starts_on <= day && (!period.ends_on || period.ends_on >= day),
  );
  return period && TIERS[period.tier];
};

const buildInvoices = (profile, pieces, periods) => {
  const piecesByMonth = new Map();
  pieces.forEach((piece) => {
    const month = monthKey(new Date(piece.bisque_fired_at));
    piecesByMonth.set(month, [...(piecesByMonth.get(month) ?? []), piece]);
  });
  const joined = profile.member_since.slice(0, 7);
  // Every month since joining, plus any earlier month with a firing (if the
  // studio back-dates either), so no firing is left off.
  const earlierFirings = [...piecesByMonth.keys()].filter((month) => month < joined);
  const months = [
    ...monthsBetween(joined, monthKey(new Date())),
    ...earlierFirings.sort().reverse(),
  ];

  return months.map((month) => {
    const tier = month >= joined && tierForMonth(periods, month, profile.member_since);
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
const renderInvoice = ({ month, lines, total }, isCurrent) => {
  const item = el(isCurrent ? "div" : "li", "invoice");

  const heading = el("div", "invoice-heading");
  heading.append(el("h3", null, monthLabel(month)));
  if (isCurrent) heading.append(el("span", "invoice-tag", "In progress"));
  item.append(heading);

  const table = el("table", "invoice-lines");
  const caption = el("caption", "visually-hidden", `Statement for ${monthLabel(month)}`);
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

  if (isCurrent) {
    item.append(
      el("p", "field-note", "Pieces fired later this month will be added here."),
    );
  }
  return item;
};

const loadInvoices = async (userId) => {
  const [profile, { data: pieces, error }, { data: periods, error: periodsError }] =
    await Promise.all([
      loadProfile(userId),
      supabase
        .from("pieces")
        .select("piece_number, title, length_in, width_in, height_in, bisque_fired_at")
        .eq("status", "bisque_fired")
        .not("bisque_fired_at", "is", null),
      supabase
        .from("membership_periods")
        .select("tier, starts_on, ends_on")
        .order("starts_on"),
    ]);

  invoicesView.hidden = false;
  if (error || periodsError || !profile) {
    if (error || periodsError) console.error(error ?? periodsError);
    memberSince.hidden = true;
    currentEmpty.textContent = "Couldn't load your statements. Please refresh.";
    currentEmpty.hidden = false;
    return;
  }

  // Statements start from the member's start date, which they set once.
  if (!profile.member_since) {
    memberSince.hidden = true;
    const link = el("a", null, "Add it on My account");
    link.href = "/members/account/";
    currentEmpty.replaceChildren(
      "Your statements start from the day your membership began. ",
      link,
      ".",
    );
    currentEmpty.hidden = false;
    pastEmpty.hidden = false;
    return;
  }

  memberSince.hidden = false;
  memberSince.textContent = `Member since ${formatPlainDate(profile.member_since)}`;

  const thisMonth = monthKey(new Date());
  const invoices = buildInvoices(profile, pieces, periods);
  const current = invoices.find((invoice) => invoice.month === thisMonth);
  const past = invoices.filter((invoice) => invoice.month < thisMonth);

  // Nothing to bill this month: no tier yet, or the membership has ended.
  currentEmpty.textContent = "Nothing on this month's statement.";
  currentEmpty.hidden = Boolean(current);
  currentStatement.replaceChildren(...(current ? [renderInvoice(current, true)] : []));

  pastEmpty.hidden = past.length > 0;
  pastStatements.replaceChildren(...past.map((invoice) => renderInvoice(invoice, false)));
};

requireMember((user) => loadInvoices(user.id));

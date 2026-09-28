// Studio details used across the members pages.

// Keep in step with the fees on /membership/.
export const TIERS = {
  tier_1: { name: "Tier 1", price: 300, perks: "Membership benefits" },
  tier_2: {
    name: "Tier 2",
    price: 325,
    perks: "Membership benefits + 50 lb of white stoneware clay",
  },
  tier_3: {
    name: "Tier 3",
    price: 350,
    perks: "Membership benefits + 50 lb of special clay",
  },
};

export const tierLabel = (tier) =>
  TIERS[tier] ? `${TIERS[tier].name} · $${TIERS[tier].price}/month` : "No tier chosen";

// Bisque + glaze firing, per the fees on /membership/.
export const FIRING_RATE_PER_CUBIC_INCH = 0.06;

// Firing fee in dollars, rounded to the cent.
export const firingCost = (length, width, height) =>
  Math.round(length * width * height * FIRING_RATE_PER_CUBIC_INCH * 100) / 100;

export const formatMoney = (dollars) =>
  dollars.toLocaleString("en-US", { style: "currency", currency: "USD" });

export const formatCubicInches = (length, width, height) =>
  `${(length * width * height).toLocaleString(undefined, { maximumFractionDigits: 1 })} in³`;

export const formatVolume = (length, width, height) =>
  `${formatCubicInches(length, width, height)} · est. $${firingCost(length, width, height).toFixed(2)} to fire`;

// The studio's time zone: statements follow New York dates.
export const STUDIO_TIME_ZONE = "America/New_York";

// Plain dates ("2026-03-14", like membership_periods.starts_on), shown as written.
export const formatPlainDate = (date, month = "long") => {
  const [year, monthNumber, day] = date.split("-").map(Number);
  return new Date(year, monthNumber - 1, day).toLocaleDateString(undefined, {
    month,
    day: "numeric",
    year: "numeric",
  });
};

export const formatPieceNumber = (number) => `#${String(number).padStart(4, "0")}`;

// A piece's journey through the bisque kiln (pieces.status). The studio
// moves pieces along on the Kiln page.
export const PIECE_STATUSES = {
  submitted: "Ready for bisque",
  in_kiln: "In the kiln",
  ready_for_pickup: "Ready for pickup",
};

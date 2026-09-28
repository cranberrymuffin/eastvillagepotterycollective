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

export const formatVolume = (length, width, height) => {
  const volume = length * width * height;
  return `${volume.toLocaleString(undefined, { maximumFractionDigits: 1 })} in³ · est. $${(
    volume * FIRING_RATE_PER_CUBIC_INCH
  ).toFixed(2)} to fire`;
};

export const formatPieceNumber = (number) => `#${String(number).padStart(4, "0")}`;

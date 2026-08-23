// ============================================================================
// Mystery medallions — a second, separate collectible track from
// data/medallions.ts's goal-driven ones. Those 15 unlock by a specific,
// visible rule ("log 30 minutes," "streak 7 days"); these 51 unlock only by
// harvesting a "mystery fruit" that drops onto the Focus Garden's ground as
// you practice (see engine/mysteryFruits.ts for the drop-timing and the
// weighted-roll logic, MysteryFruitGround.tsx/MysteryRollModal.tsx for the
// UI). Two tracks, two different kinds of proud: one for showing up, one
// for good luck.
//
// Every id is prefixed "mystery-" so MedallionId (data/medallions.ts) can
// tell the two families apart at the type level without a lookup, the same
// way BandOrbId's "-orb" suffix already does for that family.
// ============================================================================

export type MysteryRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export const RARITY_ORDER: MysteryRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

export const RARITY_LABEL: Record<MysteryRarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
};

/** The rarity ring/glow color shown on the roll reveal and the collection
 * grid's rarity chip — deliberately separate from each medallion's own
 * `color` (which is the glyph's fill, chosen for per-item variety). This is
 * the one consistent signal of "how good was this pull," so it stays fixed
 * across all 50 items rather than varying per item. */
export const RARITY_COLOR: Record<MysteryRarity, string> = {
  common: '#94a3b8',
  uncommon: '#2dd4bf',
  rare: '#38bdf8',
  epic: '#c084fc',
  legendary: '#f5b942',
};

/** Per-item roll weight — deliberately NOT a per-tier total (a tier with
 * more items would otherwise silently dominate the odds just by having more
 * entries). Every common item shares this exact weight, every legendary
 * item shares that lower one, etc., so the tier counts below (18/14/10/6/3)
 * can be tuned without accidentally reshaping the odds curve.
 *
 * With 18/14/10/6/3 items per tier, the odds of pulling ANY item from a
 * given tier (before the no-duplicate exclusion in rollMysteryMedallion())
 * work out to roughly: common 64%, uncommon 25%, rare 9%, epic 2%,
 * legendary 0.4% — a fairly standard-feeling gacha curve, tightest at the
 * top on purpose so the three legendary pulls stay genuinely special. */
export const RARITY_WEIGHT: Record<MysteryRarity, number> = {
  common: 10,
  uncommon: 5,
  rare: 2.5,
  epic: 1,
  legendary: 0.4,
};

/** Flavor line shown on the roll reveal and the (locked) collection grid
 * tile. Shared per-tier rather than 51 individually-written lines — with 51
 * items the real distinctiveness is each one's own name/color/shape; the
 * blurb's job is just to communicate "how rare was this," consistently. */
export const RARITY_BLURB: Record<MysteryRarity, string> = {
  common: 'A common find among the fallen fruit.',
  uncommon: 'An uncommon glint among the fallen fruit.',
  rare: 'A rare spark among the fallen fruit.',
  epic: "An epic pull — the garden doesn't drop finds like this often.",
  legendary: 'Legendary. The rarest thing the garden has ever grown.',
};

export type MysteryShapeFamily =
  | 'bloom'
  | 'sigil'
  | 'gem'
  | 'coil'
  | 'wisp'
  | 'ring'
  | 'shard'
  | 'comet'
  | 'lattice'
  | 'eye'
  /** The one family that ISN'T a static parametric shape — DoublePendulumGlyph
   * in MedallionIcon.tsx runs a real, live double-pendulum physics
   * simulation instead of reading n/n2/rotation at all. Reserved for the
   * single "Double Pendulum" legendary — thematically fitting since the
   * whole app's own visual is a pendulum, so this glyph is a tiny, chaotic
   * mirror of the real thing swinging above it. */
  | 'physics';

/** Every family's renderer (MysteryGlyph in MedallionIcon.tsx) is driven by
 * up to three plain numeric/rotation knobs rather than fully bespoke path
 * data per item — the same "shared generator, varied parameters" approach
 * spiralPathD/starPath/SnowflakeArm already use elsewhere in this app, just
 * pushed further so 51 genuinely distinct-looking glyphs stay real code
 * instead of 51 hand-authored path strings. (The 'physics' family is the
 * one exception — see MysteryShapeFamily's own comment.) */
export interface MysteryGlyphSpec {
  family: MysteryShapeFamily;
  /** Primary count knob: petal/side/ring/shard/curve/tail-dot count. */
  n?: number;
  /** Secondary knob: facet toggle, spiral layer count, etc. — meaning is
   * family-specific, see MysteryGlyph's switch. */
  n2?: number;
  /** Degrees, orients the whole shape (petal 0, tail direction, etc). */
  rotation?: number;
}

export type MysteryMedallionId = `mystery-${string}`;

export interface MysteryMedallionDef {
  id: MysteryMedallionId;
  name: string;
  rarity: MysteryRarity;
  color: string;
  glyph: MysteryGlyphSpec;
}

/**
 * 51 entries: 10 shape families x 5 each except "eye" (2) and "physics"
 * (1, the live-simulated double pendulum — see MysteryShapeFamily's own
 * comment). Rarity counts: 18 common / 14 uncommon / 10 rare / 6 epic / 3
 * legendary = 51, chosen to loosely track shape complexity (more
 * petals/facets/layers skew toward the rarer end of each family) without
 * being a strict rule.
 *
 * A small handful of the rarer items also carry simple movement — see
 * MYSTERY_ANIMATION_CLASS in MedallionIcon.tsx for the CSS-driven ones
 * (a slow spin, a sway, a blink) and DoublePendulumGlyph for the one
 * that's genuinely simulated, not just looped.
 */
export const MYSTERY_MEDALLIONS: MysteryMedallionDef[] = [
  // bloom — flower/petal loop
  { id: 'mystery-dawn-petal', name: 'Dawn Petal', rarity: 'common', color: '#f9a8d4', glyph: { family: 'bloom', n: 5 } },
  { id: 'mystery-marigold-pulse', name: 'Marigold Pulse', rarity: 'common', color: '#fb923c', glyph: { family: 'bloom', n: 6 } },
  { id: 'mystery-violet-bloom', name: 'Violet Bloom', rarity: 'uncommon', color: '#c4b5fd', glyph: { family: 'bloom', n: 7 } },
  { id: 'mystery-moonflower', name: 'Moonflower', rarity: 'uncommon', color: '#e0e7ff', glyph: { family: 'bloom', n: 8, rotation: 15 } },
  { id: 'mystery-nightbloom', name: 'Nightbloom', rarity: 'rare', color: '#818cf8', glyph: { family: 'bloom', n: 9, rotation: 8 } },
  { id: 'mystery-solstice-bloom', name: 'Solstice Bloom', rarity: 'epic', color: '#fde68a', glyph: { family: 'bloom', n: 10, rotation: 18 } },

  // sigil — polygon rune outline
  { id: 'mystery-still-sigil', name: 'Still Sigil', rarity: 'common', color: '#a5b4fc', glyph: { family: 'sigil', n: 3 } },
  { id: 'mystery-anchor-rune', name: 'Anchor Rune', rarity: 'common', color: '#93c5fd', glyph: { family: 'sigil', n: 4 } },
  { id: 'mystery-hearth-rune', name: 'Hearth Rune', rarity: 'uncommon', color: '#fca5a5', glyph: { family: 'sigil', n: 5 } },
  { id: 'mystery-calm-sigil', name: 'Calm Sigil', rarity: 'uncommon', color: '#67e8f9', glyph: { family: 'sigil', n: 6 } },
  { id: 'mystery-wayfinder-sigil', name: 'Wayfinder Sigil', rarity: 'rare', color: '#5eead4', glyph: { family: 'sigil', n: 7, rotation: 10 } },
  { id: 'mystery-warden-sigil', name: 'Warden Sigil', rarity: 'epic', color: '#fda4af', glyph: { family: 'sigil', n: 8, rotation: 20 } },

  // gem — faceted crystal
  { id: 'mystery-amber-facet', name: 'Amber Facet', rarity: 'common', color: '#f59e0b', glyph: { family: 'gem', n: 5 } },
  { id: 'mystery-quartz-prism', name: 'Quartz Prism', rarity: 'common', color: '#e2e8f0', glyph: { family: 'gem', n: 6 } },
  { id: 'mystery-garnet-cut', name: 'Garnet Cut', rarity: 'uncommon', color: '#f87171', glyph: { family: 'gem', n: 5, n2: 1 } },
  { id: 'mystery-sapphire-facet', name: 'Sapphire Facet', rarity: 'uncommon', color: '#60a5fa', glyph: { family: 'gem', n: 6, n2: 1 } },
  { id: 'mystery-opal-cut', name: 'Opal Cut', rarity: 'rare', color: '#a7f3d0', glyph: { family: 'gem', n: 7, n2: 1 } },
  { id: 'mystery-obsidian-facet', name: 'Obsidian Facet', rarity: 'epic', color: '#c7d2fe', glyph: { family: 'gem', n: 8, n2: 1 } },

  // coil — nested spiral
  { id: 'mystery-slow-coil', name: 'Slow Coil', rarity: 'common', color: '#7dd3fc', glyph: { family: 'coil', n: 15 } },
  { id: 'mystery-hollow-coil', name: 'Hollow Coil', rarity: 'common', color: '#a5f3fc', glyph: { family: 'coil', n: 18 } },
  { id: 'mystery-inner-coil', name: 'Inner Coil', rarity: 'uncommon', color: '#bef264', glyph: { family: 'coil', n: 22, n2: 2 } },
  { id: 'mystery-deep-coil', name: 'Deep Coil', rarity: 'rare', color: '#5eead4', glyph: { family: 'coil', n: 26, n2: 2 } },
  { id: 'mystery-dream-coil', name: 'Dream Coil', rarity: 'epic', color: '#d8b4fe', glyph: { family: 'coil', n: 30, n2: 2, rotation: 20 } },

  // wisp — flowing ribbon
  { id: 'mystery-soft-wisp', name: 'Soft Wisp', rarity: 'common', color: '#bae6fd', glyph: { family: 'wisp', n: 1 } },
  { id: 'mystery-quiet-wisp', name: 'Quiet Wisp', rarity: 'common', color: '#e9d5ff', glyph: { family: 'wisp', n: 1, rotation: 90 } },
  { id: 'mystery-drift-wisp', name: 'Drift Wisp', rarity: 'uncommon', color: '#fbcfe8', glyph: { family: 'wisp', n: 2 } },
  { id: 'mystery-night-wisp', name: 'Night Wisp', rarity: 'uncommon', color: '#a5b4fc', glyph: { family: 'wisp', n: 2, rotation: 45 } },
  { id: 'mystery-trailing-wisp', name: 'Trailing Wisp', rarity: 'rare', color: '#67e8f9', glyph: { family: 'wisp', n: 3, rotation: 30 } },

  // ring — broken concentric halo
  { id: 'mystery-halo-ring', name: 'Halo Ring', rarity: 'common', color: '#fde68a', glyph: { family: 'ring', n: 2 } },
  { id: 'mystery-twin-halo', name: 'Twin Halo', rarity: 'common', color: '#fca5a5', glyph: { family: 'ring', n: 2, rotation: 45 } },
  { id: 'mystery-broken-halo', name: 'Broken Halo', rarity: 'uncommon', color: '#c4b5fd', glyph: { family: 'ring', n: 3 } },
  { id: 'mystery-echo-ring', name: 'Echo Ring', rarity: 'rare', color: '#7dd3fc', glyph: { family: 'ring', n: 3, rotation: 60 } },
  { id: 'mystery-far-halo', name: 'Far Halo', rarity: 'rare', color: '#a7f3d0', glyph: { family: 'ring', n: 4, rotation: 30 } },

  // shard — radiating crystal shards
  { id: 'mystery-glass-shard', name: 'Glass Shard', rarity: 'common', color: '#e0f2fe', glyph: { family: 'shard', n: 5 } },
  { id: 'mystery-bright-shard', name: 'Bright Shard', rarity: 'common', color: '#fef08a', glyph: { family: 'shard', n: 6 } },
  { id: 'mystery-wild-shard', name: 'Wild Shard', rarity: 'uncommon', color: '#f0abfc', glyph: { family: 'shard', n: 7 } },
  { id: 'mystery-storm-shard', name: 'Storm Shard', rarity: 'uncommon', color: '#93c5fd', glyph: { family: 'shard', n: 8 } },
  { id: 'mystery-spark-shard', name: 'Spark Shard', rarity: 'rare', color: '#fdba74', glyph: { family: 'shard', n: 9, rotation: 10 } },

  // comet — teardrop head + trailing tail
  { id: 'mystery-dust-comet', name: 'Dust Comet', rarity: 'common', color: '#cbd5e1', glyph: { family: 'comet', n: 3, rotation: -30 } },
  { id: 'mystery-little-comet', name: 'Little Comet', rarity: 'common', color: '#93c5fd', glyph: { family: 'comet', n: 3, rotation: 150 } },
  { id: 'mystery-ember-comet', name: 'Ember Comet', rarity: 'uncommon', color: '#fb923c', glyph: { family: 'comet', n: 4, rotation: -60 } },
  { id: 'mystery-silver-comet', name: 'Silver Comet', rarity: 'rare', color: '#e2e8f0', glyph: { family: 'comet', n: 4, rotation: 120 } },
  { id: 'mystery-long-tail-comet', name: 'Long-Tail Comet', rarity: 'epic', color: '#67e8f9', glyph: { family: 'comet', n: 5, rotation: -45 } },

  // lattice — overlapping star-of-david-style triangles
  { id: 'mystery-woven-lattice', name: 'Woven Lattice', rarity: 'common', color: '#a3e635', glyph: { family: 'lattice', n: 3 } },
  { id: 'mystery-crossed-lattice', name: 'Crossed Lattice', rarity: 'common', color: '#fca5a5', glyph: { family: 'lattice', n: 3, rotation: 15 } },
  { id: 'mystery-bramble-lattice', name: 'Bramble Lattice', rarity: 'uncommon', color: '#5eead4', glyph: { family: 'lattice', n: 4 } },
  { id: 'mystery-frost-lattice', name: 'Frost Lattice', rarity: 'rare', color: '#bae6fd', glyph: { family: 'lattice', n: 4, rotation: 22.5 } },
  { id: 'mystery-star-lattice', name: 'Star Lattice', rarity: 'epic', color: '#fde68a', glyph: { family: 'lattice', n: 5, rotation: 18 } },

  // eye — legendary only
  { id: 'mystery-third-eye', name: 'The Third Eye', rarity: 'legendary', color: '#c4b5fd', glyph: { family: 'eye', n: 6 } },
  { id: 'mystery-singularity', name: 'Singularity', rarity: 'legendary', color: '#fde68a', glyph: { family: 'eye', n: 10, n2: 1 } },

  // physics — the one glyph that's actually simulated, not drawn
  { id: 'mystery-double-pendulum', name: 'Double Pendulum', rarity: 'legendary', color: '#f8fafc', glyph: { family: 'physics' } },
];

export const MYSTERY_MEDALLIONS_BY_ID: Record<MysteryMedallionId, MysteryMedallionDef> = Object.fromEntries(
  MYSTERY_MEDALLIONS.map((m) => [m.id, m])
) as Record<MysteryMedallionId, MysteryMedallionDef>;

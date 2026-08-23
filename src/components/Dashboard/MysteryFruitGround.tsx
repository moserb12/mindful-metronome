interface MysteryFruitGroundProps {
  /** How many mystery fruits have grown but not yet been harvested — one
   * "?" ball rendered per pending fruit. See engine/mysteryFruits.ts for
   * the drop-timing math. */
  pendingCount: number;
  onHarvest: () => void;
}

/**
 * The "fallen fruit" pile beneath the Focus Garden's tree — per the
 * builder's own framing, mystery fruit doesn't hang in the branches next to
 * the goal-driven medallions (that would visually collide with
 * pickFruitTips' branch-tip layout, and conflate "earned by showing up"
 * with "won by luck"). Instead it drops to the ground: a wrapping row of
 * plain "?" balls, one per fruit that's grown and is waiting to be opened,
 * that a listener scrolls down past the tree to find. Every ball is
 * fungible — the OUTCOME of a harvest isn't decided until the moment it's
 * rolled (see useFocusStats.harvestMysteryFruit), so there's nothing yet to
 * differentiate one pending ball from another.
 *
 * Renders nothing when nothing's pending, so a listener who hasn't reached
 * the first threshold yet sees no empty placeholder area.
 */
export function MysteryFruitGround({ pendingCount, onHarvest }: MysteryFruitGroundProps) {
  if (pendingCount <= 0) return null;

  return (
    <div className="focus-card mystery-fruit-ground-card">
      <span className="control-label">
        {pendingCount === 1 ? '1 mystery fruit fell to the ground' : `${pendingCount} mystery fruits fell to the ground`}
      </span>
      <p className="control-hint">Tap one to see what grew.</p>
      <div className="mystery-fruit-ground">
        {Array.from({ length: pendingCount }).map((_, i) => (
          <button
            key={i}
            type="button"
            className="mystery-fruit-ball"
            style={{ animationDelay: `${(i % 8) * 0.09}s` }}
            onClick={onHarvest}
            aria-label="Harvest this mystery fruit"
            title="Harvest this mystery fruit"
          >
            <span aria-hidden="true">?</span>
          </button>
        ))}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';

interface WateringCanProps {
  /** Waters today's tree and returns whether THIS click was the day's
   * first watering (by any means) — see useFocusStats.waterTree's own doc
   * comment. A true return means a bonus mystery fruit just dropped. */
  onWater: () => boolean;
}

/** How long the full pour flourish plays — the can travels up and over the
 * tree, sweeps left-to-right while pouring across the whole canopy, then
 * travels back to its resting spot — before settling back upright. Matches
 * the CSS animation durations below. Slow and deliberate (3s) rather than
 * a quick tilt, so the sweep itself reads as an actual watering motion. */
const POUR_DURATION_MS = 3000;
/** The "a fruit fell!" callout lingers a beat longer than the pour itself
 * so it isn't clipped by the can already settling back to rest. */
const BONUS_CALLOUT_DURATION_MS = 3700;

/**
 * A small hand-drawn watering can sitting beside the Focus Garden tree —
 * same "thin strokes, no external assets" visual language as MedallionIcon
 * and the pyramid/eye. Drawn pointing TOWARD the tree (spout on the left,
 * handle on the right — see the mirrored path data below), since it rests
 * to the tree's right and needs to visibly aim at what it's watering.
 * Clicking it always "waters" today's tree (see useFocusStats.waterTree —
 * this is a genuine, real streak action, not just decoration: it marks
 * today watered the same way a minute of real practice does), and on the
 * first watering of the day it also drops one bonus mystery fruit onto
 * MysteryFruitGround.
 *
 * Purely a trigger + flourish, same division of labor as every other
 * one-shot animation in this app (pyramidPinging, eyeWinking in
 * MetronomeVisual.tsx): this component owns no stat logic itself, just a
 * toggled `pouring` class and a timeout that clears it, so the CSS
 * animation and the "active" window stay exactly in sync. The `pouring`
 * class lives on the outer wrap (not just the button) because the pour
 * flourish moves the WHOLE can — it travels up over the tree, tilts, and
 * sweeps left-to-right across the canopy (animating the wrap's own
 * right/bottom position, which CSS keeps relative to the tree card the
 * same way its resting position already is) while a run of droplets falls
 * from the spout throughout that sweep, each falling far enough (the SVG
 * has overflow:visible) to actually reach down onto the tree below rather
 * than just near the can's own small icon.
 */
export function WateringCan({ onWater }: WateringCanProps) {
  const [pouring, setPouring] = useState(false);
  const [showBonusCallout, setShowBonusCallout] = useState(false);
  const pourTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bonusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pourTimeoutRef.current) clearTimeout(pourTimeoutRef.current);
      if (bonusTimeoutRef.current) clearTimeout(bonusTimeoutRef.current);
    };
  }, []);

  function handleClick() {
    const grantedBonus = onWater();

    setPouring(true);
    if (pourTimeoutRef.current) clearTimeout(pourTimeoutRef.current);
    pourTimeoutRef.current = setTimeout(() => setPouring(false), POUR_DURATION_MS);

    if (grantedBonus) {
      setShowBonusCallout(true);
      if (bonusTimeoutRef.current) clearTimeout(bonusTimeoutRef.current);
      bonusTimeoutRef.current = setTimeout(() => setShowBonusCallout(false), BONUS_CALLOUT_DURATION_MS);
    }
  }

  return (
    <div className={`watering-can-wrap ${pouring ? 'pouring' : ''}`}>
      <button
        type="button"
        className="watering-can-button"
        onClick={handleClick}
        aria-label="Water the tree"
        title="Water the tree"
      >
        <svg viewBox="0 0 60 60" className="watering-can-svg" aria-hidden="true">
          <g className="watering-can-tilt-group">
            {/* Body — mirrored from the original design so the spout points
                LEFT (toward the tree, which sits to this can's left) and
                the handle sits on the right. */}
            <path
              d="M46 30 Q46 24 40 24 L26 24 Q20 24 20 30 L22 46 Q22.5 50 27 50 L39 50 Q43.5 50 44 46 Z"
              className="watering-can-body"
            />
            {/* Handle */}
            <path d="M40 24 Q33 12 26 24" className="watering-can-outline" fill="none" />
            {/* Spout */}
            <path d="M22 28 L10 20 M14 18 L8 22" className="watering-can-outline" fill="none" strokeLinecap="round" />
            {/* Base rim */}
            <ellipse cx="33" cy="30" rx="13" ry="3" className="watering-can-rim" />
          </g>
          {/* A thin continuous trickle right at the spout tip, alongside the
              individual falling droplets below — only visible while
              actively tilted/pouring. */}
          <path className="watering-can-stream" d="M5 25 Q3 29 2 33" aria-hidden="true" />
          {/* Droplets — only visible while pouring, staggered across the
              whole sweep (see index.css) so, combined with the can's own
              left-to-right travel, they land across the tree canopy rather
              than all in one spot. Fall distance is large on purpose — the
              SVG is overflow:visible, so these travel well past this small
              icon's own box, down toward the tree below. */}
          <g className="watering-can-droplets" aria-hidden="true">
            <circle className="watering-can-droplet watering-can-droplet-1" cx="3" cy="29" r="1.6" />
            <circle className="watering-can-droplet watering-can-droplet-2" cx="1" cy="32" r="1.4" />
            <circle className="watering-can-droplet watering-can-droplet-3" cx="4" cy="34" r="1.7" />
            <circle className="watering-can-droplet watering-can-droplet-4" cx="0" cy="37" r="1.3" />
            <circle className="watering-can-droplet watering-can-droplet-5" cx="3" cy="39" r="1.5" />
            <circle className="watering-can-droplet watering-can-droplet-6" cx="1" cy="41" r="1.2" />
          </g>
        </svg>
      </button>
      {showBonusCallout && (
        <span className="watering-can-bonus-callout" role="status">
          A mystery fruit fell! 🌱
        </span>
      )}
    </div>
  );
}

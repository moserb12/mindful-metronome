import { useEffect, useRef, useState } from 'react';

interface WateringCanProps {
  /** Waters today's tree and returns whether THIS click was the day's
   * first watering (by any means) — see useFocusStats.waterTree's own doc
   * comment. A true return means a bonus mystery fruit just dropped. */
  onWater: () => boolean;
}

/** How long the pour flourish (tilt + falling droplets) plays before the
 * can settles back upright — matches the CSS animation duration below. */
const POUR_DURATION_MS = 900;
/** The "a fruit fell!" callout lingers a beat longer than the pour itself
 * so it isn't clipped by the can already settling back to rest. */
const BONUS_CALLOUT_DURATION_MS = 1700;

/**
 * A small hand-drawn watering can sitting beside the Focus Garden tree —
 * same "thin strokes, no external assets" visual language as MedallionIcon
 * and the pyramid/eye. Clicking it always "waters" today's tree (see
 * useFocusStats.waterTree — this is a genuine, real streak action, not
 * just decoration: it marks today watered the same way a minute of real
 * practice does), and on the first watering of the day it also drops one
 * bonus mystery fruit onto MysteryFruitGround.
 *
 * Purely a trigger + flourish, same division of labor as every other
 * one-shot animation in this app (pyramidPinging, eyeWinking in
 * MetronomeVisual.tsx): this component owns no stat logic itself, just a
 * toggled `pouring` class and a timeout that clears it, so the CSS
 * animation and the "active" window stay exactly in sync.
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
    <div className="watering-can-wrap">
      <button
        type="button"
        className={`watering-can-button ${pouring ? 'pouring' : ''}`}
        onClick={handleClick}
        aria-label="Water the tree"
        title="Water the tree"
      >
        <svg viewBox="0 0 60 60" className="watering-can-svg" aria-hidden="true">
          <g className="watering-can-tilt-group">
            {/* Body */}
            <path
              d="M14 30 Q14 24 20 24 L34 24 Q40 24 40 30 L38 46 Q37.5 50 33 50 L21 50 Q16.5 50 16 46 Z"
              className="watering-can-body"
            />
            {/* Handle */}
            <path d="M20 24 Q27 12 34 24" className="watering-can-outline" fill="none" />
            {/* Spout */}
            <path d="M38 28 L50 20 M46 18 L52 22" className="watering-can-outline" fill="none" strokeLinecap="round" />
            {/* Base rim */}
            <ellipse cx="27" cy="30" rx="13" ry="3" className="watering-can-rim" />
          </g>
          {/* Droplets — only visible while pouring, positioned near the spout tip */}
          <g className="watering-can-droplets" aria-hidden="true">
            <circle className="watering-can-droplet watering-can-droplet-1" cx="53" cy="24" r="1.6" />
            <circle className="watering-can-droplet watering-can-droplet-2" cx="55" cy="27" r="1.3" />
            <circle className="watering-can-droplet watering-can-droplet-3" cx="51" cy="27" r="1.1" />
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

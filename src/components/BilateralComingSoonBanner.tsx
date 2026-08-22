// ============================================================================
// A small, non-interactive banner replacing the old collapsible "Practice
// with Bilateral Stimulation" accordion — that feature (an 18-level
// hand/foot rhythm-timing program) isn't built yet, so rather than a
// section competing for attention with a body that just said "coming
// soon," this is one line with a tiny animated UFO buzzing around it —
// piloted by a miniature version of the pyramid-eye mascot, tying it back
// to the same visual language as the main instrument.
// ============================================================================

export function BilateralComingSoonBanner() {
  return (
    <section className="coming-soon-banner" aria-label="Bilateral stimulation — coming soon">
      <div className="coming-soon-ufo-track" aria-hidden="true">
        <svg className="coming-soon-ufo" viewBox="0 0 60 40" width="52" height="35">
          <ellipse cx="30" cy="26" rx="22" ry="8" className="ufo-saucer" />
          <path d="M14 26 A16 16 0 0 1 46 26 Z" className="ufo-dome" />
          <g className="ufo-pilot" transform="translate(30 20) scale(0.28)">
            <path d="M0 -30 L26 20 L-26 20 Z" className="ufo-pilot-pyramid" />
            <circle cx="0" cy="6" r="12" className="ufo-pilot-eye-outer" />
            <circle cx="0" cy="6" r="5" className="ufo-pilot-eye-pupil" />
          </g>
          <circle cx="18" cy="30" r="1.6" className="ufo-light" />
          <circle cx="30" cy="32" r="1.6" className="ufo-light" style={{ animationDelay: '0.2s' }} />
          <circle cx="42" cy="30" r="1.6" className="ufo-light" style={{ animationDelay: '0.4s' }} />
        </svg>
      </div>
      <p className="coming-soon-text">
        <span aria-hidden="true">🛸 </span>
        Bilateral stimulation function coming soon
      </p>
    </section>
  );
}

# Mindful Metronome

A free binaural-beat, bilateral-stimulation rhythm tool for flow states.

Two audio layers — a continuous binaural drone and an alternating-ear
metronome tick — synced to one visual instrument: an eye at the center of a
pyramid, a pendulum arm swinging between its two "hemisphere" corners, and
neurons that fire on each tick.

## Development

```bash
npm install
npm run dev      # start the dev server
npm test         # run the test suite
npm run build    # type-check + production build
```

No backend, no accounts — everything runs client-side against the Web
Audio API. See `CLAUDE.md` for the full design/architecture rationale.

## Deployment workflow

GitHub is the source of truth. Work on a feature branch, verify the Vercel
preview created for that branch, then merge to `main` for the production
deployment. The Vercel project owns hosting, domains, analytics, and build
settings; application source should not be edited independently in Vercel.

## Android background audio

The generated noise/ambiance layer plays through a looping HTML audio
element that is routed into the Web Audio graph. This gives Chrome on
Android a real media session and Audio Focus while preserving the existing
mixer, analyser, and synthesized binaural/tick layers. Page lifecycle and
AudioContext recovery handlers resynchronize the beat scheduler after an
OS interruption without replaying overdue beats in a burst.

The last 80 lifecycle events are retained locally under
`mindful-metronome:audio-diagnostics:v1` in browser localStorage. This is a
device-local diagnostic log only; it is never transmitted.

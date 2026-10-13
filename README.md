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

The complete Web Audio mix is routed into a `MediaStreamAudioDestinationNode`
and played by an HTML audio element as an open-ended live stream. This gives
Chrome on Android a real media session and Audio Focus without presenting an
artificial short-file timeline in notification controls. Page lifecycle and
AudioContext recovery handlers resynchronize the beat scheduler after an OS
interruption without replaying overdue beats in a burst. Pause also cancels
every tick/chime already committed by the background lookahead scheduler.

The last 80 lifecycle events are retained locally under
`mindful-metronome:audio-diagnostics:v1` in browser localStorage. This is a
device-local diagnostic log only; it is never transmitted.

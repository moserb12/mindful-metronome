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

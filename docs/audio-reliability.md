# Audio reliability and verification

## Intended signal

- Left ear: sine at the carrier frequency.
- Right ear: sine at carrier + binaural offset.
- Each oscillator is mono and connects to its own input of a two-channel
  merger. Neither frequency is panned across to the other ear.
- The existing pendulum volume swing remains enabled by default (80/20).
  This is **constant-sum amplitude**, not constant RMS power or a guarantee
  of constant perceived loudness. At 50/50, both tones are steady.
- Tick placement is independent of tone routing. The noise shield is centered.
- One common headroom trim leaves room for simultaneous layers/chimes without
  compressing the tones. This lowers overall volume; it does not change the
  relative ear balance.

Two nearby pitches need not be perceived as two distinct notes. Software
separation is measured with channel spectra, not inferred from that sensation.
The previous hard-pan graph also intended separate channels; the investigation
does not establish that it was actually collapsing them to mono on the user's
device.

## What changed

The old implementation queued individual ticks and swing gain curves up to
30 seconds ahead using a page timer. Once that queue ran dry, ticks could stop
and the swing could freeze. Continuous oscillators could remain audible, so
this was not necessarily a total audio interruption.

Swing modulation and ticks now use native looping audio buffers. They require
no page-timer refill. Playback rates account for buffer rounding so tempo
does not accumulate sample-rounding drift. Tempo changes finish the current
swing, then switch at the shared visual/audio endpoint. Volume/depth controls
have separate gains and do not replace ongoing automation curves.

Additional safeguards:

- The real, looping media element remains the noise source and media-focus
  anchor, preserving the approach that previously enabled Android controls.
- Feature-detected Audio Session `playback` category request.
- Equal-power overlap at the noise PCM seam. This cannot guarantee that every
  browser's media-element looping is gapless.
- Native session gate reaches silence at a selected finite deadline even if
  UI polling stops. The UI/media element may not finish cleanup until the page
  runs again.
- Bounded interval-chime count (12 rings maximum) and ended-node cleanup.
- Pause cancels current loops, pending tempo transitions, and chimes.
- One-second left/right headphone checks use the same stereo voice/output
  graph, without changing settings or starting an ongoing playback session.

## Checks completed locally

Run `npm test` and `npm run build`.

For real browser rendering, run `npm run dev`, open `/qa/audio.html`, and
click **Run audio checks**. The QA page is not included in the production build.
The checks render silently using the browser's real `OfflineAudioContext`:

- 44.1 and 48 kHz: 200 Hz left / 210 Hz right, matched 0.500000 amplitudes;
  wrong-ear carrier amplitude below 0.00001.
- 90-second swing render without any page-scheduler callbacks: 90/10 motion
  remains active past the former 30-second horizon.
- Native tick loop at 64 BPM through 89 seconds: correct ear/beat; silence
  after stop.
- Live tempo transition at the same endpoint and ear.
- Live retuning to 240 Hz left / 260 Hz right and matched volume adjustment.
- Finite timer reaches exact silence without polling; a later master-volume
  change cannot undo the deadline.

Local app smoke checks cover live presets, swing width, tick placement/pattern,
finite/infinite timer changes, headphone-check buttons, and pause. The ordinary
audio element is playing during a session and paused/rewound after manual pause.

These are **not** physical-device, overnight, or cross-browser certifications.

## Physical-device acceptance still required

Use stereo headphones, a comfortable volume, and disable OS mono audio.
Pause the session and open **Beat & stereo → Test left ear / Test right ear**.
Each should sound only in its named ear. If not, investigate OS accessibility
audio, Bluetooth call/headset mode, spatial-audio processing, and the output
device before changing oscillator frequencies.

Then test Android Chrome, iPhone Safari, and the desktop browsers actually used:

1. Start Infinite playback, verify the notification/lock-screen controls, and
   lock the screen for at least one hour, then overnight.
2. Test with noise at zero as well as enabled.
3. Change vibes without pausing, pause immediately after a tempo change,
   restart, and confirm ticks/pan still match the pendulum.
4. Test a finite session, including locking the screen across its deadline.
5. Record browser/OS versions, output device, battery restrictions, and whether
   a phone call or another media app interrupted playback.

Local diagnostics remain in localStorage under
`mindful-metronome:audio-diagnostics:v1` (latest 80 events). No logs are sent
to a server. Copy them before repeatedly restarting, since this is a ring log.
New events identify explicit stereo routing, tone frequencies, native rhythm
starts, and channel-check attempts.

## Background-playback boundary

A website cannot promise uninterrupted playback when the OS suspends/kills
its process, a computer sleeps, or another app takes audio focus. iOS Safari
can place an AudioContext in the `interrupted` state when leaving/locking the
page. Recovery remains best effort and may require a new user gesture.

- [MDN: AudioContext states and iOS interruptions](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/state)
- [Chrome: Media Session](https://developer.chrome.com/blog/media-session)
- [Apple: native playback audio-session category](https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/playback)

If reliable screen-off playback across mobile OSes is a hard product
requirement, the next architectural step is a native audio playback layer
with the platforms' background-audio integration. A web wrapper alone does
not solve that. Even native audio cannot continue through power-off or
unconditionally override interruptions.

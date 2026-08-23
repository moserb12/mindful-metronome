// ============================================================================
// mysticalQuotes.ts — 50 short, original aphorisms shown beneath the Focus
// Garden's tree name, one picked at random per visit. Deliberately NOT
// attributed to any real person — these are written for this app, evoking
// the same visual/thematic register as the rest of the instrument (the
// pyramid, the tracking eye, binaural beats, hemispheres syncing, geometric
// symbols) rather than quoting or misattributing real historical figures.
// Purely decorative flavor text, same "cosmetic, never touches scoring or
// stats" boundary every other flourish in this app respects.
// ============================================================================

export const MYSTICAL_QUOTES: string[] = [
  'Two hemispheres, one rhythm.',
  'The eye that watches also listens.',
  'Stillness is a tempo, not an absence.',
  'What the pyramid holds, the mind can hold too.',
  'Every beat is a small return home.',
  'Symmetry is the mind agreeing with itself.',
  'Between two tones, a third is born — attention.',
  'The pupil follows what the breath has already found.',
  'A steady pulse is the oldest kind of prayer.',
  'Left and right were never really apart.',
  'Geometry is memory the eye hasn\'t named yet.',
  'The beat you keep is the mind you build.',
  'Sound bends around a listening skull.',
  'Where two waves meet, a third truth hums.',
  'The pyramid does not rush to its point.',
  'Focus is the shadow cast by patience.',
  'Every symbol is a door left slightly open.',
  'The eye at rest still keeps the rhythm.',
  'Balance is not stillness — it is two forces, tuned.',
  'A single tone asks nothing. Two tones ask everything.',
  'The mind is a room the beat keeps furnished.',
  'What repeats, remembers.',
  'Inside every triangle, a quiet apex waits.',
  'The binaural hum is the brain talking to itself.',
  'To listen with both ears is to think with both halves.',
  'A pulse held steady becomes a kind of light.',
  'The eye does not choose what it tracks — it simply follows truth.',
  'Old symbols outlive the hands that carved them.',
  'Between each tick, the whole self resets.',
  'The pyramid\'s base is wide so its peak can be small.',
  'Attention is the rarest kind of stillness.',
  'Every hemisphere is half a question.',
  'The beat does not wait for you — it waits with you.',
  'Sacred geometry is just proportion that noticed itself.',
  'Two frequencies, one nervous system, one truth.',
  'The gaze that wanders always finds its way back to rhythm.',
  'What the ear hears, the body eventually believes.',
  'A well-kept tempo is a promise kept to yourself.',
  'The eye in the triangle was never watching you — it was watching with you.',
  'Silence between beats is where the meaning lives.',
  'Balance is built one small correction at a time.',
  'The mind syncs before it understands why.',
  'A shape held long enough becomes a feeling.',
  'The metronome is an old kind of meditation.',
  'Every tick is proof the moment kept going.',
  'Two tones, held apart, teach the brain to reach.',
  'The pyramid rises because its edges agree to meet.',
  'Rhythm is the shortest bridge between two hemispheres.',
  'What the eye fixes on, the mind eventually rests in.',
  'Some symbols are older than the languages that explain them.',
  'The steadiest sound in the room is usually your own attention.',
];

/** Picks one quote at random. Called once per mount (see FocusDashboard),
 * not on every render, so the quote doesn't visibly flicker as other
 * dashboard state updates. */
export function randomMysticalQuote(): string {
  return MYSTICAL_QUOTES[Math.floor(Math.random() * MYSTICAL_QUOTES.length)];
}

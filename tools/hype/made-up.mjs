/**
 * A made-up music map for the tests, in music-map.json's shape, whose numbers are easy to see: no drone (the music's first note is at 10),
 * block 1 from 10 to 70 (a statement every 10 s), block 2 from 70 to 100 and block 3 from 100 to 130 (every 5 s), the coda's chords at
 * 130, 132, 140, 141 and 150, and the last chord's end at 155. The recording's length is 160 and its sha1 `aaa`.
 */
const statements = Array.from({ length: 18 }, (_, i) => {
  const block = 1 + Math.floor(i / 6), step = block === 1 ? 10 : 5, start = block === 1 ? 10 + i * 10 : block === 2 ? 70 + (i - 6) * 5 : 100 + (i - 12) * 5;
  return { n: i + 1, block, start, length: step, beats: 16, confident: block !== 2 };
});

export const madeUp = () => structuredClone({
  seconds: 160,
  sha1: 'aaa',
  drone: { start: 10, end: 10, confident: true },
  statements,
  coda: { chords: [130, 132, 140, 141, 150].map((t) => ({ t, confident: true })), end: { t: 155, confident: true } },
});

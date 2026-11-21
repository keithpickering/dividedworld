/**
 * The edit: the cut list below, assembled from the takes in .runs/hype/ into one film, with the music and the sounds.
 *
 *   node tools/hype/edit.mjs [--music path] [--out .runs/hype/rough-cut.mp4]
 *
 * A cut is a take, the frames of it that are used (the takes are 60 frames a second) and how fast they play. Cuts are trimmed one by
 * one, joined, and the sound is laid under them:
 *
 *   - The music starts on the cut marked `music: 'start'`, at the frame of that cut its `hit` names (the stamp, in the cold open), and
 *     stops dead at the start of the cut marked `music: 'stop'`.
 *   - A cut's `sounds` are played from the cut's start or `at` seconds into it: one of the game's own crowd sounds
 *     (instances/divided-world/ui/sounds/), or one this script prepares (`MADE`: the mouse click and the storm).
 *   - A cut's `clicks` are frames of its take at which the mouse is pressed: each gets the click.
 *
 * The take `black` is made here: a stretch of black. The click is the machine's own (`--click`), and the storm is the owner's
 * recording (`--storm`); without either file a made one stands in.
 *
 * The cuts are timed to the music (`onsets`): under the music, each cut's end is moved to the nearest beat within a third of a second,
 * a card by holding it a little longer or shorter, a take by playing it a little faster or slower, and left where it was when no beat
 * is near enough or the change would be more than a third of its speed. The cut list's own numbers are the timing by eye it starts from.
 *
 * The ending (the owner's notes, 2026-11-14): the film's last move is the pick of the strongest card in the hand, and on that press it
 * cuts to the title, on a lightning strike that takes the music's place. Then a hard cut to black, and out of the storm the last words
 * come up and go.
 * (The storyboard: docs/plans/2026-11-14-hype-video-storyboard.md.)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { flag } from './stage.mjs';

const DIR = '.runs/hype', TMP = `${DIR}/edit`, F = 60;
const SOUNDS = 'instances/divided-world/ui/sounds';
const music = flag('music', `${DIR}/music/dies-irae-icbsa.ogg`);
const out = flag('out', `${DIR}/rough-cut.mp4`);

/** @typedef {{ music?: string, hit?: number, clicks?: number[], sounds?: { file: string, at?: number }[] }} Extra */
/** [take, first frame, last frame, speed, extras] @type {[string, number, number, number, Extra?][]} */
const CUTS = [
  /* 1. Cold open: silence but for the mouse; a post, a reaction. The music starts on the stamp. */
  ['cold-open', 120, 400, 1.7, { clicks: [396] }],
  ['cold-open', 400, 716, 1.5, { music: 'start', hit: 668, clicks: [632] }],
  /* 2. The world. */
  ['card-t1a', 0, 54, 1], ['card-t1b', 0, 60, 1],
  ['pack', 60, 330, 2],
  ['card-t2', 0, 60, 1],
  ['staff-memo', 0, 70, 1],
  ['card-t3a', 0, 60, 1], ['card-t3b', 0, 66, 1],
  ['pack', 336, 470, 1], ['pack', 700, 800, 1],
  /* 3. Scrub, round one. */
  ['scrub-1', 24, 150, 1], ['scrub-1', 262, 700, 2.2],
  /* 4. The arsenal. */
  ['montage-autocorrect', 36, 190, 1.15],
  ['montage-glitter', 84, 170, 1],
  ['montage-hold', 50, 300, 2],
  ['montage-jimmy', 140, 250, 1.2],
  ['montage-laugh', 96, 140, 1, { sounds: [{ file: 'laugh-2.mp3' }] }],
  ['montage-warn', 60, 140, 1, { sounds: [{ file: 'boo-1.mp3' }] }],
  ['card-t4a', 0, 54, 1], ['card-t4b', 0, 72, 1],
  /* 5. Scrub, round two. */
  ['scrub-2', 150, 528, 1.35],
  /* 6. The Staff: each post held a little less than the last, and by the end they are only flashes. */
  ['card-t5', 0, 66, 1],
  ['staff-memo', 60, 190, 1],
  ['staff-declined', 70, 180, 1],
  ['staff-stars', 20, 105, 1],
  ['staff-profile', 236, 330, 1],
  ['card-t6', 0, 72, 1],
  ['staff-farewell', 40, 180, 1],
  ['staff-arrival', 70, 170, 1],
  ['staff-declined', 200, 232, 1], ['staff-memo', 220, 246, 1], ['staff-stars', 150, 170, 1], ['staff-profile', 335, 350, 1],
  /* 7. Scrub, round three. */
  ['scrub-3', 300, 828, 1.55],
  /* 8. The hand: the fan, the pass, and the pick of the strongest card in it. */
  ['hand', 96, 300, 1], ['hand', 300, 716, 2.1], ['hand', 716, 858, 1, { clicks: [852] }],
  /* 9. On the press, the title, on a lightning strike that takes the music's place; black; and out of the storm, the last words, up and away. */
  ['card-t7', 0, 108, 1, { music: 'stop', sounds: [{ file: 'storm' }] }],
  ['black', 0, 84, 1],
  ['card-t10', 0, 516, 1],
  ['black', 0, 60, 1],
];

const run = (args, label) => {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg could not ${label}`);
};
/* An expression inside a filter: its commas are the filter graph's unless they are escaped. */
const expr = (e) => e.replace(/,/gu, '\\,');

mkdirSync(TMP, { recursive: true });

/**
 * The sounds this script makes, each a file in the edit's folder and how loud it is laid in.
 *   click   a mouse button: the machine's own navigation click
 *   storm   the strike that the title lands on, and the storm after it
 */
const CLICK = flag('click', 'C:/Windows/Media/Windows Navigation Start.wav'), STORM_FILE = flag('storm', `${DIR}/music/storm.mp3`);
const MADE = { click: { file: `${TMP}/click.wav`, volume: 1 }, storm: { file: `${TMP}/storm.wav`, volume: 0.85 } };
/* The click: the machine's own (Windows's navigation click, by the owner's word), brought up from the whisper it is recorded at; else the made one. */
if (existsSync(CLICK)) run(['-i', CLICK, '-af', 'volume=10,apad=pad_dur=0.05', '-ar', '48000', MADE.click.file], 'take the click');
else run(['-f', 'lavfi', '-i', `aevalsrc=${expr("0.5*(random(0)*2-1)*exp(-t*500)*lt(t,0.02)+0.3*(random(1)*2-1)*exp(-(t-0.075)*650)*gte(t,0.075)*lt(t,0.1)")}:d=0.14:s=48000`, '-af', 'highpass=f=1400,lowpass=f=9000', MADE.click.file], 'make the click');
/*
 * The storm: the owner's recording (a lightning strike at its start, and the storm after it; his to use by his license), cut to the
 * ending's length and faded out at its end. Without the file, a made one: rain, a clap and its roll.
 */
const STORM = 12.8;
if (existsSync(STORM_FILE)) run(['-i', STORM_FILE, '-af', `atrim=0:${STORM},afade=t=out:st=${STORM - 1.6}:d=1.6`, '-ar', '48000', MADE.storm.file], 'take the storm');
else {
  run([
    '-f', 'lavfi', '-i', `anoisesrc=c=pink:a=0.6:d=${STORM}:r=48000`, '-f', 'lavfi', '-i', `anoisesrc=c=brown:a=1:d=${STORM}:r=48000:seed=7`, '-f', 'lavfi', '-i', `anoisesrc=c=brown:a=1:d=${STORM}:r=48000:seed=11`,
    '-filter_complex', [
      '[0]highpass=f=700,lowpass=f=9000,volume=0.15,afade=t=in:d=1.6[rain]',
      `[1]lowpass=f=110,volume=${expr('4*exp(-t/1.9)*(0.65+0.35*sin(9*t))')}:eval=frame[roll]`,
      `[2]bandpass=f=420:w=500,volume=${expr('3*exp(-t/0.35)')}:eval=frame[clap]`,
      `[rain][roll][clap]amix=inputs=3:normalize=0,afade=t=out:st=${STORM - 2.8}:d=2.8,alimiter=limit=0.9[a]`,
    ].join(';'), '-map', '[a]', MADE.storm.file,
  ], 'make the storm');
}

/**
 * The music's beats, in seconds from its start: where its loudness jumps. The music is read as plain samples, its loudness taken every
 * 23ms, and a beat is a jump well above the usual, at least 0.18s after the one before.
 */
function onsets(file) {
  const RATE = 11025, HOP = 256, WIN = 512;
  const pcm = spawnSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'], { maxBuffer: 1 << 28 }).stdout;
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  const loud = [];
  for (let i = 0; i + WIN <= samples.length; i += HOP) { let e = 0; for (let j = i; j < i + WIN; j++) e += samples[j] * samples[j]; loud.push(Math.log10(1 + e / WIN)); }
  const jump = loud.map((v, i) => Math.max(0, v - (loud[i - 2] ?? v)));
  const rising = jump.filter((v) => v > 0), mean = rising.reduce((x, y) => x + y, 0) / rising.length;
  const bar = mean + 0.9 * Math.sqrt(rising.reduce((x, y) => x + (y - mean) ** 2, 0) / rising.length);
  const beats = [];
  for (let i = 1; i < jump.length - 1; i++) {
    const at = (i * HOP) / RATE;
    if (jump[i] > bar && jump[i] >= jump[i - 1] && jump[i] >= jump[i + 1] && at - (beats.at(-1) ?? -1) >= 0.18) beats.push(at);
  }
  return beats;
}
const beats = existsSync(music) ? onsets(music) : [];
console.log(`the music has ${beats.length} beats`);

let t = 0, musicAt = null, musicEnds = null, moved = 0;
const parts = [], sounds = [];
for (const [i, [take, a, b0, speed0, extra = {}]] of CUTS.entries()) {
  const src = `${DIR}/${take}.mp4`, made = take === 'black';
  if (!made && !existsSync(src)) throw new Error(`the cut list names ${src}, which is not filmed`);
  const part = `${TMP}/cut-${String(i).padStart(2, '0')}.mp4`;
  let b = b0, speed = speed0, frames = Math.round((b - a) / speed), note = '';
  /* Under the music, the cut's end goes to the nearest beat, if one is near. */
  if (!made && musicAt !== null && musicEnds === null && extra.music !== 'stop') {
    const end = t + frames / F;
    const near = beats.map((o) => musicAt + o).filter((o) => Math.abs(o - end) <= 0.34 && o - t >= 0.3).sort((x, y) => Math.abs(x - end) - Math.abs(y - end))[0];
    if (near !== undefined) {
      const want = Math.round((near - t) * F);
      if (take.startsWith('card-') && a + want <= 118) { b = a + want; frames = want; note = ' (held to the beat)'; moved++; }
      else if (!take.startsWith('card-') && Math.abs((b - a) / want / speed0 - 1) <= 0.34) { speed = (b - a) / want; frames = want; note = ' (to the beat)'; moved++; }
    }
  }
  const seconds = frames / F, coded = ['-frames:v', String(frames), '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '15', '-pix_fmt', 'yuv420p', part];
  /*
   * The takes are full-range pictures (they are filmed as JPEGs), and the film is marked so. Black made in the narrower broadcast range
   * is then shown as dark gray, so what is made here is made full-range: black is 0.
   */
  const full = ['-frames:v', String(frames), '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '15', '-pix_fmt', 'yuvj420p', '-color_range', 'pc', part];
  if (take === 'black') run(['-f', 'lavfi', '-i', `color=c=black:s=1920x1080:r=${F},format=gray,geq=lum=0,format=yuvj420p`, ...full], 'make black');
  else run(['-i', src, '-vf', `trim=start_frame=${a}:end_frame=${b},setpts=(PTS-STARTPTS)/${speed},fps=${F},scale=1920:1080:flags=lanczos,setsar=1,format=yuv420p`, ...coded], `trim ${take}`);
  parts.push(part);
  if (extra.music === 'start') musicAt = t + (extra.hit - a) / speed / F;
  if (extra.music === 'stop') musicEnds = t;
  for (const snd of extra.sounds ?? []) sounds.push({ ...(MADE[snd.file] ?? { file: `${SOUNDS}/${snd.file}`, volume: 1.6 }), at: t + (snd.at ?? 0) });
  for (const frame of extra.clicks ?? []) sounds.push({ ...MADE.click, at: t + (frame - a) / speed / F });
  console.log(`${t.toFixed(2).padStart(6)}s  ${take} ${a}-${b}${Math.abs(speed - 1) < 0.005 ? '' : ` x${speed.toFixed(2)}`}  (${seconds.toFixed(2)}s)${note}`);
  t += seconds;
}
console.log(`${t.toFixed(2).padStart(6)}s  end; music from ${musicAt?.toFixed(2)}s to ${musicEnds?.toFixed(2)}s; ${moved} cuts moved to a beat`);

writeFileSync(`${TMP}/list.txt`, parts.map((p) => `file '${p.slice(TMP.length + 1)}'`).join('\n'));
run(['-f', 'concat', '-safe', '0', '-i', `${TMP}/list.txt`, '-c', 'copy', `${TMP}/picture.mp4`], 'join the cuts');

/* The sound: the music from its start, cut off dead where the title lands, and each other sound where its cut puts it. */
const inputs = ['-i', `${TMP}/picture.mp4`], filters = [], mix = [];
if (musicAt !== null && existsSync(music)) {
  inputs.push('-i', music);
  const length = (musicEnds ?? t) - musicAt;
  filters.push(`[1:a]atrim=0:${length.toFixed(3)},afade=t=out:st=${(length - 0.02).toFixed(3)}:d=0.02,adelay=${Math.round(musicAt * 1000)}:all=1,volume=1.4[m]`);
  mix.push('[m]');
} else console.log(`no music: ${music} is not there, or no cut starts it`);
for (const [n, s] of sounds.entries()) {
  inputs.push('-i', s.file);
  filters.push(`[${inputs.filter((x) => x === '-i').length - 1}:a]aresample=48000,adelay=${Math.round(s.at * 1000)}:all=1,volume=${s.volume}[s${n}]`);
  mix.push(`[s${n}]`);
}
filters.push(`${mix.join('')}amix=inputs=${mix.length}:normalize=0:duration=longest,alimiter=limit=0.95,apad=whole_dur=${t.toFixed(3)}[a]`);
run([...inputs, '-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-t', t.toFixed(3), '-movflags', '+faststart', out], 'lay the sound under the picture');
console.log(`wrote ${out}: ${t.toFixed(1)}s`);

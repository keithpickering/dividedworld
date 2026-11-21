/**
 * The title cards, T1 to T9 (docs/plans/2026-11-14-hype-video-storyboard.md): white words on black in the game's own display type, each
 * hitting the screen a little large and settling, as a trailer's cards do.
 *
 *   node tools/hype/shot-cards.mjs [--only id,id] [--port 4319]
 *
 * The cards are drawn on the stage's own page, over everything, so the type is the glass's display face as the game loads it and no
 * font is named here. Each is filmed for two seconds; the edit takes what it needs.
 *
 * Writes .runs/hype/card-<id>.mp4.
 */
import { openFilm } from './camera.mjs';
import { OUT, flag, openStage, settle } from './stage.mjs';

/*
 * A card: its words (a line break is a new line), and how large its type is, as a share of the view's height. A card with `fade` comes
 * up out of black over that many seconds instead of hitting (and with `out` goes back down into it over that many, at its end), and one
 * with `seconds` is filmed for that long instead of two. A card with `tape` has a strip of Autocorrect's masking tape unrolled over one
 * of its words (`over`), saying another (`says`), from `at` frames in. The strip is the game's own: an Autocorrect is landed on a post of
 * the stage, and the strip it makes there is copied onto the card at the card's size.
 */
export const CARDS = {
  't1a': { words: 'IN A WORLD.', size: 0.2 },
  't1b': { words: 'DIVIDED.', size: 0.26 },
  't2': { words: 'EVERYONE WEARS\nA MASK.', size: 0.17 },
  't3a': { words: 'NO ONE KNOWS\nWHO YOU ARE.', size: 0.17 },
  /* The owner's (2026-11-14): partway through, an Autocorrect strip is unrolled over FRIENDS, and the card ends as "ESPECIALLY YOUR ENEMIES". */
  't3b': { words: 'ESPECIALLY\nYOUR FRIENDS.', size: 0.17, tape: { over: 'FRIENDS', says: 'ENEMIES', at: 18 } },
  't4a': { words: '52 CARDS.', size: 0.26 },
  't4b': { words: 'ALL OF THEM\nA BAD IDEA.', size: 0.17 },
  't5': { words: 'THE STAFF.', size: 0.24 },
  't6': { words: 'EVERY REIGN ENDS.', size: 0.15 },
  /* The title is the board's own logo, as the banner sets it (the owner, 2026-11-14: all caps Verdana, how it shows on the real board). */
  't7': { words: 'DIVIDED WORLD', size: 0.13, logo: true },
  't8': { words: 'dw.gripe\nBY INVITATION ONLY', size: 0.1 },
  't9': { words: 'CARD SUBJECT TO CHANGE.', size: 0.055 },
  /* The last words (the owner, 2026-11-14): not a hit but a slow fade up out of black, as a trailer's "Coming this summer" comes. */
  't10': { words: 'After nine years in development', size: 0.075, fade: 3, out: 2.6, seconds: 8.6 },
};

if (import.meta.url === `file:///${process.argv[1].replace(/\\/gu, '/')}` || process.argv[1].endsWith('shot-cards.mjs')) {
  const only = flag('only', '').split(',').filter(Boolean);
  const cam = await openStage({ css: { width: 1280, height: 720 }, quiet: ['toasts', 'host'] });
  try {
    await settle(cam, 40);
    /* The card's sheet of black, and its words in the glass's display face (read from the HUD, which is set in it). */
    await cam.evaluate(`(() => {
      const face = getComputedStyle(document.querySelector('.kb-hud-hand') ?? document.body).fontFamily;
      const card = document.createElement('div');
      card.id = 'kb-hype-card';
      Object.assign(card.style, { position: 'fixed', inset: '0', zIndex: '2147483000', background: '#000', display: 'grid', placeItems: 'center' });
      const words = document.createElement('div');
      Object.assign(words.style, { color: '#fff', fontFamily: face, fontWeight: '700', textAlign: 'center', lineHeight: '1.02', letterSpacing: '0.02em', whiteSpace: 'pre', willChange: 'transform' });
      card.append(words);
      document.documentElement.append(card);
      /* The banner's logo: its own face, weight and spacing, read off the page; Verdana is named first, as the owner asked, wherever the page's own face is another. */
      const logo = getComputedStyle(document.querySelector('.kb-logo') ?? document.body);
      window.__logo = { family: logo.fontFamily, weight: logo.fontWeight, spacing: logo.letterSpacing, size: logo.fontSize };
      window.__card = (text, px, scale, opacity, asLogo) => {
        if (words.dataset.text !== text) { words.textContent = text; words.dataset.text = text; }
        words.style.fontSize = px + 'px'; words.style.transform = 'scale(' + scale + ')'; words.style.opacity = String(opacity);
        words.style.fontFamily = asLogo ? (/verdana/iu.test(logo.fontFamily) ? logo.fontFamily : 'Verdana, Geneva, sans-serif') : face;
        words.style.fontWeight = asLogo ? logo.fontWeight : '700';
        words.style.letterSpacing = asLogo ? (parseFloat(logo.letterSpacing) / parseFloat(logo.fontSize) || 0.09) + 'em' : '0.02em';
        words.style.textTransform = asLogo ? 'uppercase' : 'none';
      };
    })()`);
    /*
     * The strip: a real Autocorrect on the stage's "friends" post, made before the page's time is the film's, and a way to put a copy
     * of it over a word of the card. `__tape(over)` wraps the word and hangs the copy on its middle, scaled so the strip covers the
     * word; `__tapeAt(p)` shows it: hidden below 0, and from 0 to 1 it is unrolled across the word.
     */
    const taped = Object.values(CARDS).find((c) => c.tape);
    if (taped) {
      await cam.evaluate(`(async () => {
        const { fake, cast, thread, scenes } = window.__kbStage;
        const [act] = await fake.acts(thread, scenes.friends, scenes.friends);
        fake.seed.card(cast['D-Guy'], act.id, 'autocorrect', { layer: 1, live: true, config: { phrase: ${JSON.stringify(taped.tape.over.toLowerCase())}, replacement: ${JSON.stringify(taped.tape.says)} }, message: '' });
        document.querySelector('#post-' + scenes.friends).scrollIntoView({ block: 'center' });
      })()`);
      await cam.until(`Boolean(document.querySelector('#post-' + window.__kbStage.scenes.friends + ' .dw-ac-tape'))`, { label: 'the strip of tape made on the stage' });
      await settle(cam, 60);
      await cam.evaluate(`(() => {
        const words = document.querySelector('#kb-hype-card > div');
        window.__tape = (over) => {
          const text = words.textContent, i = text.indexOf(over);
          const word = document.createElement('span');
          word.textContent = over;
          Object.assign(word.style, { position: 'relative', display: 'inline-block' });
          words.textContent = '';
          words.append(text.slice(0, i), word, text.slice(i + over.length));
          /*
           * The strip is one piece of the effect's layer over the post: its paper is a canvas, and its writing is a line of type on it.
           * The copy is the piece alone, in a layer of its own that carries the effect's colors, with the paper drawn across (a copied
           * canvas is blank), hung by its middle on the middle of the word.
           */
          const layer = document.querySelector('#post-' + window.__kbStage.scenes.friends + ' .dw-ac-tape'), piece = layer.querySelector('.dw-ac-piece');
          const t = piece.getBoundingClientRect(), from = getComputedStyle(layer);
          const hang = document.createElement('span');
          Object.assign(hang.style, { position: 'absolute', left: '50%', top: '53%', width: '0', height: '0', fontFamily: from.fontFamily, fontSize: from.fontSize, fontWeight: from.fontWeight, lineHeight: from.lineHeight, letterSpacing: 'normal', textTransform: 'none', whiteSpace: 'normal', textAlign: 'left', color: from.color });
          const copy = document.createElement('div');
          copy.className = 'dw-ac-tape';
          copy.style.cssText = layer.style.cssText;
          Object.assign(copy.style, { position: 'absolute', inset: 'auto', left: -t.width / 2 + 'px', top: -t.height / 2 + 'px', width: t.width + 'px', height: t.height + 'px', transformOrigin: '50% 50%' });
          const strip = piece.cloneNode(true);
          Object.assign(strip.style, { left: '0px', top: '0px' });
          const papers = piece.querySelectorAll('canvas');
          strip.querySelectorAll('canvas').forEach((c, n) => { c.getContext('2d').drawImage(papers[n], 0, 0); });
          copy.append(strip);
          hang.append(copy);
          word.append(hang);
          /*
           * As tall as the word's capitals and a little more, which makes it longer than the word: it starts a little before the word's
           * first letter, so the word before is left alone, and runs on past the last, over the full stop.
           */
          const fit = (word.offsetHeight * 0.86) / t.height;
          hang.style.left = (fit * t.width) / 2 - 12 + 'px';
          /*
           * It goes on as the author's peel takes it off, run backward (the owner, 2026-11-14): a roll of tape travels along the word and
           * the strip is laid behind it. The roll is the effect's own (its dw-ac-roll, a cylinder lying across the strip, as thick as the
           * tape it still holds: tape.ts's rollDiameter), and the strip's paper and writing are masked to what has been laid.
           */
          const body = strip.querySelector('.dw-ac-body'), roll = document.createElement('div'), length = parseFloat(piece.style.width) || t.width;
          roll.className = 'dw-ac-roll';
          strip.append(roll);
          copy.style.transform = 'rotate(-1.6deg) scale(' + fit + ')';
          window.__tapeAt = (p) => {
            hang.style.opacity = p < 0 ? '0' : '1';
            const u = Math.min(1, Math.max(0, p)), laid = (1 - (1 - u) ** 2.2) * length, held = length - laid, thick = Math.sqrt(9 + 0.55 * held);
            body.style.clipPath = 'inset(-3px ' + held + 'px -3px -3px)';
            Object.assign(roll.style, { left: laid - thick * 0.28 + 'px', width: thick + 'px', display: u >= 1 ? 'none' : 'block' });
          };
          window.__tapeAt(-1);
          return { strip: { w: t.width, h: t.height }, word: { w: word.offsetWidth, h: word.offsetHeight }, fit };
        };
      })()`);
    }
    await cam.evaluate(`window.__card('', 10, 1, 0)`);
    console.log("the banner's logo is set in:", await cam.evaluate('window.__logo'));
    await settle(cam, 10);
    console.log(`the clocks are ${(await cam.freeze()).toFixed(2)}ms apart`);
    const F = cam.fps, n = 2 * F;
    for (const [id, card] of Object.entries(CARDS)) {
      if (only.length && !only.includes(id)) continue;
      const film = openFilm({ path: `${OUT}/card-${id}.mp4`, fps: F });
      const frames = card.seconds ? Math.round(card.seconds * F) : n;
      for (let f = 0; f < frames; f++) {
        /* In over six frames from a fifth too large, then a slow push in for as long as it is held; or, for a fade, up out of black with only the push. */
        const hit = Math.min(1, f / 6), ease = 1 - (1 - hit) ** 3;
        const scale = card.fade ? 1 + 0.03 * (f / frames) : 1.2 - 0.2 * ease + 0.035 * (f / frames);
        const up = Math.min(1, f / (card.fade * F)), down = card.out ? Math.min(1, (frames - 1 - f) / (card.out * F)) : 1;
        const opacity = card.fade ? up * up * (3 - 2 * up) * down * down * (3 - 2 * down) : Math.min(1, f / 2);
        await cam.evaluate(`window.__card(${JSON.stringify(card.words)}, ${Math.round(cam.css.height * card.size)}, ${scale.toFixed(4)}, ${opacity.toFixed(3)}, ${card.logo ? 'true' : 'false'})`);
        if (card.tape) {
          if (f === 0) console.log('the strip on the card:', JSON.stringify(await cam.evaluate(`window.__tape(${JSON.stringify(card.tape.over)})`)));
          await cam.evaluate(`window.__tapeAt(${((f - card.tape.at) / 15).toFixed(3)})`);
        }
        await film.write(await cam.frame(true));
      }
      await film.end();
      console.log(`card ${id}: ${card.words.replace(/\n/gu, ' / ')}`);
    }
  } finally {
    await cam.close();
  }
}

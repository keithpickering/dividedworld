/**
 * What every shot on the stage does first: open the camera on the stage story in its costume, wait for it to be drawn, quiet what the
 * shot does not want in frame, and put the parts the other players play on the page as `window.__shot`.
 * (The stage: instances/divided-world/ui/hype/Stage.board.stories.tsx. The storyboard: docs/plans/2026-11-14-hype-video-storyboard.md.)
 */
import { mkdirSync } from 'node:fs';
import { openCamera } from './camera.mjs';
import { flag } from './cutting.mjs';

export const OUT = '.runs/hype';

/* The sprite sheet in Snuckles's first post (the owner's own, his first submission, from 2005): the address the post names, and the file the camera answers it with. */
export const SERVE = { 'https://dw.gripe/hype/wiggler-sheet.gif': { file: 'instances/divided-world/ui/hype/wiggler-sheet.gif', type: 'image/gif' } };

export { flag };

/** Whether the target post's ink is built: a picture held for each live layer in each band near the viewport (e2e/whoops.spec.ts waits the same way). */
export const BUILT = `(() => {
  const el = document.querySelector('#post-' + window.__kbStage.target.seq + ' .kb-whoops');
  if (!el) return false;
  const bands = (el.getAttribute('data-kb-bands') ?? '').split(' ').filter(Boolean).length;
  const live = (el.getAttribute('data-kb-layers') ?? '').split(' ').filter((l) => l === 'live').length;
  return bands > 0 && Number(el.getAttribute('data-kb-pictures')) === live * bands;
})()`;

/**
 * Opens the stage, in `skin`, signed in as the player of the character `as` names (Snuckles's when it names none). `quiet` names what is taken out of frame: `toasts`, `host` (the address in the banner, which is the preview server's; hidden by a style rule, so it stays hidden across the stage's in-place navigation)
 * `hud` (the glass along the foot, for a shot tight on a post) and `selection` (the post's words cannot be selected: a drag that outlives
 * its stroke, because the coat it was washing came clean under it, selects the words it passes over, and opens the quote button).
 *
 * @param {{ skin?: string, as?: string | null, view?: string | null, css?: { width: number, height: number }, scale?: number, quiet?: string[], port?: number }} [options]
 */
export async function openStage({ skin = 'default', as = null, view = null, css, scale = 2, quiet = ['toasts', 'host'], port = Number(flag('port', 4319)) } = {}) {
  mkdirSync(OUT, { recursive: true });
  const cam = await openCamera({ url: `http://localhost:${port}/?fixture=boards&story=boards-hype-stage--main&sheet=1&skin=${skin}${as ? `&as=${encodeURIComponent(as)}` : ''}${view ? `&view=${encodeURIComponent(view)}` : ''}`, css, scale, serve: SERVE });
  await cam.until(view && !view.startsWith('thread') ? `Boolean(window.__kbStage && document.querySelector('main h1, main table, main article'))` : `Boolean(window.__kbStage && document.querySelector('article.kb-act'))`, { label: 'the stage drawn' });
  /* Hidden through the CSSOM (the page's CSP takes no style sheet), by a rule of its own so what comes later is hidden too. */
  await cam.evaluate(`(() => {
    const quiet = ${JSON.stringify(quiet)};
    const sheet = new CSSStyleSheet();
    if (quiet.includes('toasts')) sheet.insertRule('.kb-toasts { display: none !important; }');
    if (quiet.includes('selection')) sheet.insertRule('.kb-act-main, .kb-act-main * { user-select: none !important; }');
    if (quiet.includes('hud')) sheet.insertRule('.kb-hud-glass { display: none !important; }');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    /* A post's pictures are pixel art, shown pixel for pixel, and are all loaded before a film starts, so none arrives during it and moves the page. */
    sheet.insertRule('.kb-bb-img { image-rendering: pixelated; }');
    for (const img of document.querySelectorAll('img.kb-bb-img')) img.loading = 'eager';
    /* The address is hidden by a rule, not by a style on the element it is now: the stage's in-place navigation (\`__shot.show\`) draws the banner afresh, and an element hidden by hand comes back visible. */
    if (quiet.includes('host')) sheet.insertRule('.kb-address-text { visibility: hidden !important; }');
  })()`);
  await cam.until(`[...document.querySelectorAll('img.kb-bb-img')].every((i) => i.complete && i.naturalWidth > 0)`, { label: "the posts' pictures loaded" });
  /* The parts the other players play, and what the rounds before a shot left on the post. */
  await cam.evaluate(`(() => {
    const { fake, target, cast, whoops, play, nodes, camera } = window.__kbStage;
    let post = '#post-' + target.seq, targetAct = target.act;
    /* The commentary video's parts hold on any screen of the stage: the Staff's beats are filmed on a board's index and a profile, which have no post. */
    const parts = {
      /*
       * The commentary video's parts (docs/plans/2026-11-21-commentary-video-plan.md, Tasks 4 and 8a). Each is the stage's own (instances/divided-world/ui/hype/stage-play.ts),
       * which plays the backend's real action as the player it names, so a reaction is scored, a cast is caught or rides, and a refusal throws in the server's words.
       * A post is named by its number in the thread (\`__kbStage.posts\` and \`__kbStage.scenes\`), a character by its name (the cast's, and the crowd's: \`__kbStage.crowd\`).
       */
      /** A reaction by a character of the cast or the crowd, as its player: \`react('Serious Deer', 14, 'tomato')\`. Scores a Heel's forecast through the instance's own class rule. */
      react: (name, postSeq, key) => play.react(name, postSeq, key),
      /** A card cast on a post through the backend's own play path, so a back there catches it or lets it ride: returns \`{ play, caught, rode }\`. */
      cast: (name, postSeq, card, config = {}, message = '') => play.cast(name, postSeq, card, config, message),
      /** The alert a caught cast writes its caster (the in-memory backend writes none): \`told('Hotel Bro', 1)\`, after the cast. Returns the caught play's id. */
      told: (name, postSeq) => play.told(name, postSeq),
      /** A REAL quote of the post (the whole post in a quote tag, then \`words\`, which must say "to be fair"), written by the named character, which springs the Steel Chair set on it: returns \`{ post, spring, play }\`. */
      quoteSprings: (name, postSeq, words) => play.quoteSprings(name, postSeq, words),
      /**
       * A FORGED quote of a post, as the composer writes it: \`forgedQuote('D-Guy', 2, forgedWords, comment)\`. It springs nothing (the rules write a post whose quote is forged with no target, so no back springs):
       * the chair on post 2 stays face down. Refuses words that stand in the post. Returns \`{ post, seq, forged }\`. A shot films it through the real composer instead (see shot notes in the design, section 9):
       * the Quote button on the post, ArrowLeft nine times (the newline and \`[/quote]\`), Backspace over the words after "Only a few among us ", the forged words, ArrowRight nine times, the comment, Send.
       */
      forgedQuote: (name, postSeq, forgedWords, comment) => play.forgedQuote(name, postSeq, forgedWords, comment),
      /** The spring and landed Move for a quoting post written some other way (the real composer): \`springsOn(2, actId)\` springs the Steel Chair set on post 2 onto that post, only where it quotes post 2 for real (a target) and says "to be fair" outside the quote; a forged quote is refused. Returns \`{ spring, play }\`. */
      springsOn: (quoted, quoting) => play.springsOn(quoted, quoting),
      /**
       * The Staff's beats (stage-play.ts, every word a line of the rehearsal's, staff-lines.json): call them as \`staff('merge')\` or \`staff.merge()\`. A thread a beat makes is named in its result
       * (\`key\`), to be shown with \`show('thread:' + key)\`. A Mod is \`'qc'\` (QC-1000) or \`'ontopic'\` (ONTOPIC 5.0); a post is named by its number in the thread.
       *   memo(where = 'main', key = 'memo')            the Boss's memo: key memo, orderNoAllowance, orderHoneymoon or orderQuote
       *   merge() / created(name?) / moved()            the Boss's move notices, each with his reason; moved() returns { move, thread }
       *   file(postSeq = 1)                             a Mod files a post of the main thread (round 1's beat, now with real words)
       *   visit(mod, postSeq | null, { quiz, line, by })  a visit opens: with null, on a post of a thread of the board the opener names; quiz asks the fixture's quiz. Returns { thread, key, post, seq, visit, line, board }
       *   hallPass(postSeq | null, { mod, by, hold })   the author sets a real Hall Pass; a visit begins and it springs. Returns that plus { set, spring }; with hold the spring waits for springPass(set, visit)
       *   filing(mod, postSeq | null, key, { by, hold })  (hold: the visit stays open until endFiling(key, visit) files it)  the filing's aimed-at post is written (null) and filed; key is filingQcHelp, filingQcGames, filingQcGotcha, filingOtThematic, filingOtPatience or filingOtPalace. Adds { infraction }
       *   report(name, postSeq)                         names what to press for a report; the film's player must be name (\`as=name\`), and not the post's author. Returns { seq, press }
       *   appeal(name, key = 'filingQcHelp')            a filing against name's own post, appeal still to make; the film's player must be name (\`as=name\`). Returns the filing's and { press }
       *   review(key)                                   ONTOPIC 5.0's review: stars or fiveStars. Returns { thread, post, key }; { hold: true } leaves the review out, for say()
       *   say(who, where, key)                          a Staff line (staff-lines.json) posted live as fangame, qc or ontopic in a thread (a key of the stage's threads, or review's key). Returns the Act
       *   handover()                                    FanGaME leaves, QC-1000 takes the seat: the farewell and the arrival in the announcements. Returns { farewell, arrival, note, thread }
       */
      staff: Object.assign((key, ...args) => { if (!play.staff[key]) throw new Error('there is no staff beat "' + key + '": the beats are ' + Object.keys(play.staff).join(', ')); return play.staff[key](...args); }, play.staff),
      /** One step of node 9's pile on Snuckles's first post, in order (\`pileSteps\` names them): the first call is step 0. Returns the step's name. */
      pile: (step) => play.pile(step),
      pileSteps: play.steps,
      /** The order the film lands the pile in (stage-play.ts's FILM_ORDER): { n09: [...], n11: { chairs, heap } }. */
      pileOrder: play.order,
      /** You Were Saying? lands on the stage's post that is the true pair of the card's real tail (\`posts.gpt2\`, or \`postSeq\`), and the tail (gpt2-tail.txt, 1373 characters) types in under it. Returns the play's Act. */
      gpt2: (postSeq) => play.gpt2(postSeq),
      /**
       * One character's leaving post (the owner's words, 2026-11-22), live at the thread's foot, as that character: \`leave('Snuckles')\`. \`leaving\` is the five in the film's order: Snuckles, Hotel Bro,
       * Serious Deer, D-Guy, Chadluminum. Returns \`{ post, seq, page, shown, held }\`: the post's Act, its number (the first is 26) and page (20 posts a page, so page 2), whether the page SHOWED it (waits up to \`wait\` ms, 1000 by default)
       * and whether the "N new posts" bar (\`.kb-new-bar\`) is up. A live post is shown only to a reader on the thread's LAST page and at its foot: before the first call, move to page 2 (click "Jump to latest" in the pager, or
       * \`history.replaceState(null, '', '/t/' + thread + '?page=2')\` then \`show('thread')\`), scroll to the foot, and scroll to the foot again after each call (the post slides in below the reader). Where \`shown\` is false the post waits behind the bar.
       */
      leave: (name, options) => play.leave(name, options),
      leaving: play.leaving,
      /** The pending Aura the orbs' ghost shows now for the film's player, in signed hundredths: what a take reads to prove the forecast moved. */
      forecast: () => play.forecast(),
      /** A commentary node hung at a point of the window as it is now (it stays at that place of the page, and scrolls with it); returns its id. */
      node: (x, y) => nodes.add(x + scrollX, y + scrollY),
      /** The nodes now, each with its place in the window (read only while the board is level): \`[{ id, x, y, started }]\`. */
      nodes: () => nodes.list().map((n) => ({ id: n.id, x: n.x - scrollX, y: n.y - scrollY, started: n.started })),
      clearNodes: () => nodes.clear(),
      /** Turns the board in space for the next frame: degrees about each axis, \`z\` px toward the viewer, a scale. Turn only while no pointer press is in progress, and read no element's place while turned. */
      turn: (t = {}) => camera.turn(t),
      /** The board plain again: no transform, no wrapper style. */
      level: () => camera.level(),
      /** The beats that landed, each \`{ what, ms, frame }\` from \`zero()\` (the page's virtual clock, a frame at 60 a second): the edit puts each on an entry of the theme. */
      landed: play.landed,
      /** Shows another screen of the stage in place, drawn afresh from what the fake holds now (no reload): \`show('profile:fangame')\`, \`show('index')\`, \`show('thread')\`. */
      show: (view) => window.__kbStage.show(view),
      /** Puts another skin on the page in place, as the player's own preference: skin('midnight'). */
      skin: (key) => window.__kbStage.skin(key),
      /** Starts the beats' clock: call it as the film starts, so \`landed\`'s frames count from the first frame. */
      zero: () => play.zero(),
    };
    if (!document.querySelector(post)) { window.__shot = { ...parts }; return; }
    const body = () => { const r = document.querySelector(post + ' .kb-act-main').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
    const saved = async (play, effect) => { const r = await fake.saveEffect(play, target.character, effect); if (!r.ok) throw new Error('the wash was refused: ' + r.error); };
    window.__shot = {
      /** A Whoops! on the post by the named character, on top of what is there. Returns the play. */
      splat(layer, name, color, seed, message, live = true) {
        fake.clock.advance(60000);
        return fake.seed.card(cast[name], targetAct, 'whoops', { layer, config: { color, seed }, message, live });
      },
      /** A coat washed clean, as its author saves one. */
      clean: (play) => saved(play, { strokes: [], clean: true }),
      /**
       * A coat mostly washed, as its author would have left it: \`passes\` passes along every row of the body, but for \`keep\`
       * (a patch in shares of the body: x0, x1, y0, y1), which is left as thick as it landed.
       */
      wash(play, passes, keep) {
        const b = body(), where = whoops.brushOf(whoops.BRUSH_PX, { w: b.w, h: b.h }), step = where.width * where.aspect * 0.7, strokes = [];
        for (let y = 0.03; y < 0.98; y += step) {
          /* The patch is a blob, not a box: widest across its middle, ragged at its sides. */
          let spans = [[0, 1]];
          if (keep && y > keep.y0 && y < keep.y1) {
            const mid = (keep.x0 + keep.x1) / 2, half = ((keep.x1 - keep.x0) / 2) * Math.sqrt(Math.sin(Math.PI * (y - keep.y0) / (keep.y1 - keep.y0)));
            spans = [[0, mid - half * (0.85 + 0.3 * Math.abs(Math.sin(y * 91)))], [mid + half * (0.85 + 0.3 * Math.abs(Math.sin(y * 57))), 1]];
          }
          for (const [x0, x1] of spans) for (let p = 0; p < passes; p++) strokes.push(whoops.packStroke({ tool: 'wash', ...where, points: p % 2 ? [[x1, y], [x0, y]] : [[x0, y], [x1, y]] }));
        }
        return saved(play, { strokes });
      },
      state() {
        const el = document.querySelector(post + ' .kb-whoops');
        return { layers: el?.getAttribute('data-kb-layers') ?? null, pictures: el?.getAttribute('data-kb-pictures') ?? null, inks: document.querySelectorAll(post + ' canvas.kb-whoops-ink').length };
      },
      body,
      /** Aims the ink helpers (splat, ink, inkAt, place, body, state) at another post than the round 1 target: aim(1, __kbStage.acts.first). */
      aim(seq, act) { post = '#post-' + seq; targetAct = act; },
      /**
       * Where the ink is, as a hand's eye sees it: the body cut into cells \`cols\` across, and for each the coat on top there (its layer,
       * or -1 where the words show) and how thick it lies (0 to 1). Each coat's canvases are read at their own place and scale.
       */
      ink(cols = 28) {
        const b = body(), size = b.w / cols, rows = Math.max(1, Math.round(b.h / size));
        const top = new Array(cols * rows).fill(-1), thick = new Array(cols * rows).fill(0);
        const coats = [...document.querySelectorAll(post + ' canvas.kb-whoops-ink')].sort((p, q) => Number(p.dataset.kbLayer) - Number(q.dataset.kbLayer));
        for (const c of coats) {
          const r = c.getBoundingClientRect(), k = c.width / r.width, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
            let sum = 0, n = 0;
            for (const [fx, fy] of [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]]) {
              const px = Math.floor((b.x + (i + fx) * size - r.left) * k), py = Math.floor((b.y + (j + fy) * (b.h / rows) - r.top) * k);
              if (px < 0 || py < 0 || px >= c.width || py >= c.height) continue;
              sum += d[(py * c.width + px) * 4 + 3] / 255; n++;
            }
            if (n > 0 && sum / n > 0.12) { top[j * cols + i] = Number(c.dataset.kbLayer); thick[j * cols + i] = sum / n; }
          }
        }
        return { cols, rows, top, thick };
      },
      /** Whether there is ink under a point of the page, exactly: any coat's canvas, read at its own place and scale. */
      inkAt(x, y) {
        for (const c of document.querySelectorAll(post + ' canvas.kb-whoops-ink')) {
          const r = c.getBoundingClientRect();
          if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) continue;
          const k = c.width / r.width;
          if (c.getContext('2d').getImageData(Math.floor((x - r.left) * k), Math.floor((y - r.top) * k), 1, 1).data[3] > 90) return true;
        }
        return false;
      },
      /** Scrolls the page so the post's body starts \`y\` px down the view: every round of a gag is framed alike. */
      place(y) { document.querySelector(post).scrollIntoView({ block: 'center' }); scrollBy(0, body().y - y); return body(); },
      /** The card's first-time tip, answered: the film's player has met this card. */
      met() { [...document.querySelectorAll('.kb-callout button')].find((b) => b.textContent.trim() === 'Got it')?.click(); },

      ...parts,
    };
  })()`);
  return cam;
}

/** Frames on the wall clock, with nothing filmed: for the page to settle before the film starts. */
export async function settle(cam, frames = 60) {
  for (let i = 0; i < frames; i++) { await cam.frame(false); await new Promise((r) => { setTimeout(r, 10); }); }
}

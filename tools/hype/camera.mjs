/**
 * The hype video's camera: a headless Chromium whose frames this script asks for one at a time, so a shot is 60 frames for every second
 * of the page's own time however long each frame takes to draw. Nothing is screen-recorded, so nothing drops a frame.
 *
 *  - The browser is started with begin-frame control, and its page is made with it: no frame is drawn until one is asked for
 *    (HeadlessExperimental.beginFrame), and each is handed back as a picture.
 *  - The page's clock is virtual (Emulation.setVirtualTimePolicy): before each frame it is given one frame's worth of time, so timers,
 *    `Date`, `performance.now` and requestAnimationFrame all move at the film's pace.
 *  - The pointer is the page's real one (Input.dispatchMouseEvent), with a drawn arrow following it, since a headless page draws none.
 *
 * A proof (the owner asked for one shot end to end). It uses the Chromium Playwright already installed and downloads nothing.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { homedir, tmpdir, uptime } from 'node:os';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** Where Playwright keeps its browsers on this machine, in the order they are tried. */
export function browserRoots(env = process.env, home = homedir()) {
  return [
    ...(env.PLAYWRIGHT_BROWSERS_PATH ? [env.PLAYWRIGHT_BROWSERS_PATH] : []),
    '/opt/pw-browsers',
    ...(env.LOCALAPPDATA ? [join(env.LOCALAPPDATA, 'ms-playwright')] : []),
    join(home, '.cache', 'ms-playwright'),
  ];
}

/** The headless shell under the first of `roots` that holds one, newest build first; throws naming every root looked in. */
export function findHeadlessShell(roots, platform = process.platform) {
  const exes = platform === 'win32' ? ['chrome-headless-shell.exe', 'headless_shell.exe'] : ['chrome-headless-shell', 'headless_shell'];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    /* By build number, since as spelling "999" sorts after "1243". */
    const build = (d) => Number(d.slice('chromium_headless_shell-'.length)) || 0;
    const dirs = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort((a, b) => build(b) - build(a));
    for (const d of dirs) {
      for (const sub of readdirSync(join(root, d))) {
        for (const exe of exes) {
          const p = join(root, d, sub, exe);
          if (existsSync(p)) return p;
        }
      }
    }
  }
  throw new Error(`no chromium headless shell under ${roots.join(', ')}`);
}

const headlessShell = () => findHeadlessShell(browserRoots());

/** A CDP connection over one WebSocket, with flat sessions. */
class Cdp {
  constructor(ws) {
    this.ws = ws; this.next = 1; this.waiting = new Map(); this.listeners = new Set();
    ws.addEventListener('message', (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id !== undefined) {
        const w = this.waiting.get(msg.id); this.waiting.delete(msg.id);
        if (msg.error) w.reject(new Error(`${w.method}: ${msg.error.message}`)); else w.resolve(msg.result);
      } else for (const l of [...this.listeners]) l(msg);
    });
  }
  send(method, params = {}, sessionId) {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  once(method, sessionId) {
    return new Promise((resolve) => {
      const l = (msg) => { if (msg.method === method && (!sessionId || msg.sessionId === sessionId)) { this.listeners.delete(l); resolve(msg.params); } };
      this.listeners.add(l);
    });
  }
}

/** The size of a JPEG, from its first start-of-frame segment; null where the bytes hold none. */
export function jpegSize(buf) {
  for (let i = 2; i + 8 < buf.length && buf[i] === 0xff; ) {
    const marker = buf[i + 1], length = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
    i += 2 + length;
  }
  return null;
}

/** Refuses a frame whose picture is not `css` x `scale`: the frames a film is made of are the compositor's, and its size is what the browser was started with. */
export function checkFrameSize(buf, css, scale) {
  const got = jpegSize(buf), want = { width: Math.round(css.width * scale), height: Math.round(css.height * scale) };
  if (got && (got.width !== want.width || got.height !== want.height)) throw new Error(`the camera's frames are ${got.width} x ${got.height}, not the ${want.width} x ${want.height} that ${css.width} x ${css.height} at density ${scale} is: the film would be a smaller picture blown up`);
}

/**
 * Opens the camera on a page. `css` is the page's size in CSS px, `scale` its device pixel ratio: the frames are css × scale.
 * `serve` is files the camera answers for itself, by address ({ 'https://…': { file, type } }): a post shows a picture only from an
 * https address, and a film's picture is a file here, so the page asks for the address and the camera hands it the file.
 */
export async function openCamera({ url, css = { width: 1440, height: 810 }, scale = 2, fps = 60, dark = false, serve = {} }) {
  const profile = mkdtempSync(join(tmpdir(), 'kb-hype-'));
  const chrome = spawn(headlessShell(), [
    '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    /* The picture a frame hands back is the compositor's own surface, which the emulated device pixel ratio alone does not enlarge:
       without this the frames are `css` px however large `scale` is, and a film "at double density" is that picture blown up. */
    `--force-device-scale-factor=${scale}`,
    /* A container runs as root, which Chromium refuses to sandbox. */
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    '--enable-begin-frame-control', '--run-all-compositor-stages-before-draw', '--disable-new-content-rendering-timeout',
    '--disable-threaded-animation', '--disable-threaded-scrolling', '--disable-checker-imaging',
    '--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2', '--font-render-hinting=none', '--force-color-profile=srgb', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', '--mute-audio',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let err = '';
    chrome.stderr.on('data', (d) => { err += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(err); if (m) resolve(m[1]); });
    chrome.on('exit', (c) => reject(new Error(`chromium left with ${c}: ${err}`)));
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  const cdp = new Cdp(ws);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', width: css.width, height: css.height, enableBeginFrameControl: true });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const S = (method, params) => cdp.send(method, params, sessionId);
  await S('Page.enable'); await S('Runtime.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: css.width, height: css.height, deviceScaleFactor: scale, mobile: false });
  await S('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
  if (Object.keys(serve).length > 0) {
    await S('Fetch.enable', { patterns: Object.keys(serve).map((urlPattern) => ({ urlPattern })) });
    cdp.listeners.add((m) => {
      if (m.method !== 'Fetch.requestPaused' || m.sessionId !== sessionId) return;
      const held = serve[m.params.request.url];
      if (!held) { S('Fetch.continueRequest', { requestId: m.params.requestId }).catch(() => {}); return; }
      S('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: held.type }, { name: 'access-control-allow-origin', value: '*' }], body: readFileSync(held.file).toString('base64') }).catch(() => {});
    });
  }
  const errors = [];
  cdp.listeners.add((m) => {
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  });

  const sent = (p) => { p.catch((e) => { errors.push(String(e)); }); };
  const dt = 1000 / fps;
  /*
   * The frame clock, in ms of the machine's uptime, which is what the browser's own frame times are in: a frame time from long before
   * the browser's last one is not taken (the page's frame clock never runs backward), and the page's frame time then stands still.
   */
  const base = uptime() * 1000 + 5_000, wall = Date.now();
  let ticks = base;
  let virtual = false;
  let last = null;         // the last picture, kept for a frame with no damage
  let sized = false;
  let pointer = { x: -100, y: -100, down: false };

  /** One frame: a frame's worth of the page's time, then the draw; with `shoot`, the picture too. */
  async function frame(shoot) {
    if (virtual) {
      const done = cdp.once('Emulation.virtualTimeBudgetExpired', sessionId);
      await S('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: dt });
      /* The expiry is sometimes never announced when the machine is loaded (seen as a take that hangs for good): after 8 s the frame goes on, the page's time having been advanced all the same. */
      let timer;
      const late = await Promise.race([done.then(() => false), new Promise((r) => { timer = setTimeout(() => r(true), 8_000); })]);
      clearTimeout(timer);
      if (late) console.error('camera: the virtual time budget was never announced; going on');
    }
    /* Before the film starts the frame clock keeps the wall clock's pace, so it is never behind a frame time the browser has taken. */
    ticks = virtual ? ticks + dt : Math.max(ticks + dt, base + (Date.now() - wall));
    /*
     * A frame asked for with its picture, of a page on which nothing has changed since the last, is never answered once the page's time is
     * the film's: the browser has nothing to draw and waits for something. So each filmed frame changes one thing nobody can see, a
     * corner mark two px square whose tint moves between two values a thousandth apart.
     */
    if (shoot && virtual) {
      await S('Runtime.evaluate', { expression: `(() => { let m = document.getElementById('kb-hype-mark'); if (!m) { m = document.createElement('div'); m.id = 'kb-hype-mark'; Object.assign(m.style, { position: 'fixed', right: '0', bottom: '0', width: '2px', height: '2px', pointerEvents: 'none', zIndex: '2147483646' }); document.documentElement.append(m); } m.style.background = m.dataset.on ? 'rgba(0,0,0,0.004)' : 'rgba(0,0,0,0.008)'; if (m.dataset.on) delete m.dataset.on; else m.dataset.on = '1'; })()` });
    }
    const r = await S('HeadlessExperimental.beginFrame', { frameTimeTicks: ticks, interval: dt, noDisplayUpdates: false, ...(shoot ? { screenshot: { format: 'jpeg', quality: 96 } } : {}) });
    if (shoot && r.screenshotData) { last = Buffer.from(r.screenshotData, 'base64'); if (!sized) { checkFrameSize(last, css, scale); sized = true; } }
    return last;
  }

  const evaluate = async (expression) => {
    const r = await S('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };

  /** Draw frames on the wall clock (the page's time is real) until `expression` is true: for loading, before the film starts. */
  async function until(expression, { timeout = 60_000, label = expression } = {}) {
    const end = Date.now() + timeout;
    let ok = false;
    const poll = (async () => { while (!ok && Date.now() < end) { try { ok = Boolean(await evaluate(expression)); } catch { /* not yet */ } if (!ok) await sleep(100); } })();
    while (!ok && Date.now() < end) { await frame(false); await sleep(12); }
    await poll;
    if (!ok) throw new Error(`the page never came to: ${label}\n${errors.join('\n')}`);
  }

  await S('Page.navigate', { url });

  return {
    fps, dt, css, scale, errors, evaluate, until, frame,
    /** From here the page's time is the film's: it moves only when a frame is asked for. */
    async freeze() {
      await S('Emulation.setVirtualTimePolicy', { policy: 'pause' });
      virtual = true;
      /*
       * One clock: the time a frame is drawn at (what requestAnimationFrame hands its callback) must move with the page's
       * `performance.now()`, since code stamps a thing with one and ages it by the other (Whoops!'s suds: born at `performance.now()`,
       * aged by the frame's time). When the two ran apart (the frame clock stood still while the page's ran) the suds never aged, and
       * were never drawn. So the gap between them is measured over a few frames and must hold still, and be small: a couple of frames'
       * worth is a thing born a moment early, and no more.
       */
      const gap = async () => {
        /* Frames until the callback has run: a frame asked for before the page has heard the request runs no callback, and the answer would never come. */
        let got;
        const asked = evaluate('new Promise((r) => { requestAnimationFrame((t) => r(performance.now() - t)); })').then((v) => { got = v; });
        for (let i = 0; got === undefined && i < 600; i++) { await frame(false); if (got === undefined) await sleep(4); }
        if (got === undefined) throw new Error('the page ran no animation frame in 600 frames');
        await asked;
        return got;
      };
      /* A frame clock still behind the browser's is stepped ahead, further each try, until the page's frame time moves with it. */
      let first = 0, left = 0;
      for (let ahead = 0, tries = 0; ; ahead = ahead === 0 ? 1_000 : ahead * 4, tries++) {
        ticks += ahead;
        for (let i = 0; i < 4; i++) await frame(false);
        first = await gap();
        for (let i = 0; i < 4; i++) await frame(false);
        left = await gap();
        if (Math.abs(left - first) <= 1) break;
        if (tries === 8) throw new Error(`the frame's clock and the page's do not run together: ${first.toFixed(1)}ms apart, then ${left.toFixed(1)}ms`);
      }
      /*
       * They run together; now they are set to the same time. Neither clock goes backward, so the one behind is brought up: the frame
       * clock by a step ahead, the page's by a stretch of its own time with no frame drawn in it.
       */
      if (left > 0) ticks += left;
      else if (left < 0) {
        const done = cdp.once('Emulation.virtualTimeBudgetExpired', sessionId);
        await S('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: -left });
        await done;
      }
      for (let i = 0; i < 4; i++) await frame(false);
      left = await gap();
      if (Math.abs(left) > dt) throw new Error(`the frame's clock and the page's are ${left.toFixed(1)}ms apart after being set together`);
      return left;
    },
    /**
     * The page's time runs `ms` on with no frame drawn in it (a countdown that ticks by the minute is seen to tick in a take of seconds): its timers fire, and the frame clock moves
     * with it, so the page's time and the frame's stay one clock. Only after \`freeze()\`.
     */
    async skip(ms) {
      if (!virtual) throw new Error('skip: the page\'s time is not the film\'s yet');
      const done = cdp.once('Emulation.virtualTimeBudgetExpired', sessionId);
      await S('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: ms });
      await done;
      ticks += ms;
    },
    /** A drawn arrow that follows the pointer (the page's CSP takes no style sheet, so it is styled through the CSSOM). */
    async drawPointer() {
      await evaluate(`(() => {
        const a = document.createElement('div');
        a.id = 'kb-hype-pointer';
        Object.assign(a.style, { position: 'fixed', left: '0', top: '0', width: '22px', height: '32px', zIndex: '2147483647', pointerEvents: 'none', transform: 'translate(-100px,-100px)', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.55))' });
        const edge = document.createElement('div'), fill = document.createElement('div');
        const shape = 'polygon(0 0, 0 78%, 22% 60%, 40% 100%, 55% 93%, 38% 55%, 68% 55%)';
        Object.assign(edge.style, { position: 'absolute', inset: '0', background: '#fff', clipPath: shape });
        Object.assign(fill.style, { position: 'absolute', inset: '0', background: '#111', clipPath: shape, transform: 'scale(.78)', transformOrigin: '12% 30%' });
        a.append(edge, fill);
        document.documentElement.append(a);
        /* A drag that an element has captured sends pointer moves and no mouse moves, and a card that draws a tool of its own in the hand (Whoops!'s sponge) shows it while the button is down: the arrow follows both kinds of move and steps aside for the press. */
        const follow = (e) => { a.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'; };
        for (const type of ['mousemove', 'pointermove']) addEventListener(type, follow, { capture: true, passive: true });
        addEventListener('pointerdown', () => { a.style.opacity = '0'; }, { capture: true, passive: true });
        for (const type of ['pointerup', 'pointercancel']) addEventListener(type, () => { a.style.opacity = '1'; }, { capture: true, passive: true });
      })()`);
    },
    /* Input is delivered with a frame, so its answer comes only once the next frame is asked for: none of the three waits for it. */
    async move(x, y) {
      pointer = { ...pointer, x, y };
      sent(S('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: pointer.down ? 'left' : 'none', buttons: pointer.down ? 1 : 0, pointerType: 'mouse' }));
    },
    /** A turn of the wheel at the pointer: `dy` px down the page (up when it is less than 0). */
    async wheel(dy) {
      sent(S('Input.dispatchMouseEvent', { type: 'mouseWheel', x: pointer.x, y: pointer.y, deltaX: 0, deltaY: dy, button: 'none', buttons: 0, pointerType: 'mouse' }));
    },
    /** One key pressed and released on the focused field, as a keyboard makes it (keydown, input, keyup); a shot spaces the keys of a text over its frames itself. */
    key(char) {
      const NAMED = { Enter: { code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }, ArrowDown: { code: 'ArrowDown', windowsVirtualKeyCode: 40 }, ArrowUp: { code: 'ArrowUp', windowsVirtualKeyCode: 38 }, ArrowLeft: { code: 'ArrowLeft', windowsVirtualKeyCode: 37 }, ArrowRight: { code: 'ArrowRight', windowsVirtualKeyCode: 39 }, Backspace: { code: 'Backspace', windowsVirtualKeyCode: 8 }, Escape: { code: 'Escape', windowsVirtualKeyCode: 27 } };
      const named = NAMED[char];
      const down = named ? { key: char, ...named } : { key: char, text: char };
      sent(S('Input.dispatchKeyEvent', { type: named && !named.text ? 'rawKeyDown' : 'keyDown', ...down }));
      sent(S('Input.dispatchKeyEvent', { type: 'keyUp', key: down.key, ...(named ? { code: named.code, windowsVirtualKeyCode: named.windowsVirtualKeyCode } : {}) }));
    },
    async press() {
      pointer.down = true;
      sent(S('Input.dispatchMouseEvent', { type: 'mousePressed', x: pointer.x, y: pointer.y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' }));
    },
    async release() {
      pointer.down = false;
      sent(S('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pointer.x, y: pointer.y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' }));
    },
    async close() { try { await cdp.send('Browser.close'); } catch { /* gone */ } chrome.kill(); },
  };
}

/** An ffmpeg that takes the frames on its stdin and writes the film: H.264, scaled to `out` with Lanczos (a film at the frames' own size is not scaled in effect). */
export function openFilm({ path, fps, out = { width: 1920, height: 1080 }, preset = 'slow' }) {
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps), '-i', '-',
    '-vf', `scale=${out.width}:${out.height}:flags=lanczos`, '-c:v', 'libx264', '-preset', preset, '-crf', '14', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((resolve, reject) => { ff.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg left with ${c}`)))); });
  return {
    write: (jpeg) => new Promise((r) => { if (ff.stdin.write(jpeg)) r(); else ff.stdin.once('drain', r); }),
    end: async () => { ff.stdin.end(); await done; },
  };
}

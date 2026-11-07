// Writes the backfill boards (docs/research/2026-11-05-backfill/) as self-contained HTML files, in the two-worlds boards'
// own markup (docs/research/2026-10-29-two-worlds/11-settings.html): the same smoke filters, menu bar, display title,
// skewed controls and row rules, so a board here reads as one of that set. Run: node docs/research/2026-11-05-backfill/gen.mjs
// Each board is a function of nothing; its sample data is written into it. A reference for the look, not code to copy.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const CSS = `
body{margin:0}
a{color:inherit}a:hover{color:inherit;text-decoration:none}
a:focus-visible,button:focus-visible,input:focus-visible{outline:3px solid #ffffff;outline-offset:3px}
.tab{display:flex;align-items:center;min-height:52px;padding:0 20px;white-space:nowrap;transform:skewX(-10deg);text-decoration:none;font:800 21px 'Barlow Condensed',sans-serif;letter-spacing:2px;color:#e4def7}
button.tab{background:none;border:0;cursor:pointer}
.many .tab{padding:0 13px;letter-spacing:1.5px}
.most .tab{padding:0 10px;letter-spacing:1px}
.tab b{display:inline-block;transform:skewX(10deg);font-weight:800}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:52px;padding:0 26px;transform:skewX(-10deg);text-decoration:none;border:1px solid rgba(241,236,255,.6);background:none;cursor:pointer;font:800 21px 'Barlow Condensed',sans-serif;letter-spacing:2px;color:#f1ecff}
.btn b{display:inline-block;transform:skewX(10deg);font-weight:800}
.btn.primary{background:#19e3ff;border-color:#19e3ff;color:#03141a;box-shadow:0 0 18px rgba(25,227,255,.6)}
.btn.big{min-height:64px;padding:0 34px;font:400 30px Anton,Impact,sans-serif;letter-spacing:1px}
.btn.big b{font-weight:400}
.btns{display:flex;flex-wrap:wrap;gap:14px;align-items:center}
.lead{margin:0;max-width:680px;font:600 21px/1.5 'Barlow Condensed',sans-serif;color:#f1ecff}
.note{margin:12px 0 0;max-width:680px;font:500 21px/1.5 'Barlow Condensed',sans-serif;color:#e4def7}
.row{display:grid;grid-template-columns:230px 1fr;column-gap:32px;padding:24px 0;border-top:1px solid rgba(241,236,255,.22)}
.row h3,.k{margin:0;padding-top:12px;font:800 24px/1.1 'Barlow Condensed',sans-serif;letter-spacing:1.5px}
.field label{display:block;margin:0 0 10px;font:800 24px/1.1 'Barlow Condensed',sans-serif;letter-spacing:1.5px}
.field input[type=email],.field input[type=text]{box-sizing:border-box;width:100%;height:56px;padding:0 16px;background:rgba(18,12,36,.9);border:1px solid #19e3ff;color:#f1ecff;font:600 22px 'Barlow Condensed',sans-serif}
.check{display:flex;gap:16px;align-items:center;min-height:52px;cursor:pointer;font:700 22px 'Barlow Condensed',sans-serif}
.check input{width:30px;height:30px;margin:0;accent-color:#19e3ff;flex:none}
.aside h2{margin:0 0 10px;font:800 24px/1.1 'Barlow Condensed',sans-serif;letter-spacing:1.5px;color:#f1ecff}
.aside p{margin:0 0 18px;font:500 21px/1.5 'Barlow Condensed',sans-serif;color:#e4def7}
.aside section+section{margin-top:34px;padding-top:30px;border-top:1px solid rgba(241,236,255,.22)}
.lnk{font:700 21px 'Barlow Condensed',sans-serif;color:#c9f8ff;text-decoration-thickness:2px;text-underline-offset:4px}
.seg{display:flex;flex-wrap:wrap;gap:10px}
.seg label{position:relative;cursor:pointer}
.seg input{position:absolute;opacity:0;width:1px;height:1px}
.seg span{display:inline-flex;align-items:center;min-height:52px;padding:0 22px;transform:skewX(-10deg);border:1px solid rgba(241,236,255,.6);font:800 21px 'Barlow Condensed',sans-serif;letter-spacing:1.5px;color:#f1ecff}
.seg span b{display:inline-block;transform:skewX(10deg);font-weight:800}
.seg input:checked + span{background:#19e3ff;border-color:#19e3ff;color:#03141a;box-shadow:0 0 18px rgba(25,227,255,.6)}
.piece{--cut:22px;--edge:rgba(201,248,255,.55);--ground:rgba(7,5,13,.94);position:relative;isolation:isolate;background:var(--edge);clip-path:polygon(0 0,calc(100% - var(--cut)) 0,100% var(--cut),100% 100%,var(--cut) 100%,0 calc(100% - var(--cut)))}
.piece::before{content:'';position:absolute;z-index:-1;inset:1.5px;background:var(--ground);clip-path:polygon(0 0,calc(100% - var(--cut) + .62px) 0,100% calc(var(--cut) - .62px),100% 100%,calc(var(--cut) - .62px) 100%,0 calc(100% - var(--cut) + .62px))}
.by{display:flex;gap:18px;align-items:center}
.by img{width:76px;height:76px;border:2px solid #a78bfa;image-rendering:pixelated}
.by b{display:block;font:34px/1 Anton,Impact,sans-serif;letter-spacing:.5px}
.by span{font:600 20px 'Barlow Condensed',sans-serif;color:#e4def7}
.body p{margin:0 0 16px;font:500 21px/1.55 'Barlow Condensed',sans-serif;color:#f1ecff;max-width:760px}
.rail p{margin:0;font:500 20px/1.5 'Barlow Condensed',sans-serif;color:#e4def7}
.rail h3{margin:0 0 4px;font:700 21px 'Barlow Condensed',sans-serif;color:#f1ecff}
.rail section{padding:16px 0;border-top:1px solid rgba(241,236,255,.22)}
.opt{position:relative;display:block;box-sizing:border-box;padding:16px 18px 16px 52px;border:1px solid rgba(241,236,255,.45);background:rgba(7,5,13,.6);cursor:pointer}
.opt input{position:absolute;left:18px;top:19px;width:22px;height:22px;margin:0;accent-color:#19e3ff}
.opt b{display:block;font:800 21px 'Barlow Condensed',sans-serif;letter-spacing:1.5px}
.opt span{display:block;margin-top:4px;font:500 20px/1.4 'Barlow Condensed',sans-serif;color:#e4def7}
.opt.on{border:2px solid #19e3ff;background:rgba(25,227,255,.08);box-shadow:0 0 18px rgba(25,227,255,.35)}
.sec{margin:0 0 14px;font:800 22px 'Barlow Condensed',sans-serif;letter-spacing:3px}
.count{display:flex;justify-content:space-between;margin-top:8px;font:500 19px 'Barlow Condensed',sans-serif;color:#e4def7}
.cls{position:relative;flex:none;box-sizing:border-box;width:236px;padding:18px 18px 20px;border:1px solid var(--c);background:rgba(7,5,13,.7)}
.cls h4{margin:0 30px 0 0;font:38px/1 Anton,Impact,sans-serif;color:var(--c)}
.cls p{margin:12px 0 0;font:500 20px/1.45 'Barlow Condensed',sans-serif;color:#f1ecff}
.cls p.hurt{color:#ff8fb1}
.cls input{position:absolute;right:16px;top:20px;width:22px;height:22px;margin:0;accent-color:#19e3ff}
.cls.on{border:2px solid #19e3ff;box-shadow:0 0 18px rgba(25,227,255,.4);background:rgba(25,227,255,.07)}
.preview{border:1.5px solid rgba(201,248,255,.7);box-shadow:0 0 14px rgba(25,227,255,.3);background:#fff;color:#000;display:grid;grid-template-columns:160px 1fr;font:12px/1.45 Verdana,sans-serif}
.preview>div{padding:8px 10px}
.preview>div+div{border-left:1px solid #000}
.sel{box-sizing:border-box;height:56px;padding:0 16px;background:rgba(18,12,36,.9);border:1px solid #19e3ff;color:#f1ecff;font:700 21px 'Barlow Condensed',sans-serif}
`;

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Anton&amp;family=Barlow+Condensed:ital,wght@0,500;0,600;0,700;0,800;1,700;1,800&amp;display=swap" rel="stylesheet">`;

/** The two-worlds smoke, with a calm (a soft dark rect in the mask) under each text block, as [x, y, w, h, opacity]. */
function smoke(w, h, calms, id = '') {
  const rects = calms.map(([x, y, cw, ch, o = 0.85]) => `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" fill="#000000" opacity="${o}" filter="url(#soft${id})"></rect>`).join('\n        ');
  return `<svg aria-hidden="true" width="${w}" height="${h}" style="position: absolute; left: 0; top: 0">
    <defs>
      <filter id="sA${id}" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.0022 0.004" numOctaves="5" seed="23"></feTurbulence><feColorMatrix type="matrix" values="0 0 0 0 0.55  0 0 0 0 0.14  0 0 0 0 0.98  1.8 0 0 0 -0.74"></feColorMatrix><feGaussianBlur stdDeviation="18"></feGaussianBlur></filter>
      <filter id="sB${id}" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.003 0.005" numOctaves="4" seed="61"></feTurbulence><feColorMatrix type="matrix" values="0 0 0 0 0.08  0 0 0 0 0.85  0 0 0 0 1  0 2 0 0 -1.0"></feColorMatrix><feGaussianBlur stdDeviation="18"></feGaussianBlur></filter>
      <filter id="soft${id}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${w < 600 ? 30 : 60}"></feGaussianBlur></filter>
      <mask id="calm${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}">
        <rect width="${w}" height="${h}" fill="#ffffff"></rect>
        ${rects}
      </mask>
    </defs>
    <g mask="url(#calm${id})">
      <rect width="${w}" height="${h}" filter="url(#sA${id})" opacity="0.95"></rect>
      <rect width="${w}" height="${h}" filter="url(#sB${id})" opacity="0.5"></rect>
    </g>
  </svg>`;
}

const ESC = `<kbd style="display: inline-block; margin-right: 10px; padding: 0 6px; border: 1px solid #ffffff; font: 800 20px/1.25 'Barlow Condensed', sans-serif; letter-spacing: 1px">ESC</kbd>`;

/** The menu bar every glass page shares. Signed out it holds Back to the board alone; `tabs` adds the pause menu's tabs. */
function menu(tabs = [], current = '') {
  const t = tabs.map((n) => n === current
    ? `<a href="#" class="tab" aria-current="page" style="background: rgba(25,227,255,.16); box-shadow: inset 0 -3px 0 #19e3ff; color: #ffffff"><b>${n}</b></a>`
    : `<a href="#" class="tab"><b>${n}</b></a>`).join('\n    ');
  const pad = tabs.length > 5 ? ' --tp: 14px;' : '';
  return `<nav aria-label="Menu" class="${tabs.length > 8 ? 'many most' : tabs.length > 5 ? 'many' : ''}" style="position: absolute; left: 0; right: 0; top: 0; height: 84px; z-index: 5; display: flex; align-items: center; gap: ${tabs.length > 5 ? 2 : 8}px; padding: 0 28px;${pad} background: rgba(7,5,13,.9); border-bottom: 1px solid rgba(201,248,255,.5); box-shadow: 0 1px 16px rgba(25,227,255,.35)">
    <a href="#" class="tab" aria-keyshortcuts="Escape" style="border: 1px solid #ffffff; color: #ffffff; margin-right: 18px"><b>${ESC}BACK TO THE BOARD</b></a>
    ${t}
  </nav>`;
}

/** The phone's menu bar: Back alone, as #202 draws it at 390. */
const phoneMenu = `<nav aria-label="Menu" style="position: absolute; left: 0; right: 0; top: 0; height: 70px; z-index: 5; display: flex; align-items: center; padding: 0 12px; background: rgba(7,5,13,.9); border-bottom: 1px solid rgba(201,248,255,.5); box-shadow: 0 1px 16px rgba(25,227,255,.35)">
      <a href="#" class="tab" style="border: 1px solid #ffffff; color: #ffffff; min-height: 46px; font-size: 20px"><b>&lsaquo; BACK TO THE BOARD</b></a>
    </nav>`;

const title = (text, size = 112, top = 120, left = 64) =>
  `<h1 style="position: absolute; left: ${left}px; top: ${top}px; margin: 0; font: ${size}px/1 Anton, Impact, sans-serif; letter-spacing: 1px; text-shadow: 0 0 30px rgba(25,227,255,.35)">${text}</h1>`;

function page({ file, name, w, h, note, body }) {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${w}">
<title>${name}: the backfill board</title>
<!-- A board of the backfill design session (docs/plans/2026-11-05-backfill-boards-design.md), ${w} by ${h}, drawn on
     #202's head (c2553b3). ${note} A reference for the look, not code to copy. Written by gen.mjs in this folder. -->
${FONTS}
<style>${CSS}</style>
</head>
<body>
${body}
</body>
</html>
`;
  fs.writeFileSync(path.join(here, file), html);
}

const frame = (w, h, inner) => `<div style="width: ${w}px; height: ${h}px; position: relative; overflow: hidden; background: #07050d; color: #f1ecff; font-family: 'Barlow Condensed', sans-serif">
${inner}
</div>`;

/* ---------------------------------------------------------------- batch 1: the door */

/** The aside every door page carries in its right column: the other way in, and a person. */
const doorAside = (other) => `<aside class="aside" aria-label="Other ways in" style="position: absolute; left: 870px; top: 300px; width: 420px">
    ${other}
    <section aria-labelledby="stuckH">
      <h2 id="stuckH">STUCK?</h2>
      <p>No code arrived, or the link has expired. The admins can help.</p>
      <a href="#" class="lnk">Reach a person</a>
    </section>
  </aside>`;

page({
  file: '14-sign-in.html', name: 'Sign in', w: 1440, h: 1000,
  note: 'Signed out. One field and one primary action on the left; the other ways in, as an aside on the right.',
  body: frame(1440, 1000, `
  ${smoke(1440, 1000, [[40, 280, 760, 420, 0.9], [850, 280, 470, 420, 0.8]])}
  ${menu()}
  ${title('SIGN IN')}
  <form aria-labelledby="signInH" style="position: absolute; left: 64px; top: 300px; width: 680px">
    <span id="signInH" hidden>Sign in</span>
    <p class="lead">No password. We email you a code and a link; either one signs you in.</p>
    <div class="field" style="margin-top: 34px">
      <label for="em">EMAIL ADDRESS</label>
      <input id="em" type="email" autocomplete="email">
    </div>
    <div class="btns" style="margin-top: 26px">
      <button type="submit" class="btn primary"><b>SEND A CODE</b></button>
    </div>
  </form>
  ${doorAside(`<section aria-labelledby="newH">
      <h2 id="newH">NEW HERE?</h2>
      <p>Registering takes an invite from someone who plays. The same email code signs you in after.</p>
      <a href="#" class="btn"><b>REGISTER</b></a>
    </section>`)}
`),
});

page({
  file: '15-register.html', name: 'Register', w: 1440, h: 1000,
  note: 'Signed out, opened from an invite link, so the invite is filled in.',
  body: frame(1440, 1000, `
  ${smoke(1440, 1000, [[40, 280, 760, 600, 0.9], [850, 280, 470, 420, 0.8]])}
  ${menu()}
  ${title('REGISTER')}
  <form aria-labelledby="regH" style="position: absolute; left: 64px; top: 300px; width: 680px">
    <span id="regH" hidden>Register</span>
    <p class="lead">No password. We email you a code and a link; either one makes your account.</p>
    <div class="field" style="margin-top: 34px">
      <label for="em">EMAIL ADDRESS</label>
      <input id="em" type="email" autocomplete="email">
    </div>
    <div class="field" style="margin-top: 26px">
      <label for="inv">INVITE</label>
      <input id="inv" type="text" value="ab12cd34" aria-describedby="invNote" style="font-family: 'Barlow Condensed', sans-serif; letter-spacing: 2px">
      <p id="invNote" class="note">Registration is by invite for now. Your invite link filled this in.</p>
    </div>
    <label class="check" style="margin-top: 22px">
      <input type="checkbox">
      I am 18 or older.
    </label>
    <p class="note" style="margin: 2px 0 0 46px">An acknowledgement, nothing legally binding.</p>
    <div class="btns" style="margin-top: 26px">
      <button type="submit" class="btn primary"><b>SEND A CODE</b></button>
    </div>
  </form>
  ${doorAside(`<section aria-labelledby="backH">
      <h2 id="backH">ALREADY PLAYING?</h2>
      <p>Sign in with the email you registered.</p>
      <a href="#" class="btn"><b>SIGN IN</b></a>
    </section>`)}
`),
});

page({
  file: '16-contact.html', name: 'Reach a person', w: 1440, h: 1000,
  note: 'Signed out. Each way to reach the admins is a row, in the Settings board\'s row idiom.',
  body: frame(1440, 1000, `
  ${smoke(1440, 1000, [[40, 280, 1000, 380, 0.9]])}
  ${menu()}
  ${title('REACH A PERSON')}
  <section aria-label="Ways to reach the admins" style="position: absolute; left: 64px; top: 300px; width: 920px">
    <p class="lead" style="margin-bottom: 22px">The admins run this instance. Write to them if something looks broken, if you're stuck with no way out, or about anything that isn't part of the game.</p>
    <div class="row">
      <h3>DISCORD</h3>
      <div><a href="#" class="btn"><b>OPEN THE DISCORD</b></a></div>
    </div>
    <div class="row" style="border-bottom: 1px solid rgba(241,236,255,.22)">
      <h3>EMAIL</h3>
      <div style="padding-top: 10px"><a href="#" class="lnk" style="font-size: 24px">admin@example.test</a></div>
    </div>
  </section>
`),
});

/* The front door: the board world's sample thread above (as #224 built it, not compared), the signed-out HUD docked below
   in the signed-in HUD's own frame (01-main), so the door previews the game it opens onto. */
function boardThread(w) {
  const post = (who, rank, pips, cls, text, reacts) => `<tr>
        <td style="width: 150px; padding: 8px 10px; border: 1px solid #000; vertical-align: top; font: 13px Verdana, sans-serif">
          <b>${who}</b><br>${rank}<br><span style="letter-spacing: 1px">${'&#9632;'.repeat(pips)}${'&#9633;'.repeat(6 - pips)}</span><br><span style="font-size: 11px; color: #444">Revealed: ${cls} (Oct 3)</span>
        </td>
        <td style="padding: 8px 10px; border: 1px solid #000; vertical-align: top; font: 13px/1.5 Verdana, sans-serif">${text}<div style="margin-top: 8px">${reacts.map((r) => `<span style="display: inline-block; margin-right: 4px; padding: 0 5px; border: 1px solid #000; font-size: 12px">${r}</span>`).join('')}</div></td>
      </tr>`;
  return `<div aria-label="Sample thread (the board world, not compared)" style="position: absolute; left: ${(w - 960) / 2}px; top: 0; width: 960px; background: #ffffff; color: #000000">
    <div style="padding: 14px 0 8px; border-bottom: 1px solid #000; font: 700 18px 'Courier New', monospace; letter-spacing: 3px">DIVIDED WORLD</div>
    <div style="padding: 6px 0; border-bottom: 1px solid #000; font: 11px Verdana, sans-serif"><u>Index</u> &middot; <u>Sign in</u></div>
    <div style="padding: 10px 0; font: 11px Verdana, sans-serif">Divided World &raquo; WELCOME TO THE BEEF ZONE <span style="margin-left: 8px; padding: 1px 6px; border: 1px solid #000; font-weight: 700">Sample thread &middot; made up</span></div>
    <div style="margin: 10px 0; font: 700 17px 'Courier New', monospace">WELCOME TO THE BEEF ZONE</div>
    <table style="width: 100%; border-collapse: collapse">
      ${post('Snuckles', 'Jobber', 1, 'Jabroni', 'This is a plain old outdated forum...or is it something more? In the game we call life, we have few opportunities to put on a mask. We are giving you that opportunity now. Will you take it, weary traveler?', ['&#x1F926; 3', '&#x1F644; 4', '&#x1F971; 2'])}
      ${post('Captain Wholesome', 'Main Eventer', 4, 'Face', 'Do you ever stop talking?', ['&#x1F525; 7', '&#x2764;&#xFE0F; 5', '&#x1F602; 4', '&#x1F4AF; 3'])}
      ${post('The Accountant', 'Midcarder', 3, 'Technician', "You're just trying to get crowd points by acting like a clown. How about we try to explain this in a way that makes sense?", ['&#x1F64F; 4', '&#x1F615; 3', '&#x1F4A1; 2'])}
    </table>
  </div>`;
}

/** The signed-out HUD, in the signed-in HUD's frame: the mask panel, the Aura notch with its sockets empty, the way in. */
const signedOutHud = `<section aria-label="Game HUD" style="position: absolute; left: 0; right: 0; bottom: 0; height: 190px; z-index: 4">
    <div aria-hidden="true" style="position: absolute; inset: 0; background: #07050d; clip-path: polygon(0 26px, 452px 26px, 478px 0, 972px 0, 998px 26px, 100% 26px, 100% 100%, 0 100%)">${smoke(1440, 190, [[20, 40, 440, 140, .7], [480, 10, 480, 170, .6], [980, 40, 440, 140, .7]], 'h')}</div>
    <svg aria-hidden="true" width="1440" height="190" style="position: absolute; left: 0; top: 0">
      <defs><linearGradient id="hudG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#140c2c"></stop><stop offset="1" stop-color="#07050d"></stop></linearGradient></defs>
      <path d="M0 26 H452 L478 0 H972 L998 26 H1440 V190 H0 Z" fill="url(#hudG)" fill-opacity=".78"></path>
      <path d="M0 26 H452 L478 0 H972 L998 26 H1440" fill="none" stroke="#c9f8ff" stroke-opacity=".7" stroke-width="1.5"></path>
    </svg>
    <div style="position: absolute; left: 28px; top: 38px; width: 420px; height: 140px; border: 1px solid rgba(201,248,255,.35); background: rgba(7,5,13,.6); transform: skewX(-6deg)"></div>
    <div aria-hidden="true" style="position: absolute; left: 60px; top: 62px; width: 82px; height: 82px; border: 2px solid #19e3ff; box-shadow: 0 0 16px rgba(25,227,255,.6); display: grid; place-items: center; font: 54px Anton, Impact, sans-serif; color: #f1ecff">?</div>
    <h2 style="position: absolute; left: 160px; top: 60px; margin: 0; font: 30px/1 Anton, Impact, sans-serif; letter-spacing: .5px; color: #f1ecff">WHO WILL YOU PLAY AS?</h2>
    <p style="position: absolute; left: 160px; top: 98px; width: 275px; margin: 0; font: 600 19px/1.25 'Barlow Condensed', sans-serif; color: #e4def7">A message board where everyone wears a mask, and everyone is someone you know.</p>
    <div style="position: absolute; left: 500px; top: 12px; font: 800 20px 'Barlow Condensed', sans-serif; letter-spacing: 3px; color: #e4def7">AURA</div>
    <div aria-hidden="true" style="position: absolute; left: 500px; top: 46px; display: flex; gap: 14px">
      ${'<span style="width: 48px; height: 48px; border-radius: 50%; border: 1px dashed rgba(241,236,255,.45); background: radial-gradient(circle at 35% 30%, rgba(241,236,255,.12), rgba(7,5,13,.6))"></span>'.repeat(6)}
    </div>
    <p style="position: absolute; left: 500px; top: 112px; width: 440px; margin: 0; font: 600 20px/1.3 'Barlow Condensed', sans-serif; color: #e4def7">No mask, no Aura, no hand yet. Your first character fills them.</p>
    <div class="btns" style="position: absolute; right: 40px; top: 52px; flex-direction: column; align-items: flex-end; gap: 12px">
      <div class="btns">
        <a href="#" class="btn"><b>SIGN IN</b></a>
        <a href="#" class="btn primary"><b>REGISTER WITH AN INVITE</b></a>
      </div>
      <p style="margin: 0; font: 600 20px 'Barlow Condensed', sans-serif; color: #e4def7">No invite? Ask someone who plays.</p>
    </div>
  </section>`;

page({
  file: '17-front-door.html', name: 'The front door', w: 1440, h: 1000,
  note: 'Signed out, on any board address: #224\'s sample thread (board world, drawn for context only) under the signed-out HUD. Only the HUD is compared.',
  body: `<div style="width: 1440px; height: 1000px; position: relative; overflow: hidden; background: #ffffff; color: #f1ecff; font-family: 'Barlow Condensed', sans-serif">
  ${boardThread(1440)}
  ${signedOutHud}
</div>`,
});

/* The door on a phone: Sign in, Register, Reach a person, and the front door's HUD, at 390 by 844 each. */
const phone = (label, inner, calms, id) => `<figure aria-label="${label}" style="margin: 0; width: 390px; height: 844px; position: relative; overflow: hidden; background: #07050d; color: #f1ecff; flex: none">
    ${smoke(390, 844, calms, id)}
    ${inner}
  </figure>`;

const pTitle = (t) => `<h1 style="position: absolute; left: 16px; top: 92px; width: 358px; margin: 0; font: 64px/1 Anton, Impact, sans-serif; letter-spacing: .5px; text-shadow: 0 0 24px rgba(25,227,255,.35)">${t}</h1>`;
const pAside = (h, p, btn) => `<aside class="aside" style="margin-top: 30px; padding-top: 24px; border-top: 1px solid rgba(241,236,255,.22)">
        <h2>${h}</h2><p>${p}</p>${btn}
        <p style="margin: 22px 0 0"><a href="#" class="lnk">Reach a person</a></p>
      </aside>`;

page({
  file: '18-door-phone.html', name: 'The door on a phone', w: 1660, h: 884,
  note: 'Four phone screens at 390 by 844: Sign in, Register, Reach a person, and the front door with its HUD. The aside stacks under the form.',
  body: `<div style="width: 1660px; height: 884px; display: flex; gap: 20px; padding: 20px; box-sizing: border-box; background: #2a2833; font-family: 'Barlow Condensed', sans-serif">
  ${phone('Sign in', `${phoneMenu}${pTitle('SIGN IN')}
    <form style="position: absolute; left: 16px; top: 180px; width: 358px">
      <p class="lead" style="font-size: 20px">No password. We email you a code and a link; either one signs you in.</p>
      <div class="field" style="margin-top: 24px"><label>EMAIL ADDRESS</label><input type="email"></div>
      <div class="btns" style="margin-top: 20px"><button class="btn primary" style="width: 100%"><b>SEND A CODE</b></button></div>
      ${pAside('NEW HERE?', 'Registering takes an invite from someone who plays.', '<a href="#" class="btn"><b>REGISTER</b></a>')}
    </form>`, [[0, 170, 390, 640, .9]], 'p1')}
  ${phone('Register', `${phoneMenu}${pTitle('REGISTER')}
    <form style="position: absolute; left: 16px; top: 180px; width: 358px">
      <p class="lead" style="font-size: 20px">No password. We email you a code and a link; either one makes your account.</p>
      <div class="field" style="margin-top: 20px"><label>EMAIL ADDRESS</label><input type="email"></div>
      <div class="field" style="margin-top: 18px"><label>INVITE</label><input type="text" value="ab12cd34"><p class="note" style="font-size: 20px; margin-top: 8px">Your invite link filled this in.</p></div>
      <label class="check" style="margin-top: 10px; font-size: 21px"><input type="checkbox"> I am 18 or older.</label>
      <div class="btns" style="margin-top: 14px"><button class="btn primary" style="width: 100%"><b>SEND A CODE</b></button></div>
      <p style="margin: 22px 0 0; font: 600 20px 'Barlow Condensed', sans-serif; color: #e4def7">Already playing? <a href="#" class="lnk">Sign in</a></p>
    </form>`, [[0, 170, 390, 660, .9]], 'p2')}
  ${phone('Reach a person', `${phoneMenu}${pTitle('REACH A<br>PERSON')}
    <section style="position: absolute; left: 16px; top: 248px; width: 358px">
      <p class="lead" style="font-size: 20px">The admins run this instance. Write to them if something looks broken, if you're stuck with no way out, or about anything that isn't part of the game.</p>
      <div style="margin-top: 22px; padding: 18px 0; border-top: 1px solid rgba(241,236,255,.22)"><div class="k" style="padding: 0 0 12px">DISCORD</div><a href="#" class="btn"><b>OPEN THE DISCORD</b></a></div>
      <div style="padding: 18px 0; border-top: 1px solid rgba(241,236,255,.22); border-bottom: 1px solid rgba(241,236,255,.22)"><div class="k" style="padding: 0 0 10px">EMAIL</div><a href="#" class="lnk" style="font-size: 22px">admin@example.test</a></div>
    </section>`, [[0, 240, 390, 420, .9]], 'p3')}
  <figure aria-label="The front door" style="margin: 0; width: 390px; height: 844px; position: relative; overflow: hidden; background: #ffffff; flex: none">
    <div style="padding: 12px 10px; font: 700 17px 'Courier New', monospace; letter-spacing: 3px; color: #000; border-bottom: 1px solid #000">DIVIDED WORLD</div>
    <div style="padding: 8px 10px; font: 12px/1.5 Verdana, sans-serif; color: #000">Divided World &raquo; WELCOME TO THE BEEF ZONE<br><b style="border: 1px solid #000; padding: 0 4px">Sample thread &middot; made up</b><br><br>(the board world: #224's thread, not compared)</div>
    <section aria-label="Game HUD" style="position: absolute; left: 0; right: 0; bottom: 0; height: 236px; background: linear-gradient(#140c2c, #07050d); border-top: 1.5px solid rgba(201,248,255,.7); color: #f1ecff">
      <div aria-hidden="true" style="position: absolute; left: 16px; top: 18px; width: 56px; height: 56px; border: 2px solid #19e3ff; box-shadow: 0 0 12px rgba(25,227,255,.6); display: grid; place-items: center; font: 36px Anton, Impact, sans-serif">?</div>
      <h2 style="position: absolute; left: 86px; top: 16px; margin: 0; font: 28px/1 Anton, Impact, sans-serif">WHO WILL YOU PLAY AS?</h2>
      <p style="position: absolute; left: 86px; top: 50px; width: 290px; margin: 0; font: 600 18px/1.3 'Barlow Condensed', sans-serif; color: #e4def7">A message board where everyone wears a mask, and everyone is someone you know.</p>
      <div style="position: absolute; left: 16px; right: 16px; top: 112px; display: flex; flex-direction: column; gap: 10px">
        <a href="#" class="btn primary" style="min-height: 56px"><b>REGISTER WITH AN INVITE</b></a>
        <div style="display: flex; justify-content: space-between; align-items: center">
          <span style="font: 600 18px 'Barlow Condensed', sans-serif; color: #e4def7">No invite? Ask someone who plays.</span>
          <a href="#" class="btn" style="min-height: 46px; padding: 0 18px"><b>SIGN IN</b></a>
        </div>
      </div>
    </section>
  </figure>
</div>`,
});

/* ---------------------------------------------------------------- batch 2: onboarding, redrawn */

const GABE = '../2026-11-02-onboarding/assets/gabe-avatar.png';
const PAUSE = ['ALERTS', 'VENDING MACHINE', 'MY CHARACTERS', 'SEASON', 'MY LOG', 'GUIDE', 'UPDATES', 'SETTINGS'];
const segRow = (name, opts, note) => `<fieldset class="row" style="margin: 0; border-left: 0; border-right: 0; border-bottom: 0; grid-template-columns: 170px 1fr">
        <legend style="float: left; padding: 0"><h3>${name}</h3></legend>
        <div><div class="seg" role="radiogroup" aria-label="${name}">${opts.map((o, i) => `<label><input type="radio" name="${name}"${i ? '' : ' checked'}><span><b>${o}</b></span></label>`).join('')}</div>
        <p class="note">${note}</p></div>
      </fieldset>`;

page({
  file: '19-welcome.html', name: 'Welcome', w: 1440, h: 1720,
  note: 'Amends docs/research/2026-11-02-onboarding/01-welcome.html on #202\'s parts: the build\'s current copy, the letter\'s heading in the case it is written in, and the two calls to action as one ButtonRow (#202 retired the 68px display button).',
  body: frame(1440, 1720, `
  ${smoke(1440, 1720, [[40, 270, 380, 540, .85], [430, 270, 960, 1400, .92]])}
  ${menu(PAUSE)}
  ${title('WELCOME')}
  <aside class="rail" aria-label="What happens next" style="position: absolute; left: 64px; top: 290px; width: 340px">
    <p style="margin-bottom: 18px; font-weight: 600; color: #f1ecff">You're in. One letter, three settings, then your first character.</p>
    <section><h3>Your first character</h3><p>A name, a class, and when it arrives on the board. Once it has arrived, it can post.</p></section>
    <section><h3>A short tour</h3><p>On the board, three short notes point out your mask, your orbs and your hand. Skip all tips ends them.</p></section>
    <section style="border-bottom: 1px solid rgba(241,236,255,.22)"><h3>Change anything later</h3><p>These settings live in Settings › Accessibility, and this letter is the first section of the Strategy Guide.</p></section>
  </aside>
  <article class="piece" aria-labelledby="letterH" style="position: absolute; left: 450px; top: 290px; width: 926px; box-sizing: border-box; padding: 40px 42px">
    <div class="by"><img src="${GABE}" alt=""><div><b>GABE</b><span>Made this. Sorry.</span></div></div>
    <h2 id="letterH" style="margin: 26px 0 14px; font: 60px/1.05 Anton, Impact, sans-serif; letter-spacing: .5px; text-shadow: 0 0 24px rgba(167,139,250,.35)">After nine years of development</h2>
    <div class="body">
      <p>...hopefully it would have been worth the wait.</p>
      <p>This is Divided World. It looks like a message board from 2003, and it is one. It is also a game. You'll play several characters, each behind a mask, each with a secret class that decides which reactions make it stronger. No other player can see which masks are yours.</p>
      <p>Everything anyone does here is public. Who's doing it isn't. Work it out, or don't.</p>
      <p>Go make somebody.</p>
      <p style="font: italic 800 21px 'Barlow Condensed', sans-serif">Gabe</p>
    </div>
    <section aria-labelledby="startH" style="margin-top: 26px; padding-top: 30px; border-top: 1px solid rgba(241,236,255,.22)">
      <h2 id="startH" style="margin: 0 0 8px; font: 44px/1 Anton, Impact, sans-serif">BEFORE YOU START</h2>
      <p class="note" style="margin: 0 0 18px">How the board and the glass look and move. None of it changes how the game plays.</p>
      ${segRow('THEME', ['FOLLOW MY DEVICE', 'BLACK ON WHITE', 'WHITE ON BLACK'], 'The 2003 board stays 2003 whichever you choose. Only its colors swap.')}
      ${segRow('MOTION', ['FOLLOW MY DEVICE', 'REDUCED', 'FULL'], "Reduced stops the drifting smoke, the pulses and the orb shine. A card's effect stays: Stick Around still snaps you back, only instantly.")}
      ${segRow('TEXT SIZE', ['100%', '125%', '150%', '200%'], 'Applies to the board and the glass together. Past 150% the glass folds into one column, and nothing is cut off.')}
    </section>
    <div class="btns" style="margin-top: 10px; padding-top: 30px; border-top: 1px solid rgba(241,236,255,.22)">
      <a href="#" class="btn primary"><b>MAKE YOUR FIRST CHARACTER</b></a>
      <a href="#" class="btn"><b>READ THE STRATEGY GUIDE FIRST</b></a>
    </div>
  </article>
`),
});

/** A class card's grid: [top-left, top-right, bottom-left, bottom-right], each '+', '-' or ''. */
const grid = (cells) => `<div aria-hidden="true" style="display: grid; grid-template-columns: 34px 34px; gap: 4px; flex: none">${cells.map((c) => `<span style="width: 34px; height: 34px; box-sizing: border-box; display: grid; place-items: center; font: 800 18px 'Barlow Condensed', sans-serif; border: 1px solid ${c === '+' ? '#ffd23f' : c === '-' ? '#ff5c8a' : 'rgba(241,236,255,.3)'}; color: ${c === '+' ? '#ffd23f' : '#ff5c8a'}; background: ${c ? 'rgba(255,255,255,.04)' : 'none'}">${c === '-' ? '&minus;' : c}</span>`).join('')}</div>`;
const klass = (name, color, cells, text, hint) => `<div style="display: flex; gap: 26px; padding: 22px 0; border-top: 1px solid rgba(241,236,255,.22)">
        ${grid(cells)}
        <div><span style="display: inline-block; padding: 2px 10px; transform: skewX(-10deg); background: ${color}; font: 800 20px 'Barlow Condensed', sans-serif; letter-spacing: 1.5px; color: #ffffff"><b style="display: inline-block; transform: skewX(10deg)">${name}</b></span>
          <p style="margin: 10px 0 0; font: 500 21px/1.5 'Barlow Condensed', sans-serif; color: #f1ecff; max-width: 720px">${text}</p>
          <p style="margin: 8px 0 0; font: 500 21px 'Barlow Condensed', sans-serif; color: #e4def7"><b style="margin-right: 10px; font-weight: 800; letter-spacing: 1.5px; color: #c4b5fd">GABE'S HINT</b>${hint}</p></div>
      </div>`;
const guideNav = (current) => ['Welcome letter', 'The metagame', 'Reactions', 'Aura', 'Classes', 'Turns and reveals', 'Cards', 'The masks', 'The System', 'Coming attractions']
  .map((n) => `<li style="border-bottom: 1px solid rgba(241,236,255,.22)"><a href="#"${n === current ? ' aria-current="location" style="display: block; padding: 10px 12px; border-left: 3px solid #19e3ff; background: rgba(25,227,255,.12); color: #c9f8ff; text-decoration: none; font: 700 21px \'Barlow Condensed\', sans-serif"' : ' style="display: block; padding: 10px 0; color: #f1ecff; text-decoration: none; font: 700 21px \'Barlow Condensed\', sans-serif"'}>${n}</a></li>`).join('');

page({
  file: '20-guide.html', name: 'Strategy Guide', w: 1440, h: 1320,
  note: 'Amends docs/research/2026-11-02-onboarding/02-guide.html: scrolled to Classes, the section heading in the case it is written in, the contents\' current section marked as #202 marks it.',
  body: frame(1440, 1320, `
  ${smoke(1440, 1320, [[40, 250, 330, 780, .85], [400, 230, 990, 1080, .92]])}
  ${menu(PAUSE, 'GUIDE')}
  ${title('STRATEGY GUIDE')}
  <nav aria-label="Contents" style="position: absolute; left: 64px; top: 270px; width: 290px">
    <p style="margin: 0 0 18px; font: 600 20px/1.5 'Barlow Condensed', sans-serif; color: #f1ecff">How the game works, from the people who made it. The voice is Gabe's; every fact in it is true, and every number is today's.</p>
    <ul style="margin: 0; padding: 0; list-style: none">${guideNav('Classes')}</ul>
  </nav>
  <article class="piece" aria-labelledby="classesH" style="position: absolute; left: 410px; top: 250px; width: 966px; box-sizing: border-box; padding: 36px 42px">
    <h2 id="classesH" style="margin: 0 0 14px; font: 60px/1 Anton, Impact, sans-serif; letter-spacing: .5px">Classes</h2>
    <p class="lead" style="max-width: 760px; font-weight: 500">Every character has one, and only you can see it. A class decides which corners of the reaction grid pay your character and which ones cost it. Reactions to a card you play count for you too, read through your class.</p>
    <p class="lead" style="max-width: 760px; margin-top: 14px; font-weight: 500">Pick the one that sounds like how you already post, or one that sounds like a bad idea. You can Turn later.</p>
    <p style="margin: 18px 0 18px; font: 600 20px 'Barlow Condensed', sans-serif; color: #e4def7">Top row excited, bottom calm; left negative, right positive. <span style="color: #ffd23f">+ earns</span> &middot; <span style="color: #ff5c8a">&minus; hurts</span></p>
    ${klass('FACE', '#2f6fdf', ['', '+', '-', ''], "The crowd's favorite. Earns from excited, positive reactions, and from the cheers a post draws after its Sweet card lands there. Hurt by bored reactions, and by a card that outdraws the post it was played on.", 'Get behind the posts you like.')}
    ${klass('HEEL', '#d4352f', ['+', '', '', '-'], 'Earns heat: excited, negative reactions, and a Salty card that outdraws the post it lands on. Hurt by the polite shrug, calm and positive.', 'Being hated is a living.')}
    ${klass('JABRONI', '#b8860b', ['', '-', '+', ''], 'Anti-comedy: posts built to bomb. Earns from bored, negative reactions and from Salty cards others land on its posts. Hurt by being taken sincerely, excited and positive.', 'Commit to the bit. Especially when nobody laughs.')}
    ${klass('TECHNICIAN', '#1f8f4e', ['-', '', '', '+'], 'The respected regular. Earns from calm, positive reactions to its posts and cards, and more when an old post of its own still draws them. Hurt by heat: excited, negative reactions.', 'Write the reply people come back to.')}
  </article>
`),
});

/* The tour on the board: the page dimmed and blurred, the cut-out on the orbs, Gabe's tip on the glass's own ground. */
page({
  file: '21-spotlight.html', name: 'The HUD tour', w: 1440, h: 1000,
  note: 'Amends docs/research/2026-11-02-onboarding/03-spotlight.html: step 2 of the HUD tour over the Index, as the build opens it, the tip on the glass ground rather than a lighter gray.',
  body: `<div style="width: 1440px; height: 1000px; position: relative; overflow: hidden; background: #ffffff; font-family: 'Barlow Condensed', sans-serif">
  <div aria-hidden="true" style="position: absolute; inset: 0; filter: blur(5px)">
    <div style="position: absolute; left: 240px; top: 0; width: 960px; color: #000">
      <div style="padding: 14px 0 8px; border-bottom: 1px solid #000; font: 700 18px 'Courier New', monospace; letter-spacing: 3px">DIVIDED WORLD</div>
      <div style="margin: 30px 0 10px; font: 700 17px 'Courier New', monospace">Index</div>
      <div style="height: 130px; border: 1px solid #000"></div>
      <div style="margin-top: 14px; height: 70px; border: 1px solid #000"></div>
    </div>
    <div style="position: absolute; left: 0; right: 0; bottom: 0; height: 190px; background: linear-gradient(#140c2c, #07050d)"></div>
  </div>
  <div aria-hidden="true" style="position: absolute; inset: 0; background: rgba(7,5,13,.62)"></div>
  <div aria-hidden="true" style="position: absolute; left: 484px; top: 800px; width: 472px; height: 156px; border: 2px solid #19e3ff; box-shadow: 0 0 0 4px rgba(25,227,255,.18), 0 0 26px rgba(25,227,255,.55); background: linear-gradient(#140c2c, #07050d)">
    <div style="position: absolute; left: 16px; top: 10px; font: 800 20px 'Barlow Condensed', sans-serif; letter-spacing: 3px; color: #e4def7">AURA</div>
    <div style="position: absolute; left: 16px; top: 42px; display: flex; gap: 18px">${'<span style="width: 54px; height: 54px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #4a4466, #0d0a18)"></span>'.repeat(6)}</div>
    <div style="position: absolute; left: 16px; top: 98px; font: 54px/1 Anton, Impact, sans-serif; color: #f1ecff">0.00 <span style="font: 700 22px 'Barlow Condensed', sans-serif">/ 6.00</span></div>
  </div>
  <section role="dialog" aria-labelledby="tipH" class="piece" style="position: absolute; left: 436px; top: 470px; --ground: #07050d; --edge: #a78bfa; --cut: 16px; width: 580px; box-sizing: border-box; padding: 26px 26px 22px; color: #f1ecff">
    <div class="by"><img src="${GABE}" alt="" style="width: 58px; height: 58px"><div><b id="tipH" style="font-size: 36px">THESE ARE YOUR ORBS</b><span style="font-weight: 800; letter-spacing: 2px; color: #c4b5fd">GABE &middot; THE HUD, 2 OF 3</span></div></div>
    <p style="margin: 18px 0 20px; font: 500 21px/1.5 'Barlow Condensed', sans-serif">Reactions to your characters fill them at the settlement. Until then, hatched fill shows where you're headed. There is a most you can hold, so spend it.</p>
    <div style="display: flex; align-items: center; justify-content: space-between">
      <span aria-hidden="true" style="display: flex; gap: 6px">${['#19e3ff', '#19e3ff', 'none'].map((c) => `<i style="width: 14px; height: 14px; border: 1.5px solid #19e3ff; background: ${c}; transform: skewX(-10deg)"></i>`).join('')}</span>
      <div class="btns"><button class="btn"><b>SKIP ALL TIPS</b></button><button class="btn primary"><b>GOT IT</b></button></div>
    </div>
  </section>
  <i aria-hidden="true" style="position: absolute; left: 708px; top: 763px; border: 12px solid transparent; border-top: 14px solid #a78bfa"></i>
</div>`,
});

const phoneTabs = (cur) => `<nav aria-label="Menu" style="position: absolute; left: 0; right: 0; top: 0; height: 124px; z-index: 5; background: rgba(7,5,13,.9); border-bottom: 1px solid rgba(201,248,255,.5); box-shadow: 0 1px 16px rgba(25,227,255,.35)">
      <a href="#" class="tab" style="position: absolute; left: 12px; top: 12px; border: 1px solid #ffffff; color: #ffffff; min-height: 46px; font-size: 20px"><b>&lsaquo; BACK TO THE BOARD</b></a>
      <div style="position: absolute; left: 0; right: 0; top: 66px; display: flex; overflow: hidden; padding-left: 12px">${['ALERTS', 'VENDING MACHINE', 'MY CHARACTERS', 'SEASON', 'MY LOG', 'GUIDE'].map((n) => `<a href="#" class="tab" style="min-height: 52px; padding: 0 12px; font-size: 19px${n === cur ? '; background: rgba(25,227,255,.16); box-shadow: inset 0 -3px 0 #19e3ff; color: #ffffff' : ''}"><b>${n}</b></a>`).join('')}</div>
    </nav>`;
const pSeg = (name, opts) => `<div style="padding: 16px 0; border-top: 1px solid rgba(241,236,255,.22)"><div class="k" style="padding: 0 0 12px; font-size: 22px">${name}</div><div class="seg" style="gap: 8px">${opts.map((o, i) => `<label><input type="radio" name="p${name}"${i ? '' : ' checked'}><span style="min-height: 48px; padding: 0 16px; font-size: 19px; white-space: nowrap"><b>${o}</b></span></label>`).join('')}</div></div>`;

page({
  file: '22-onboarding-phone.html', name: 'Onboarding on a phone', w: 1250, h: 884,
  note: 'Three phone screens at 390 by 844: the welcome letter scrolled to Before you start, each setting a full-width row whose options wrap whole (no option breaks inside its label, no note squeezed beside them); the guide with its contents folded; the tour\'s second step as a sheet over the HUD, the mask\'s name whole.',
  body: `<div style="width: 1250px; height: 884px; display: flex; gap: 20px; padding: 20px; box-sizing: border-box; background: #2a2833; font-family: 'Barlow Condensed', sans-serif">
  ${phone('Welcome, Before you start', `${phoneTabs('')}
    <section style="position: absolute; left: 16px; top: 140px; width: 358px">
      <h2 style="margin: 0 0 6px; font: 38px/1 Anton, Impact, sans-serif">BEFORE YOU START</h2>
      <p class="note" style="margin: 0 0 14px; font-size: 20px">How the board and the glass look and move. None of it changes how the game plays.</p>
      ${pSeg('THEME', ['FOLLOW MY DEVICE', 'BLACK ON WHITE', 'WHITE ON BLACK'])}
      <p class="note" style="margin: -4px 0 6px; font-size: 19px">The 2003 board stays 2003 whichever you choose. Only its colors swap.</p>
      ${pSeg('MOTION', ['FOLLOW MY DEVICE', 'REDUCED', 'FULL'])}
      <p class="note" style="margin: -4px 0 6px; font-size: 19px">Reduced stops the drifting smoke, the pulses and the orb shine. A card's effect stays: Stick Around still snaps you back, only instantly.</p>
      ${pSeg('TEXT SIZE', ['100%', '125%', '150%', '200%'])}
    </section>`, [[0, 130, 390, 714, .92]], 'q1')}
  ${phone('The guide', `${phoneTabs('GUIDE')}
    ${pTitle('STRATEGY<br>GUIDE').replace('top: 92px', 'top: 140px')}
    <section style="position: absolute; left: 16px; top: 290px; width: 358px">
      <p class="lead" style="font-size: 20px">How the game works, from the people who made it. The voice is Gabe's; every fact in it is true, and every number is today's.</p>
      <button style="margin-top: 16px; width: 100%; height: 50px; display: flex; justify-content: space-between; align-items: center; padding: 0 14px; background: rgba(7,5,13,.9); border: 1px solid #19e3ff; color: #f1ecff; font: 800 20px 'Barlow Condensed', sans-serif; letter-spacing: 1.5px">CONTENTS &middot; CLASSES <span aria-hidden="true">&#x2304;</span></button>
      <h2 style="margin: 26px 0 10px; font: 44px/1 Anton, Impact, sans-serif">Classes</h2>
      <p class="note" style="font-size: 20px">Every character has one, and only you can see it. A class decides which corners of the reaction grid pay your character and which ones cost it.</p>
    </section>`, [[0, 280, 390, 520, .92]], 'q2')}
  <figure aria-label="The tour, step 2" style="margin: 0; width: 390px; height: 844px; position: relative; overflow: hidden; background: #ffffff; flex: none; font-family: 'Barlow Condensed', sans-serif">
    <div aria-hidden="true" style="position: absolute; inset: 0; filter: blur(4px)"><div style="padding: 12px 10px; font: 700 17px 'Courier New', monospace; letter-spacing: 3px; border-bottom: 1px solid #000">DIVIDED WORLD</div><div style="margin: 20px 8px; height: 200px; border: 1px solid #000"></div></div>
    <div aria-hidden="true" style="position: absolute; inset: 0; background: rgba(7,5,13,.62)"></div>
    <section role="dialog" aria-label="These are your orbs" class="piece" style="position: absolute; left: 8px; right: 8px; top: 432px; padding: 18px 16px; --ground: #07050d; --edge: #a78bfa; --cut: 16px; color: #f1ecff">
      <div class="by"><img src="${GABE}" alt="" style="width: 48px; height: 48px"><div><b style="font-size: 28px">THESE ARE YOUR ORBS</b><span style="font-weight: 800; letter-spacing: 2px; color: #c4b5fd">GABE &middot; THE HUD, 2 OF 3</span></div></div>
      <p style="margin: 12px 0 14px; font: 500 19px/1.45 'Barlow Condensed', sans-serif">Reactions to your characters fill them at the settlement. Until then, hatched fill shows where you're headed. There is a most you can hold, so spend it.</p>
      <div class="btns" style="justify-content: flex-end"><button class="btn" style="min-height: 46px; padding: 0 16px"><b>SKIP ALL TIPS</b></button><button class="btn primary" style="min-height: 46px; padding: 0 18px"><b>GOT IT</b></button></div>
    </section>
    <section aria-label="Game HUD" style="position: absolute; left: 0; right: 0; bottom: 0; height: 128px; background: linear-gradient(#140c2c, #07050d); border-top: 1.5px solid rgba(201,248,255,.7); color: #f1ecff">
      <div style="position: absolute; left: 12px; top: 10px; width: 44px; height: 44px; border: 2px solid #19e3ff; display: grid; place-items: center; font: 28px Anton, Impact, sans-serif; opacity: .5">N</div>
      <div style="position: absolute; left: 66px; top: 6px; opacity: .5"><div style="font: 800 15px 'Barlow Condensed', sans-serif; letter-spacing: 2px">POSTING AS</div><div style="font: 24px/1.1 Anton, Impact, sans-serif">NEWCOMER &#x2304;</div></div>
      <div style="position: absolute; left: 6px; right: 6px; top: 66px; height: 54px; border: 2px solid #19e3ff; box-shadow: 0 0 18px rgba(25,227,255,.55); display: flex; align-items: center; gap: 6px; padding: 0 8px">${'<span style="width: 32px; height: 32px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #4a4466, #0d0a18)"></span>'.repeat(6)}<b style="margin-left: auto; font: 34px Anton, Impact, sans-serif">0.00</b></div>
    </section>
  </figure>
</div>`,
});

/* ---------------------------------------------------------------- batch 3: characters */

const CLASSES = [
  ['FACE', '#3aa0ff', ['', '+', '-', ''], 'The crowd\'s favorite. Earns from excited, positive reactions, and from the cheers a post draws after its Sweet card lands there.', 'Hurt by bored reactions, and by a card that outdraws the post it was played on.'],
  ['HEEL', '#ff3d6e', ['+', '', '', '-'], 'Earns heat: excited, negative reactions, and a Salty card that outdraws the post it lands on.', 'Hurt by the polite shrug, calm and positive.'],
  ['JABRONI', '#ffd23f', ['', '-', '+', ''], 'Anti-comedy: posts built to bomb. Earns from bored, negative reactions and from Salty cards others land on its posts.', 'Hurt by being taken sincerely, excited and positive.'],
  ['TECHNICIAN', '#2ee59d', ['-', '', '', '+'], 'The respected regular. Earns from calm, positive reactions to its posts and cards, and more when an old post of its own still draws them.', 'Hurt by heat: excited, negative reactions.'],
  ['LURKER', '#a78bfa', ['', '', '', ''], 'Reads the room. Earns by reacting early in the direction a post ends up, by spinning threads others reply to, and from reactions to its cards.', 'Hurt by posting more than three times in one settlement window (1 day).'],
];
const miniGrid = (cells, c) => `<div aria-hidden="true" style="display: grid; grid-template-columns: 26px 26px; gap: 4px; margin-top: 12px">${cells.map((x) => `<span style="width: 26px; height: 26px; box-sizing: border-box; display: grid; place-items: center; font: 800 15px 'Barlow Condensed', sans-serif; ${x === '+' ? `background: ${c}; color: #07050d` : x === '-' ? 'border: 1px dashed #ff5c8a; color: #ff5c8a' : `border: 1px ${c === '#a78bfa' ? 'dashed' : 'solid'} rgba(241,236,255,.3)`}">${x === '-' ? '&minus;' : x}</span>`).join('')}</div>`;
const classCard = ([n, c, cells, earns, hurt], on) => `<label class="cls${on ? ' on' : ''}" style="--c: ${c}"><input type="radio" name="cls"${on ? ' checked' : ''}><h4>${n}</h4>${miniGrid(cells, c)}<p>${earns}</p><p class="hurt">${hurt}</p></label>`;
const carouselHead = (label, count) => `<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; padding-right: 8px">
        <h3 class="sec" style="margin: 0">${label}</h3>
        <div style="display: flex; align-items: center; gap: 10px"><span style="font: 800 22px 'Barlow Condensed', sans-serif; letter-spacing: 2px; color: #c9f8ff">${count}</span><button class="btn" aria-label="Previous" disabled style="min-height: 44px; padding: 0 14px; opacity: .45"><b>&lsaquo;</b></button><button class="btn" aria-label="Next" style="min-height: 44px; padding: 0 14px"><b>&rsaquo;</b></button></div>
      </div>`;
const opt = (t, d, on, name) => `<label class="opt${on ? ' on' : ''}"><input type="radio" name="${name}"${on ? ' checked' : ''}><b>${t}</b><span>${d}</span></label>`;
const foot = (note, cancel, go, disabled) => `<div style="display: flex; justify-content: space-between; align-items: center; gap: 40px; padding-top: 26px; border-top: 1px solid rgba(241,236,255,.22)">
      <p class="note" style="margin: 0; max-width: 620px">${note}</p>
      <div class="btns" style="flex: none"><button class="btn"><b>${cancel}</b></button><button class="btn primary"${disabled ? ' aria-disabled="true" style="opacity: .5; box-shadow: none"' : ''}><b>${go}</b></button></div>
    </div>`;
const CHAR_TABS = ['ALERTS', 'VENDING MACHINE', 'MY CHARACTERS', 'SEASON', 'MY LOG', 'GUIDE', 'UPDATES', 'SETTINGS'];
const pageLead = (t, top = 238) => `<p class="lead" style="position: absolute; left: 64px; top: ${top}px; max-width: 760px">${t}</p>`;

page({
  file: '23-new-character.html', name: 'New character', w: 1440, h: 1720,
  note: 'A name typed, Face chosen. The lead under the title (PageHead), the classes as the Turn board\'s carousel with each card\'s earns and hurts set apart, each section 44px from the next, and the footer\'s summary beside its two buttons.',
  body: frame(1440, 1720, `
  ${smoke(1440, 1720, [[40, 220, 1360, 1460, .9]])}
  ${menu(CHAR_TABS, 'MY CHARACTERS')}
  ${title('NEW CHARACTER')}
  ${pageLead('This page is out of character and only you can see it. Nobody else can tell who plays a character.')}
  <form aria-label="New character" style="position: absolute; left: 64px; top: 312px; width: 1312px">
    <div class="field" style="width: 680px"><label for="nm">NAME</label><input id="nm" type="text" value="Waiting Wanda"><div class="count"><span>Letters, marks, digits and single spaces. Names are unique, look-alikes included.</span><span>13 of 40</span></div></div>
    <fieldset style="margin: 44px 0 0; padding: 0; border: 0; width: 1312px; overflow: hidden">
      <legend hidden>Class</legend>
      ${carouselHead('CLASS', '1&ndash;5 OF 5')}
      <div role="radiogroup" aria-label="Class" style="display: flex; gap: 33px">${CLASSES.map((c, i) => classCard(c, i === 0)).join('')}</div>
      <p class="note" style="margin-top: 14px">Only you will know its class, unless you choose to reveal it.</p>
    </fieldset>
    <fieldset style="margin: 44px 0 0; padding: 0; border: 0"><legend class="sec">WHEN IT DEBUTS</legend>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px">${opt('DROP NOW', 'It is on the board at once, and can post at once.', true, 'when')}${opt('DEBUT AT THE SETTLEMENT', 'It waits, seen by no one but you, and debuts at the next settlement.', false, 'when')}</div>
    </fieldset>
    <fieldset style="margin: 44px 0 0; padding: 0; border: 0"><legend class="sec">HOW LOUD</legend>
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px">${opt('SILENT', "Nobody is told. Its first post is its entrance.", false, 'loud')}${opt('ANNOUNCED', 'The System posts that Waiting Wanda debuts, never as what.', true, 'loud')}${opt('ANNOUNCED, WITH ITS CLASS', "The System also says what class it is, and that stays public. This can't be taken back.", false, 'loud')}</div>
    </fieldset>
    <section style="margin: 44px 0 0"><h3 class="sec">WHAT EVERYONE WILL SEE</h3>
      <div class="preview"><div><b>The System</b><br><span style="font-size: 11px; color: #444">At once, in the season's Turns thread.</span></div><div><b>Waiting Wanda</b> debuts.</div></div>
    </section>
    <div style="margin-top: 44px">${foot('Waiting Wanda is on the board as soon as you make it, and The System announces it. Its class stays yours alone.', 'CANCEL', 'MAKE THE CHARACTER')}</div>
  </form>
`),
});

/** A dialog in #202's one frame (the Reveal modal's look), its border on the cut, over a dimmed My characters. */
const dialog = (w, h, dw, crumbs, heading, inner) => `<div style="width: ${w}px; height: ${h}px; position: relative; overflow: hidden; background: #07050d; color: #f1ecff; font-family: 'Barlow Condensed', sans-serif">
  ${smoke(w, h, [[0, 0, w, h, .4]])}
  ${menu(CHAR_TABS, 'MY CHARACTERS')}
  ${title('YOUR CHARACTERS')}
  <div aria-hidden="true" style="position: absolute; inset: 0; z-index: 6; background: rgba(7,5,13,.72)"></div>
  <section role="dialog" aria-labelledby="dlgH" class="piece" style="position: absolute; z-index: 7; left: ${(w - dw) / 2}px; top: 120px; width: ${dw}px; box-sizing: border-box; padding: 38px 40px 34px; --cut: 40px; --edge: #19e3ff; --ground: #07050d">
    <button class="btn" aria-label="Close" style="position: absolute; right: 40px; top: 34px; min-height: 52px; width: 52px; padding: 0; transform: none"><b style="transform: none; font: 400 30px/1 'Barlow Condensed', sans-serif">&times;</b></button>
    <p style="margin: 0; font: 800 21px 'Barlow Condensed', sans-serif; letter-spacing: 3px; color: #19e3ff">${crumbs}</p>
    <h2 id="dlgH" style="margin: 2px 0 26px; font: 60px/1 Anton, Impact, sans-serif; letter-spacing: .5px">${heading}</h2>
    ${inner}
  </section>
</div>`;

page({
  file: '24-debut.html', name: 'How a character debuts', w: 1440, h: 1000,
  note: 'The Debut dialog, choosing how, for a character waiting to debut: How loud as one row of three, as the Turn board sets it.',
  body: dialog(1440, 1000, 1100, 'MY CHARACTERS &rsaquo; DEBUT', 'HOW WAITING WANDA DEBUTS', `
    <fieldset style="margin: 0; padding: 0; border: 0"><legend class="sec">HOW LOUD</legend>
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px">${opt('SILENT', 'Nobody is told. Waiting Wanda simply appears.', false, 'dl')}${opt('ANNOUNCED', 'The System posts that Waiting Wanda debuts, never as what.', true, 'dl')}${opt('ANNOUNCED, WITH ITS CLASS', "The System also says what class Waiting Wanda is, and that stays public. This can't be taken back.", false, 'dl')}</div>
    </fieldset>
    <section style="margin: 36px 0"><h3 class="sec">WHAT EVERYONE WILL SEE</h3>
      <div class="preview"><div><b>The System</b><br><span style="font-size: 11px; color: #444">In the tally at the next settlement, in the season's Turns thread.</span></div><div><b>Waiting Wanda</b> debuts.</div></div>
    </section>
    ${foot('It debuts at the next settlement, in 7 h 42 min. Until then you can drop it now instead.', 'CANCEL', 'SAVE HOW IT DEBUTS')}
  `),
});

page({
  file: '25-reveal.html', name: "Reveal a character's class", w: 1440, h: 1000,
  note: 'The Reveal modal for Pipewrench, a board chosen: Board and Thread as one row of two equal fields, the count on its field\'s own line.',
  body: dialog(1440, 1000, 1100, 'MY CHARACTERS &rsaquo; REVEAL', "REVEAL PIPEWRENCH'S CLASS", `
    <p class="lead" style="max-width: 820px; font-weight: 500">Pipewrench is a Heel. This shows everyone that, as checked by The System, as Pipewrench's own post. Anyone can react to it or spin a thread from it, and this can't be taken back.</p>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 28px">
      <div class="field"><label>BOARD</label><select class="sel" style="width: 100%"><option>General</option></select></div>
      <div class="field"><label>THREAD</label><select class="sel" style="width: 100%"><option>who keeps splatting my posts</option></select></div>
    </div>
    <div class="field" style="margin-top: 24px"><label>IN THE CHARACTER'S WORDS (OPTIONAL)</label><input type="text" value="Took you long enough."><div class="count"><span>Plain text.</span><span>21 of 200</span></div></div>
    <section style="margin: 28px 0 30px"><h3 class="sec">WHAT EVERYONE WILL SEE</h3>
      <div class="preview"><div><b>Pipewrench</b><br><span style="font-size: 11px; color: #444">At once, in the thread you choose.</span></div><div><b>Pipewrench revealed: Heel</b><br>Took you long enough.</div></div>
    </section>
    ${foot('The reveal is checked by The System and posted at once.', 'CANCEL', 'REVEAL PIPEWRENCH AS A HEEL')}
  `),
});

page({
  file: '26-edit-profile.html', name: 'Edit profile', w: 1440, h: 1420,
  note: 'Edit Mrs. Hooligan: the fields on the left, each count on its field\'s own line; on the right, the postbit as the board shows it, live; the avatar\'s picture chosen with a glass button, its two crops shown.',
  body: frame(1440, 1420, `
  ${smoke(1440, 1420, [[40, 220, 760, 1150, .9], [840, 220, 560, 900, .85]])}
  ${menu(CHAR_TABS, 'MY CHARACTERS')}
  ${title('EDIT MRS. HOOLIGAN')}
  ${pageLead('What you set here is public: it shows beside Mrs. Hooligan\'s posts.')}
  <form aria-label="Profile" style="position: absolute; left: 64px; top: 312px; width: 700px">
    <div class="field"><label>CHARACTER</label><select class="sel" style="width: 100%"><option>Mrs. Hooligan</option></select></div>
    <div class="field" style="margin-top: 30px"><label>TITLE</label><input type="text" value="Magenta enthusiast (classier)"><div class="count"><span>Under the name on every post.</span><span>29 of 40</span></div></div>
    <div class="field" style="margin-top: 30px"><label>SIGNATURE</label><textarea style="box-sizing: border-box; width: 100%; height: 120px; padding: 12px 16px; background: rgba(18,12,36,.9); border: 1px solid #19e3ff; color: #f1ecff; font: 600 21px/1.4 'Barlow Condensed', sans-serif">[i]not the ink. never the ink.[/i]</textarea><div class="count"><span>BBCode, as in a post.</span><span>34 of 500</span></div></div>
    <div class="field" style="margin-top: 30px"><label>PIP STYLE</label><select class="sel" style="width: 100%"><option>Default</option></select></div>
    <div class="btns" style="margin-top: 30px"><button class="btn primary"><b>SAVE THE PROFILE</b></button></div>
    <section style="margin-top: 50px; padding-top: 34px; border-top: 1px solid rgba(241,236,255,.22)">
      <h2 style="margin: 0 0 10px; font: 44px/1 Anton, Impact, sans-serif">AVATAR</h2>
      <p class="note" style="margin: 0 0 20px">Choose one picture. It is cut in your browser and only the two crops are sent, as plain pictures with nothing else in them; the original stays with you. The portrait is shown beside your posts on a wide screen; the square is shown in lists and on a phone.</p>
      <div style="display: flex; gap: 22px; align-items: flex-end">
        <div aria-hidden="true" style="width: 120px; height: 160px; background: repeating-linear-gradient(135deg, #1b1630 0 10px, #241d40 10px 20px); border: 1px solid rgba(241,236,255,.3)"></div>
        <div aria-hidden="true" style="width: 72px; height: 72px; background: repeating-linear-gradient(135deg, #1b1630 0 10px, #241d40 10px 20px); border: 1px solid rgba(241,236,255,.3)"></div>
        <div><p class="note" style="margin: 0 0 12px">No picture yet.</p><label class="btn"><input type="file" style="position: absolute; opacity: 0; width: 1px"><b>CHOOSE A PICTURE</b></label></div>
      </div>
    </section>
  </form>
  <aside aria-labelledby="pvH" style="position: absolute; left: 860px; top: 312px; width: 516px">
    <h3 id="pvH" class="sec">WHAT EVERYONE WILL SEE</h3>
    <div class="preview" style="grid-template-columns: 170px 1fr">
      <div><b><u>Mrs. Hooligan</u></b><br>Magenta enthusiast (classier)<br><span>&#9632;&#9632;&#9632;&#9633;&#9633;&#9633;</span><div style="margin: 8px 0; width: 60px; height: 80px; border: 1px solid #000; display: grid; place-items: center">M</div><span style="font-size: 11px; color: #444">Posts: 11<br>Joined Oct 2026</span></div>
      <div>Magenta is a very popular color.<div style="margin-top: 60px; padding-top: 6px; border-top: 1px solid #999; font-style: italic">not the ink. never the ink.</div></div>
    </div>
    <p class="note">The preview follows what you type. Nothing changes on the board until you save.</p>
  </aside>
`),
});

page({
  file: '27-characters-phone.html', name: 'Characters on a phone', w: 1660, h: 884,
  note: 'Four phone screens at 390 by 844: New character at its class carousel, the Debut dialog as a sheet, Edit profile, and My characters\' title with its count on a line of its own.',
  body: `<div style="width: 1660px; height: 884px; display: flex; gap: 20px; padding: 20px; box-sizing: border-box; background: #2a2833; font-family: 'Barlow Condensed', sans-serif">
  ${phone('New character', `${phoneMenu}
    <section style="position: absolute; left: 16px; top: 90px; width: 358px">
      ${carouselHead('CLASS', '1 OF 5')}
      <div style="display: flex; gap: 14px; width: 600px">${classCard(CLASSES[0], true).replace('width:236px', '')}${classCard(CLASSES[1], false)}</div>
      <p class="note" style="font-size: 19px">Only you will know its class, unless you choose to reveal it.</p>
      <h3 class="sec" style="margin-top: 30px">WHEN IT DEBUTS</h3>
      ${opt('DROP NOW', 'It is on the board at once, and can post at once.', true, 'pw')}
    </section>`, [[0, 80, 390, 760, .9]], 'r1').replace('class="cls on" style="--c: #3aa0ff"', 'class="cls on" style="--c: #3aa0ff; width: 300px"')}
  <figure aria-label="Debut, as a sheet" style="margin: 0; width: 390px; height: 844px; position: relative; overflow: hidden; background: #07050d; color: #f1ecff; flex: none">
    <div aria-hidden="true" style="position: absolute; inset: 0; background: rgba(7,5,13,.72)"></div>
    <section class="piece" style="position: absolute; left: 0; right: 0; top: 40px; bottom: 0; padding: 22px 16px; --cut: 20px; --edge: #19e3ff; --ground: #07050d">
      <button class="btn" aria-label="Close" style="position: absolute; right: 16px; top: 18px; min-height: 46px; width: 46px; padding: 0; transform: none"><b style="transform: none; font: 400 26px/1 'Barlow Condensed', sans-serif">&times;</b></button>
      <p style="margin: 0; font: 800 18px 'Barlow Condensed', sans-serif; letter-spacing: 2px; color: #19e3ff">MY CHARACTERS &rsaquo; DEBUT</p>
      <h2 style="margin: 4px 60px 18px 0; font: 34px/1.05 Anton, Impact, sans-serif">HOW WAITING WANDA DEBUTS</h2>
      <div style="display: grid; gap: 10px">${opt('SILENT', 'Nobody is told. Waiting Wanda simply appears.', false, 'pd')}${opt('ANNOUNCED', 'The System posts that Waiting Wanda debuts, never as what.', true, 'pd')}${opt('ANNOUNCED, WITH ITS CLASS', "The System also says what class Waiting Wanda is. This can't be taken back.", false, 'pd')}</div>
      <div class="btns" style="position: absolute; left: 16px; right: 16px; bottom: 18px; justify-content: stretch"><button class="btn" style="flex: 1"><b>CANCEL</b></button><button class="btn primary" style="flex: 2"><b>SAVE</b></button></div>
    </section>
  </figure>
  ${phone('Edit profile', `${phoneMenu}${pTitle('EDIT MRS.<br>HOOLIGAN')}
    <form style="position: absolute; left: 16px; top: 236px; width: 358px">
      <p class="lead" style="font-size: 20px; font-weight: 500">What you set here is public: it shows beside Mrs. Hooligan's posts.</p>
      <div class="field" style="margin-top: 20px"><label>TITLE</label><input type="text" value="Magenta enthusiast (classier)"><div class="count"><span></span><span>29 of 40</span></div></div>
      <div class="field" style="margin-top: 18px"><label>SIGNATURE</label><textarea style="box-sizing: border-box; width: 100%; height: 96px; padding: 10px 14px; background: rgba(18,12,36,.9); border: 1px solid #19e3ff; color: #f1ecff; font: 600 20px/1.4 'Barlow Condensed', sans-serif">[i]not the ink. never the ink.[/i]</textarea><div class="count"><span>BBCode, as in a post.</span><span>34 of 500</span></div></div>
      <div class="btns" style="margin-top: 18px"><button class="btn primary" style="width: 100%"><b>SAVE THE PROFILE</b></button></div>
    </form>`, [[0, 220, 390, 600, .9]], 'r3')}
  ${phone('My characters', `${phoneMenu}
    <h1 style="position: absolute; left: 16px; top: 92px; margin: 0; font: 60px/1 Anton, Impact, sans-serif; text-shadow: 0 0 24px rgba(25,227,255,.35)">YOUR<br>CHARACTERS</h1>
    <p style="position: absolute; left: 16px; top: 222px; margin: 0; font: 30px Anton, Impact, sans-serif; color: #e4def7">3 OF 6</p>
    <p class="lead" style="position: absolute; left: 16px; top: 272px; width: 358px; font-size: 20px">This page is out of character and only you can see it. Classes are shown here and nowhere else unless you reveal them.</p>`, [[0, 260, 390, 140, .85]], 'r4')}
</div>`,
});

/* ---------------------------------------------------------------- batch 4: the Lens and My log's states */

const WHOOPS = '#ff3db4';
const lensBtn = (t, kind = '') => `<button class="btn${kind === 'ink' ? '' : ''}" style="min-height: 46px; padding: 0 16px; font-size: 19px${kind === 'ink' ? `; border-color: ${WHOOPS}; color: #ffffff; box-shadow: 0 0 14px rgba(255,61,180,.45); background: rgba(255,61,180,.16)` : ''}"><b>${t}</b></button>`;
/** The Lens: a panel docked at the right, from the page's top to just over the HUD, its bar (tabs, Close) sticky, its body scrolling. */
const lens = ({ tabs, current, ink, headline, body, tools, plays, play }) => `<section role="dialog" aria-label="Cards on this post" class="piece" style="--cut: 24px; --edge: ${ink}; --ground: #0b0818; position: absolute; right: 16px; top: 16px; width: 460px; height: 764px; box-sizing: border-box; color: #f1ecff">
    <div style="position: absolute; left: 1.5px; right: 1.5px; top: 1.5px; padding: 16.5px 20.5px 14px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(241,236,255,.22)">
      <div role="tablist" style="position: relative; display: flex; gap: 6px; width: 330px; overflow: hidden; padding-right: 8px">${tabs.length > 2 ? '<span aria-hidden="true" style="position: absolute; z-index: 1; right: 0; top: 0; bottom: 0; width: 70px; background: linear-gradient(to right, rgba(11,8,24,0), #0b0818 80%)"></span>' : ''}${tabs.map((t) => `<button role="tab" aria-selected="${t === current}" class="tab" style="flex: none; min-height: 46px; padding: 0 14px; font-size: 20px${t === current ? `; background: ${ink}; color: #07050d` : '; border: 1px solid rgba(241,236,255,.5)'}"><b>${t}</b></button>`).join('')}</div>
      <button class="btn" aria-label="Close" style="min-height: 46px; width: 46px; padding: 0; transform: none"><b style="transform: none; font: 400 28px/1 'Barlow Condensed', sans-serif">&times;</b></button>
    </div>
    <div style="position: absolute; left: 0; right: 0; top: 80px; bottom: 0; overflow: hidden; padding: 20px 22px">
      <h2 style="margin: 0 0 8px; font: 30px/1.1 Anton, Impact, sans-serif; letter-spacing: .3px">${headline}</h2>
      <p style="margin: 0 0 16px; font: 500 20px/1.45 'Barlow Condensed', sans-serif; color: #e4def7">${body}</p>
      ${tools}
      <button aria-expanded="true" style="display: flex; gap: 10px; align-items: baseline; width: 100%; margin: 22px 0 12px; padding: 12px 0 0; border: 0; border-top: 1px solid rgba(241,236,255,.22); background: none; color: #f1ecff; text-align: left; font: 800 21px 'Barlow Condensed', sans-serif; letter-spacing: 1px"><span aria-hidden="true">&#x2304;</span>${plays}</button>
      ${play}
    </div>
    <div aria-hidden="true" style="position: absolute; left: 1.5px; right: 1.5px; bottom: 1.5px; height: 56px; background: linear-gradient(transparent, #0b0818)"></div>
  </section>`;
const playPlate = (layer, who, whoInk, when, words, acts) => `<article style="padding: 14px 16px 16px; border: 1px solid ${whoInk}; background: rgba(255,255,255,.03)">
        <p style="margin: 0; font: 800 19px 'Barlow Condensed', sans-serif; letter-spacing: 1px; color: #e4def7">${layer}</p>
        <p style="margin: 6px 0 0; font: 500 20px 'Barlow Condensed', sans-serif"><b style="font: 26px Anton, Impact, sans-serif; color: ${whoInk}">${who}</b> &middot; played ${when}</p>
        <p style="margin: 6px 0 14px; font: italic 600 21px 'Barlow Condensed', sans-serif">&ldquo;${words}&rdquo;</p>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px">${acts.map((a) => `<button class="btn" style="min-height: 44px; padding: 0 10px; font-size: 18px"><b>${a}</b></button>`).join('')}</div>
      </article>`;
const threadBehind = `<div aria-hidden="true" style="position: absolute; left: 240px; top: 0; width: 960px; color: #000; font: 13px Verdana, sans-serif">
    <div style="padding: 14px 0 8px; border-bottom: 1px solid #000; font: 700 18px 'Courier New', monospace; letter-spacing: 3px">DIVIDED WORLD</div>
    <div style="margin: 30px 0 10px; font: 700 17px 'Courier New', monospace">who keeps splatting my posts</div>
    <div style="height: 190px; border: 1px solid #000; background: linear-gradient(100deg, #e83fc8 0 12%, #d9b93a 12% 70%, #e8954a 70%)"></div>
    <div style="margin-top: -1px; height: 150px; border: 1px solid #000"></div><div style="margin-top: -1px; height: 140px; border: 1px solid #000"></div><div style="margin-top: -1px; height: 200px; border: 1px solid #000"></div>
  </div>
  <div aria-hidden="true" style="position: absolute; left: 0; right: 0; bottom: 0; height: 196px; background: linear-gradient(#140c2c, #07050d); border-top: 1.5px solid rgba(201,248,255,.7)"></div>`;
const PLAY_ACTS = ['+ REACT', 'SPIN THREAD', 'AS IT LANDED', 'GO TO POST'];

page({
  file: '28-lens.html', name: 'The Lens', w: 1440, h: 1000,
  note: 'The Lens on Whoops!, its plays unfolded, as a reader sees it over the Main board\'s thread (the board world behind it and the HUD below are drawn for place only and not compared). Docked at the right from the page\'s top to just over the HUD; the bar sticky; the body scrolls, its foot fading.',
  body: `<div style="width: 1440px; height: 1000px; position: relative; overflow: hidden; background: #ffffff; font-family: 'Barlow Condensed', sans-serif">
  ${threadBehind}
  ${lens({ tabs: ['WHOOPS!', 'STICK AROUND', 'GLITTER BOMB', 'AUTOCORRECT', 'FORCE FIELD'], current: 'WHOOPS!', ink: WHOOPS,
    headline: '41% washed for you',
    body: 'Ends on your screen when you scrub every layer off. The author can wash it for everyone.',
    tools: `<div class="btns">${lensBtn('HOLD TO SCRUB', 'ink')}</div>`,
    plays: '3 plays &middot; Gloomba, Pipewrench, Mrs. Hooligan',
    play: playPlate('LAYER 3 OF 3, ON TOP &middot; 41% WASHED', 'GLOOMBA', '#ffd23f', 'Oct 29, 2026, 9:49 PM', "fine, I'll do it myself", PLAY_ACTS) })}
</div>`,
});

/* The Lens's other two states, the panel alone: compared from its own corner (a manifest's origin). */
page({
  file: '29-lens-states.html', name: 'The Lens, two states', w: 1000, h: 800,
  note: 'Two Lens panels at the size 28-lens.html docks them: on Stick Around (a reader), and the author\'s Lens on Whoops!, whose tools (Wash, Write in ink) stand in one row with Hold to scrub.',
  body: `<div style="width: 1000px; height: 800px; position: relative; overflow: hidden; background: #2a2833; font-family: 'Barlow Condensed', sans-serif">
  <div style="position: absolute; left: -940px; top: 0; width: 1440px; height: 800px">${lens({ tabs: ['WHOOPS!', 'STICK AROUND'], current: 'STICK AROUND', ink: '#19e3ff',
    headline: 'Holding you on this post',
    body: "Ends when you check the caster's sentence, scroll past either end of the post, or press Break free.",
    tools: '',
    plays: '1 play &middot; Professor Hootenanny McGillicuddy III',
    play: playPlate('THE ONE PLAY', 'PROFESSOR HOOTENANNY MCGILLICUDDY III', '#19e3ff', 'Oct 29, 2026, 9:50 PM', 'required reading', PLAY_ACTS) })}</div>
  <div style="position: absolute; left: -440px; top: 0; width: 1440px; height: 800px">${lens({ tabs: ['WHOOPS!', 'STICK AROUND'], current: 'WHOOPS!', ink: WHOOPS,
    headline: '41% washed for you',
    body: 'Ends on your screen when you scrub every layer off. As its author, you can wash it for everyone.',
    tools: `<p style="margin: 0 0 8px; font: 800 19px 'Barlow Condensed', sans-serif; letter-spacing: 1.5px; color: #e4def7">YOUR TOOLS, AS THE AUTHOR</p><div class="btns" style="gap: 8px">${lensBtn('HOLD TO SCRUB', 'ink')}${lensBtn('WASH')}${lensBtn('WRITE IN INK')}</div>`,
    plays: '3 plays &middot; Gloomba, Pipewrench, Mrs. Hooligan',
    play: playPlate('LAYER 3 OF 3, ON TOP &middot; 41% WASHED', 'GLOOMBA', '#ffd23f', 'Oct 29, 2026, 9:49 PM', "fine, I'll do it myself", ['+ REACT', 'SPIN THREAD']) })}</div>
</div>`,
});

const LOG_TABS = ['ALL', 'PIPEWRENCH', 'MRS. HOOLIGAN', 'SPRITEY'];
const logTabs = (cur, right = 64, top = 180) => `<div role="tablist" aria-label="Characters" style="position: absolute; right: ${right}px; top: ${top}px; display: flex; gap: 8px">${LOG_TABS.map((t) => `<button role="tab" aria-selected="${t === cur}" class="btn${t === cur ? ' primary' : ''}"><b>${t}</b></button>`).join('')}</div>`;
const logHead = `<div role="row" style="display: grid; grid-template-columns: 170px 250px 1fr 120px 120px; padding: 0 0 12px; border-bottom: 1px solid rgba(201,248,255,.5); font: 800 20px 'Barlow Condensed', sans-serif; letter-spacing: 2px; color: #19e3ff"><span>WHEN (UTC)</span><span>WHAT</span><span>DETAILS</span><span style="text-align: right">AURA</span><span style="text-align: right">WALLET</span></div>`;

page({
  file: '30-log-empty.html', name: 'My log, before anything has settled', w: 1440, h: 1000,
  note: 'My log for a character with no settlement yet: the table keeps its shape, its head and one row saying what will be its first line and when.',
  body: frame(1440, 1000, `
  ${smoke(1440, 1000, [[40, 230, 1360, 520, .9]])}
  ${menu(PAUSE, 'MY LOG')}
  ${title('MY LOG')}
  ${logTabs('MRS. HOOLIGAN')}
  ${pageLead("Everything on this page is true. Each line names the Act that did it, what it changed and how much Aura moved. It never says who reacted, or any character's class but your own.")}
  <section role="table" aria-label="Mrs. Hooligan's log" style="position: absolute; left: 64px; top: 360px; width: 1312px">
    ${logHead}
    <div role="row" style="display: grid; grid-template-columns: 170px 250px 1fr 240px; align-items: center; padding: 26px 0; border-bottom: 1px solid rgba(241,236,255,.22)">
      <span style="font: 500 21px 'Barlow Condensed', sans-serif; color: #e4def7">Oct 30 &middot; 08:17</span>
      <b style="font: 800 22px 'Barlow Condensed', sans-serif">Nothing yet</b>
      <span style="font: 500 21px/1.5 'Barlow Condensed', sans-serif">Nothing has settled for Mrs. Hooligan yet. Its first settlement, in 7 h 42 min, is the first line here.</span>
      <span style="text-align: right; font: 600 21px 'Barlow Condensed', sans-serif; color: #e4def7">&mdash;</span>
    </div>
    <p class="note" style="margin-top: 22px">If a line here looks wrong, that is a bug and not the game. <a href="#" class="lnk">Tell an admin</a>.</p>
  </section>
`),
});

const sub = (label, amt, neg) => `<div style="display: grid; grid-template-columns: 1fr 120px 120px; padding: 10px 0; border-bottom: 1px solid rgba(241,236,255,.14); font: 800 20px 'Barlow Condensed', sans-serif"><span>${label}</span><span style="text-align: right; color: ${neg ? '#ff8fb1' : '#19e3ff'}">${amt}</span><span></span></div>`;
const subPost = (link, kind, amt, neg) => `<div style="display: grid; grid-template-columns: 1fr 140px 120px 120px; padding: 8px 0 8px 18px; border-bottom: 1px solid rgba(241,236,255,.1); font: 500 20px 'Barlow Condensed', sans-serif"><a href="#" class="lnk" style="font-weight: 600">${link}</a><span style="font-weight: 800; letter-spacing: 2px; color: #c9f8ff">${kind}</span><span style="text-align: right; color: ${neg ? '#ff8fb1' : '#19e3ff'}">${amt}</span><span></span></div>`;

page({
  file: '31-log-open.html', name: "My log, a settlement's posts open", w: 1440, h: 1000,
  note: "My log for Pipewrench, its latest settlement's posts shown: every amount in the nested rows stands in the Aura column, as the settlement's own does, and the Wallet column is left empty there.",
  body: frame(1440, 1000, `
  ${smoke(1440, 1000, [[40, 230, 1360, 760, .92]])}
  ${menu(PAUSE, 'MY LOG')}
  ${title('MY LOG')}
  ${logTabs('PIPEWRENCH')}
  ${pageLead("Everything on this page is true. Each line names the Act that did it, what it changed and how much Aura moved. It never says who reacted, or any character's class but your own.")}
  <section role="table" aria-label="Pipewrench's log" style="position: absolute; left: 64px; top: 360px; width: 1312px">
    ${logHead}
    <div role="row" style="display: grid; grid-template-columns: 170px 250px 1fr 120px 120px; padding: 22px 0 14px; font: 500 21px/1.5 'Barlow Condensed', sans-serif">
      <span style="color: #e4def7">Oct 30 &middot; 08:17</span><b style="font-weight: 800">Settlement</b>
      <span>Scored as a Heel for Oct 29: drew heat +0.20, stole the thunder +0.20, shrugged off &minus;0.05.<br><button class="btn" aria-expanded="true" style="margin-top: 10px; min-height: 44px; padding: 0 16px; font-size: 19px"><b>HIDE POSTS</b></button></span>
      <span style="text-align: right; font-weight: 800; color: #19e3ff">+0.35</span><span style="text-align: right; font-weight: 800">4.72</span>
    </div>
    <div style="margin-left: 420px; padding: 4px 0 16px 0; border-bottom: 1px solid rgba(241,236,255,.22)">
      ${sub('Drew heat: excited, negative reactions to its posts and cards', '+0.20')}
      ${subPost('your post #43', 'HEAT', '+0.20')}
      ${sub("Stole the thunder: its Salty card on another's post drew more votes than the post this window", '+0.20')}
      ${subPost("your Whoops! on Gloomba's post #46", 'HEAT', '+0.20')}
      ${sub('Shrugged off: calm, positive reactions to its posts and cards', '&minus;0.05', true)}
      ${subPost('your post #43', 'CALM', '&minus;0.05', true)}
      <p class="note" style="margin-top: 14px">Each reason's total is exact. It is split across your posts by how the live estimate valued their reactions.</p>
    </div>
  </section>
`),
});

page({
  file: '32-lens-log-phone.html', name: 'The Lens and My log on a phone', w: 1250, h: 884,
  note: "Three phone screens at 390 by 844: the Lens as a sheet that ends above the HUD and scrolls inside, the character tabs as one scrolling row with the current one in view, and a settlement's posts open, each post's kind beside its link.",
  body: `<div style="width: 1250px; height: 884px; display: flex; gap: 20px; padding: 20px; box-sizing: border-box; background: #2a2833; font-family: 'Barlow Condensed', sans-serif">
  <figure aria-label="The Lens" style="margin: 0; width: 390px; height: 844px; position: relative; overflow: hidden; background: #ffffff; flex: none">
    <div aria-hidden="true" style="height: 260px; margin: 60px 8px 0; border: 1px solid #000; background: linear-gradient(100deg, #e83fc8 0 18%, #d9b93a 18% 70%, #e8954a 70%)"></div>
    <section class="piece" style="position: absolute; left: 0; right: 0; top: 300px; bottom: 124px; --cut: 18px; --edge: ${WHOOPS}; --ground: #0b0818; color: #f1ecff">
      <div style="padding: 12px 14px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(241,236,255,.22)"><div style="display: flex; gap: 6px"><button class="tab" style="min-height: 42px; padding: 0 12px; font-size: 19px; background: ${WHOOPS}; color: #07050d"><b>WHOOPS!</b></button><button class="tab" style="min-height: 42px; padding: 0 12px; font-size: 19px; border: 1px solid rgba(241,236,255,.5)"><b>STICK AROUND</b></button></div><button class="btn" aria-label="Close" style="min-height: 42px; width: 42px; padding: 0; transform: none"><b style="transform: none; font: 400 26px/1 'Barlow Condensed', sans-serif">&times;</b></button></div>
      <div style="padding: 12px 14px">
        <h2 style="margin: 0 0 6px; font: 24px/1.15 Anton, Impact, sans-serif">3 layers &middot; top: Gloomba's yellow, 41% washed</h2>
        <p style="margin: 0 0 12px; font: 500 19px/1.4 'Barlow Condensed', sans-serif; color: #e4def7">Ends on your screen when you scrub every layer off.</p>
        <div class="btns">${lensBtn('HOLD TO SCRUB', 'ink')}</div>
        <p style="margin: 14px 0 0; padding-top: 10px; border-top: 1px solid rgba(241,236,255,.22); font: 800 19px 'Barlow Condensed', sans-serif">&#x2304; 3 plays &middot; Gloomba, Pipewrench, Mrs. Hooligan</p>
      </div>
      <div aria-hidden="true" style="position: absolute; left: 1.5px; right: 1.5px; bottom: 1.5px; height: 40px; background: linear-gradient(transparent, #0b0818)"></div>
    </section>
    <div aria-hidden="true" style="position: absolute; left: 0; right: 0; bottom: 0; height: 124px; background: linear-gradient(#140c2c, #07050d); border-top: 1.5px solid rgba(201,248,255,.7)"></div>
  </figure>
  ${phone('My log, empty', `${phoneMenu}
    <h1 style="position: absolute; left: 16px; top: 92px; margin: 0; font: 64px/1 Anton, Impact, sans-serif; text-shadow: 0 0 24px rgba(25,227,255,.35)">MY LOG</h1>
    <div role="tablist" style="position: absolute; left: 16px; right: 0; top: 176px; display: flex; gap: 8px; overflow: hidden">${LOG_TABS.map((t) => `<button role="tab" class="btn${t === 'MRS. HOOLIGAN' ? ' primary' : ''}" style="flex: none; min-height: 46px; padding: 0 16px; font-size: 19px"><b>${t}</b></button>`).join('')}</div>
    <section style="position: absolute; left: 16px; top: 250px; width: 358px">
      <p class="lead" style="font-size: 19px; font-weight: 500">Everything on this page is true. Each line names the Act that did it, what it changed and how much Aura moved.</p>
      <div style="margin-top: 18px; padding: 16px 0; border-top: 1px solid rgba(201,248,255,.5); border-bottom: 1px solid rgba(241,236,255,.22)"><p style="margin: 0; font: 500 19px 'Barlow Condensed', sans-serif; color: #e4def7">Oct 30 &middot; 08:17</p><b style="font: 800 21px 'Barlow Condensed', sans-serif">Nothing yet</b><p class="note" style="margin-top: 6px; font-size: 19px">Its first settlement, in 7 h 42 min, is the first line here.</p></div>
    </section>`, [[0, 240, 390, 360, .9]], 's2')}
  ${phone('My log, posts open', `${phoneMenu}
    <section style="position: absolute; left: 16px; top: 90px; width: 358px; font-family: 'Barlow Condensed', sans-serif">
      <p style="margin: 0; font: 500 19px 'Barlow Condensed', sans-serif; color: #e4def7">Oct 30 &middot; 08:17 &middot; <b style="color: #f1ecff">Settlement</b></p>
      <div style="display: flex; justify-content: space-between; margin: 8px 0 12px; font: 800 20px 'Barlow Condensed', sans-serif"><span>AURA <span style="color: #19e3ff">+0.35</span></span><span>WALLET 4.72</span></div>
      <div style="padding-left: 14px; border-left: 1px solid #19e3ff">
        <div style="display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; font: 800 19px/1.3 'Barlow Condensed', sans-serif"><span>Drew heat: excited, negative reactions to its posts and cards</span><span style="color: #19e3ff">+0.20</span></div>
        <div style="display: flex; justify-content: space-between; padding: 6px 0 12px; border-bottom: 1px solid rgba(241,236,255,.14); font: 500 19px 'Barlow Condensed', sans-serif"><span><a href="#" class="lnk" style="font-size: 19px">your post #43</a> <b style="margin-left: 8px; letter-spacing: 2px; color: #c9f8ff">HEAT</b></span><span style="color: #19e3ff">+0.20</span></div>
        <div style="display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; font: 800 19px/1.3 'Barlow Condensed', sans-serif"><span>Shrugged off: calm, positive reactions to its posts and cards</span><span style="color: #ff8fb1">&minus;0.05</span></div>
        <div style="display: flex; justify-content: space-between; padding: 6px 0 12px; font: 500 19px 'Barlow Condensed', sans-serif"><span><a href="#" class="lnk" style="font-size: 19px">your post #43</a> <b style="margin-left: 8px; letter-spacing: 2px; color: #c9f8ff">CALM</b></span><span style="color: #ff8fb1">&minus;0.05</span></div>
      </div>
    </section>`, [[0, 80, 390, 460, .9]], 's3')}
</div>`,
});

/* ---------------------------------------------------------------- batch 5: account and HUD states */

const ART = '../../../instances/divided-world/ui/cards/';
const settingsRail = (cur) => `<nav aria-label="Settings sections" style="position: absolute; left: 64px; top: 262px; width: 254px"><ul style="margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px">${['ACCOUNT', 'ACCESSIBILITY', 'NOTIFICATIONS'].map((n) => `<li><a href="#" class="btn${n === cur ? ' primary' : ''}" style="display: flex; justify-content: flex-start"${n === cur ? ' aria-current="page"' : ''}><b>${n}</b></a></li>`).join('')}</ul>
    <p style="margin: 34px 0 0; padding-top: 22px; border-top: 1px solid rgba(241,236,255,.22)"><a href="#" class="lnk">Reach a person</a></p></nav>`;
const invite = (code, state, note, open) => `<li style="display: grid; grid-template-columns: 150px 1fr auto; align-items: center; gap: 18px; padding: 14px 0; border-top: 1px solid rgba(241,236,255,.14)">
          <code style="font: 700 22px 'Barlow Condensed', sans-serif; letter-spacing: 2px; color: ${open ? '#f1ecff' : '#a9a2c2'}">${code}</code>
          <span style="font: 500 20px 'Barlow Condensed', sans-serif; color: #e4def7"><b style="font-weight: 800; letter-spacing: 1.5px; color: ${open ? '#19e3ff' : '#e4def7'}">${state}</b> &middot; ${note}</span>
          ${open ? '<div class="btns" style="gap: 8px"><button class="btn" style="min-height: 44px; padding: 0 16px; font-size: 19px"><b>REISSUE</b></button></div>' : '<span></span>'}
        </li>`;

/* A stand-in for Postcard.tsx in the card template's layout (docs/plans/2026-11-05-card-template-design.md, "Low name"):
   2:3, a black border ringed and glowing in the card's color, the badges on the top border, the gem in the corner, the name
   plate across the art's lower third, the text plate under it, the price on the bottom border. Its box is what a board
   compares; the face itself is the card template's to draw. */
const postcard = (w) => { const u = w / 100; return `<figure aria-label="Whoops!, Salty, Cast, Common" style="position: relative; margin: 0; flex: none; width: ${w}px; height: ${w * 1.5}px; border-radius: ${7.5 * u}px; background: #050505; box-shadow: 0 0 0 2px #ff3d7f, 0 0 30px rgba(255,61,127,.6)">
      <div style="position: absolute; inset: ${5 * u}px; border-radius: ${2.5 * u}px; overflow: hidden; background: #22030f"><img src="${ART}whoops/art.svg" alt="" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover"></div>
      <span style="position: absolute; left: ${6 * u}px; top: ${2.2 * u}px; display: flex; gap: ${1.6 * u}px; transform: skewX(-12deg); font: italic 800 ${Math.min(18, 7.2 * u)}px/1.15 'Barlow Condensed', sans-serif; letter-spacing: .08em"><b style="padding: 0 .6em; background: #ff3d7f; color: #14030a">SALTY</b><b style="padding: 0 .6em; background: #050505; color: #ff3d7f; box-shadow: inset 0 0 0 1.5px #ff3d7f">CAST</b></span>
      <span style="position: absolute; left: ${4.5 * u}px; top: ${89 * u}px; width: 80%; height: ${15 * u}px; transform: skewX(-12deg); background: linear-gradient(90deg, rgba(0,0,0,.86), rgba(0,0,0,.6)); box-shadow: inset ${1.2 * u}px 0 0 #ff3d7f; display: flex; align-items: center; padding-left: ${6.5 * u}px"><b style="transform: skewX(12deg); font: ${11.5 * u}px/1 Anton, Impact, sans-serif; color: #fff">WHOOPS!</b></span>
      <span style="position: absolute; left: ${9 * u}px; right: ${9 * u}px; top: ${108 * u}px; bottom: ${9 * u}px; background: rgba(0,0,0,.72); border: 1px solid rgba(255,61,127,.55); color: #bbb; font: 600 ${6.6 * u}px/1.35 'Barlow Condensed', sans-serif; padding: ${3 * u}px ${4 * u}px">Splats a post in your ink. Readers scrub it; only the author can wash it.</span>
    </figure>`; };

page({
  file: '33-settings-account.html', name: 'Settings, Account', w: 1440, h: 1000,
  note: 'Settings › Account with two invites made, one open and one used: each invite a row with its state and, while unused, Reissue (its link is shown once, when made, and never again); Reach a person under the section rail, where every Settings section can reach it.',
  body: frame(1440, 1000, `
  ${smoke(1440, 1000, [[40, 240, 300, 340, .85], [350, 240, 990, 700, .92]])}
  ${menu(PAUSE, 'SETTINGS')}
  ${title('SETTINGS')}
  ${settingsRail('ACCOUNT')}
  <section aria-labelledby="accH" style="position: absolute; left: 370px; top: 262px; width: 920px">
    <h2 id="accH" style="margin: 0 0 12px; font: 52px/1 Anton, Impact, sans-serif; letter-spacing: .5px">ACCOUNT</h2>
    <p class="lead" style="margin-bottom: 22px">Out of character: what you sign in with, and who you bring in.</p>
    <div class="row"><h3>SIGN-IN ADDRESS</h3><div><p style="margin: 10px 0 0; font: 700 22px 'Barlow Condensed', sans-serif">demo-player@example.test</p><p class="note">The address the code and the link come to. It is not shown to anyone else.</p></div></div>
    <div class="row"><h3>INVITES</h3><div>
      <p class="note" style="margin-top: 10px">You hold 1 of 3 open invites. An invite is one use, and expires 7 days after it is made or reissued. One used or expired frees one.</p>
      <ul style="margin: 16px 0 0; padding: 0; list-style: none; border-bottom: 1px solid rgba(241,236,255,.14)">
        ${invite('ab12cd34', 'OPEN', 'expires Nov 12', true)}
        ${invite('9f3k2m7q', 'USED', 'Nov 2', false)}
      </ul>
      <div class="btns" style="margin-top: 18px"><button class="btn primary"><b>MAKE AN INVITE</b></button></div>
    </div></div>
    <div class="row" style="border-bottom: 1px solid rgba(241,236,255,.22)"><h3>SIGN OUT</h3><div><div class="btns"><button class="btn"><b>SIGN OUT</b></button></div><p class="note">Ends this session on this device. Your characters and settings stay with your account.</p></div></div>
  </section>
`),
});

page({
  file: '34-vending-info.html', name: "The Vending Machine's card info", w: 1440, h: 1000,
  note: "About Whoops!, from slot A2: the card's face beside its rules, its price said in words where the build writes \"1.00+\", in #202's one dialog frame at its heading size.",
  body: `<div style="width: 1440px; height: 1000px; position: relative; overflow: hidden; background: #07050d; color: #f1ecff; font-family: 'Barlow Condensed', sans-serif">
  ${smoke(1440, 1000, [[0, 0, 1440, 1000, .4]])}
  ${menu(PAUSE, 'VENDING MACHINE')}
  <div aria-hidden="true" style="position: absolute; left: 420px; top: 106px; width: 620px; height: 960px; border: 2px solid #ff3d6e; border-radius: 18px"></div>
  <div aria-hidden="true" style="position: absolute; inset: 0; z-index: 6; background: rgba(7,5,13,.72)"></div>
  <section role="dialog" aria-labelledby="infoH" class="piece" style="position: absolute; z-index: 7; left: 270px; top: 170px; width: 900px; box-sizing: border-box; padding: 38px 40px 34px; --cut: 40px; --edge: #19e3ff; --ground: #07050d; display: grid; grid-template-columns: 276px 1fr; column-gap: 40px">
    <button class="btn" aria-label="Close" style="position: absolute; right: 40px; top: 34px; min-height: 52px; width: 52px; padding: 0; transform: none"><b style="transform: none; font: 400 30px/1 'Barlow Condensed', sans-serif">&times;</b></button>
    ${postcard(276)}
    <div>
      <p style="margin: 0; font: 800 21px 'Barlow Condensed', sans-serif; letter-spacing: 3px; color: #19e3ff">SLOT A2 &middot; SALTY</p>
      <h2 id="infoH" style="margin: 2px 60px 18px 0; font: 60px/1 Anton, Impact, sans-serif">WHOOPS!</h2>
      <p style="margin: 0 0 18px; font: 700 24px 'Barlow Condensed', sans-serif">1.00 to buy <span style="font-weight: 500; color: #e4def7">&middot; more to play on a long post</span></p>
      <p style="margin: 0 0 14px; font: 500 21px/1.5 'Barlow Condensed', sans-serif">It splats a post in the ink you choose, and a reader can scrub the ink away on their own screen; the post's author can wash it away for everyone. Up to three can stack on one post, each in its own ink.</p>
      <p style="margin: 0; font: 500 21px/1.5 'Barlow Condensed', sans-serif; color: #e4def7">Playing it on a long post costs 0.25 more for every 500 characters, 3.00 at most in all.</p>
    </div>
  </section>
</div>`,
});

/* The HUD alone, at its 1440 width: compared from its own corner. */
page({
  file: '35-hud-cap.html', name: 'The HUD, a wallet past its cap', w: 1440, h: 230,
  note: "The HUD on a board page when the settled wallet is full and the estimate runs past the cap: the figure once, and the way out said under it (the orbs' own words, engine/ui/orbs/Orbs.board.stories.tsx, which the HUD drops today).",
  body: `<div style="width: 1440px; height: 230px; position: relative; overflow: hidden; background: #ffffff; font-family: 'Barlow Condensed', sans-serif">
  <section aria-label="Game HUD" style="position: absolute; left: 0; right: 0; bottom: 0; height: 210px; color: #f1ecff">
    <div aria-hidden="true" style="position: absolute; inset: 0; background: linear-gradient(#140c2c, #07050d); clip-path: polygon(0 26px, 452px 26px, 478px 0, 972px 0, 998px 26px, 100% 26px, 100% 100%, 0 100%)"></div>
    <div aria-hidden="true" style="position: absolute; left: 60px; top: 66px; width: 82px; height: 82px; border: 2px solid #19e3ff; box-shadow: 0 0 16px rgba(25,227,255,.6); display: grid; place-items: center; font: 40px Anton, Impact, sans-serif">M</div>
    <b style="position: absolute; left: 156px; top: 52px; font: 40px/1 Anton, Impact, sans-serif">MRS. HOOLIGAN</b>
    <span style="position: absolute; left: 156px; top: 100px; padding: 0 10px; background: #3aa0ff; transform: skewX(-10deg); font: italic 800 20px 'Barlow Condensed', sans-serif; letter-spacing: 1.5px">FACE</span>
    <span style="position: absolute; left: 230px; top: 100px; font: 800 20px 'Barlow Condensed', sans-serif; letter-spacing: 1.5px">&#x1F512;&#xFE0E; ONLY YOU SEE THIS</span>
    <div style="position: absolute; left: 500px; top: 12px; width: 452px; display: flex; justify-content: space-between; font: 800 20px 'Barlow Condensed', sans-serif; letter-spacing: 2.5px"><span>AURA</span><span style="color: #ffb86b">GHOST = ESTIMATE UNTIL SETTLEMENT</span></div>
    <div aria-hidden="true" style="position: absolute; left: 500px; top: 46px; display: flex; gap: 18px">${['#a463ff', '#3a7dff', '#22c38a', '#e8c021', '#f08a2e', '#ff4d5e'].map((c) => `<span style="width: 56px; height: 56px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #ffffff99, ${c} 45%, #00000099)"></span>`).join('')}</div>
    <div style="position: absolute; left: 500px; top: 112px; font: 54px/1 Anton, Impact, sans-serif">6.00 <span style="font: 700 22px 'Barlow Condensed', sans-serif">/ 6.00</span></div>
    <div style="position: absolute; left: 700px; top: 116px; width: 252px; text-align: right"><b style="display: inline-block; padding: 2px 8px; border: 1.5px dashed #ffb86b; font: 800 22px 'Barlow Condensed', sans-serif; color: #ffb86b">+0.85 EST. PAST THE CAP</b></div>
    <p style="position: absolute; left: 500px; top: 168px; width: 452px; margin: 0; font: 600 19px 'Barlow Condensed', sans-serif; color: #ffd9b0">Spend some before the settlement, or it won't fit.</p>
    <div style="position: absolute; left: 980px; top: 44px; font: 800 20px 'Barlow Condensed', sans-serif; letter-spacing: 3px; color: #e4def7">NEXT SETTLEMENT</div>
    <div style="position: absolute; left: 980px; top: 72px; font: 34px Anton, Impact, sans-serif; color: #c9f8ff">Oct 30, 8:17 AM</div>
    <a href="#" class="btn" style="position: absolute; left: 990px; top: 140px; min-height: 52px; padding: 0 22px"><b>ESC&nbsp; MENU</b></a>
    <a href="#" class="btn" style="position: absolute; left: 1236px; top: 140px; min-height: 52px; padding: 0 34px; background: #ff3d6e; border-color: #ff3d6e; color: #07050d"><b>HAND 3</b></a>
  </section>
</div>`,
});

page({
  file: '36-account-phone.html', name: 'Account and HUD states on a phone', w: 1250, h: 884,
  note: "Three phone screens at 390 by 844: Settings › Account with its invites, the card info as a sheet with the card's face, and the HUD past its cap: the mask's name whole and the way out said.",
  body: `<div style="width: 1250px; height: 884px; display: flex; gap: 20px; padding: 20px; box-sizing: border-box; background: #2a2833; font-family: 'Barlow Condensed', sans-serif">
  ${phone('Account', `${phoneMenu}
    <section style="position: absolute; left: 16px; top: 90px; width: 358px">
      <h2 style="margin: 0 0 8px; font: 44px/1 Anton, Impact, sans-serif">ACCOUNT</h2>
      <div style="padding: 14px 0; border-top: 1px solid rgba(241,236,255,.22)"><div class="k" style="padding: 0 0 8px">INVITES</div><p class="note" style="margin: 0; font-size: 19px">You hold 1 of 3 open invites. One use each; 7 days.</p>
        <div style="margin-top: 12px; padding: 12px 0; border-top: 1px solid rgba(241,236,255,.14)"><code style="font: 700 21px 'Barlow Condensed', sans-serif; letter-spacing: 2px">ab12cd34</code> <span style="font: 500 19px 'Barlow Condensed', sans-serif; color: #e4def7"><b style="color: #19e3ff">OPEN</b> &middot; expires Nov 12</span><div class="btns" style="margin-top: 10px; gap: 8px"><button class="btn" style="min-height: 44px; padding: 0 14px; font-size: 18px"><b>REISSUE</b></button></div></div>
        <div style="padding: 12px 0; border-top: 1px solid rgba(241,236,255,.14); border-bottom: 1px solid rgba(241,236,255,.14)"><code style="font: 700 21px 'Barlow Condensed', sans-serif; letter-spacing: 2px; color: #a9a2c2">9f3k2m7q</code> <span style="font: 500 19px 'Barlow Condensed', sans-serif; color: #e4def7"><b>USED</b> &middot; Nov 2</span></div>
        <div class="btns" style="margin-top: 14px"><button class="btn primary" style="width: 100%"><b>MAKE AN INVITE</b></button></div></div>
    </section>`, [[0, 80, 390, 620, .9]], 't1')}
  <figure aria-label="Card info, as a sheet" style="margin: 0; width: 390px; height: 844px; position: relative; overflow: hidden; background: #07050d; color: #f1ecff; flex: none">
    <section class="piece" style="position: absolute; left: 0; right: 0; top: 40px; bottom: 0; padding: 22px 16px; --cut: 20px; --edge: #19e3ff; --ground: #07050d">
      <button class="btn" aria-label="Close" style="position: absolute; right: 16px; top: 18px; min-height: 46px; width: 46px; padding: 0; transform: none"><b style="transform: none; font: 400 26px/1 'Barlow Condensed', sans-serif">&times;</b></button>
      <p style="margin: 0; font: 800 18px 'Barlow Condensed', sans-serif; letter-spacing: 2px; color: #19e3ff">SLOT A2 &middot; SALTY</p>
      <h2 style="margin: 2px 0 14px; font: 40px/1 Anton, Impact, sans-serif">WHOOPS!</h2>
      <div style="display: flex; justify-content: center; margin-bottom: 14px">${postcard(170)}</div>
      <p style="margin: 0 0 10px; font: 700 21px 'Barlow Condensed', sans-serif">1.00 to buy <span style="font-weight: 500; color: #e4def7">&middot; more on a long post</span></p>
      <p style="margin: 0; font: 500 19px/1.45 'Barlow Condensed', sans-serif">It splats a post in the ink you choose, and a reader can scrub the ink away on their own screen; the post's author can wash it away for everyone.</p>
    </section>
  </figure>
  <figure aria-label="The HUD past its cap" style="margin: 0; width: 390px; height: 844px; position: relative; overflow: hidden; background: #ffffff; flex: none">
    <section aria-label="Game HUD" style="position: absolute; left: 0; right: 0; bottom: 0; height: 168px; background: linear-gradient(#140c2c, #07050d); border-top: 1.5px solid rgba(201,248,255,.7); color: #f1ecff">
      <div style="position: absolute; left: 12px; top: 10px; width: 44px; height: 44px; border: 2px solid #19e3ff; display: grid; place-items: center; font: 28px Anton, Impact, sans-serif">M</div>
      <div style="position: absolute; left: 66px; top: 6px; width: 170px"><div style="font: 800 15px 'Barlow Condensed', sans-serif; letter-spacing: 2px">POSTING AS</div><div style="font: 22px/1.1 Anton, Impact, sans-serif">MRS. HOOLIGAN &#x2304;</div></div>
      <a href="#" class="btn" style="position: absolute; right: 12px; top: 10px; min-height: 44px; padding: 0 14px; background: #ff3d6e; border-color: #ff3d6e; color: #07050d"><b>HAND 3</b></a>
      <div style="position: absolute; left: 12px; right: 12px; top: 66px; display: flex; align-items: center; gap: 6px">${['#a463ff', '#3a7dff', '#22c38a', '#e8c021', '#f08a2e', '#ff4d5e'].map((c) => `<span style="width: 30px; height: 30px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #ffffff99, ${c} 45%, #00000099)"></span>`).join('')}<b style="margin-left: auto; font: 32px Anton, Impact, sans-serif">6.00</b></div>
      <p style="position: absolute; left: 12px; right: 12px; top: 106px; margin: 0; font: 600 18px/1.3 'Barlow Condensed', sans-serif; color: #ffd9b0"><b style="color: #ffb86b">+0.85 est. past the cap.</b> Spend some before the settlement, or it won't fit.</p>
    </section>
  </figure>
</div>`,
});

/* ---------------------------------------------------------------- batch 6: admin */

const ADMIN_TABS = [...PAUSE, 'ADMIN'];
const move = (when, whenSub, color, title, lines, action, actionColor, bar) => `<article style="display: grid; grid-template-columns: 170px 1fr 160px; gap: 24px; align-items: center; padding: 18px 0 18px 22px; border-left: 3px solid ${color}; background: rgba(7,5,13,.55)">
        <div><b style="display: block; font: 800 20px 'Barlow Condensed', sans-serif; letter-spacing: 1px; color: ${color}">${when}</b><span style="font: 500 20px 'Barlow Condensed', sans-serif; color: #e4def7">${whenSub}</span></div>
        <div><h3 style="margin: 0 0 6px; font: 800 22px 'Barlow Condensed', sans-serif">${title}</h3>${lines.map((l) => `<p style="margin: 0 0 4px; font: 500 20px/1.45 'Barlow Condensed', sans-serif; color: ${l.startsWith('Why') ? '#c9f8ff' : '#e4def7'}">${l}</p>`).join('')}${bar ? `<div style="margin-top: 8px; height: 12px; border: 1px solid #19e3ff"><div style="width: ${bar * 100}%; height: 100%; background: #19e3ff"></div></div><p style="margin: 4px 0 0; font: 500 19px 'Barlow Condensed', sans-serif">7 of 12</p>` : ''}</div>
        <div style="text-align: right; padding-right: 8px"><button class="btn" style="border-color: ${actionColor}; box-shadow: 0 0 12px ${actionColor}66"><b>${action}</b></button></div>
      </article>`;
const group = (name, n, color, inner) => `<section style="margin-top: 34px"><h2 style="margin: 0 0 14px; font: 44px/1 Anton, Impact, sans-serif">${name} <span style="font: 800 24px 'Barlow Condensed', sans-serif; color: ${color}">${n}</span></h2>${inner}</section>`;
const linkRow = (label, addr, n) => `<div style="display: grid; grid-template-columns: 190px 1fr auto; gap: 12px; align-items: end; padding: 12px 0; border-top: 1px solid rgba(241,236,255,.14)">
        <div class="field"><label style="font-size: 19px">LABEL</label><input type="text" value="${label}"></div>
        <div class="field"><label style="font-size: 19px">ADDRESS</label><input type="text" value="${addr}"></div>
        <button class="btn" aria-label="Remove link ${n}" style="min-height: 56px"><b>REMOVE</b></button>
      </div>`;

page({
  file: '37-admin-queue.html', name: "The System's moves", w: 1440, h: 1640,
  note: "The admin queue with a move waiting and one in force, in docs/research/2026-10-30-the-system/mock-s3-admin-queue.html's grouping (B, the owner's choice), redrawn on #202's parts: the queue first, How players reach you after it as its own section, and the menu bar on one row with Admin.",
  body: frame(1440, 1640, `
  ${smoke(1440, 1640, [[40, 220, 1360, 1360, .92]])}
  ${menu(ADMIN_TABS, 'ADMIN')}
  ${title("THE SYSTEM'S MOVES")}
  ${pageLead('Moves that reshape a board wait here before they land, and land unless you hold them. Anything in force can be reversed. Players never see a held move.')}
  <div style="position: absolute; left: 64px; top: 290px; width: 1312px">
    ${group('TO DO', '0', '#19e3ff', '<p class="note" style="margin: 0; padding: 14px 0; border-top: 1px solid rgba(241,236,255,.22); border-bottom: 1px solid rgba(241,236,255,.22)">Nothing to do.</p>')}
    ${group('WAITING TO LAND', '1', '#ffd23f', move('IN 17 HOURS', 'Oct 31, 2:10 pm', '#ffd23f', 'Rename <u>Games</u> to Small Soldiers Situation Room', ['New subject: the 1998 film Small Soldiers. Changes back when 8 different characters post there, or Nov 14.', 'Why, in the Director\'s words: &ldquo;Games has gone soft. Time for discipline.&rdquo;'], 'HOLD', '#ffd23f'))}
    ${group('IN FORCE', '1', '#19e3ff', move('SINCE OCT 30', 'ends Nov 13', '#19e3ff', 'Renamed <u>General</u> to Pointless Toast Palace', ['Back when 12 different characters post there.'], 'REVERSE', '#ff3d6e', 7 / 12))}
    <section style="margin-top: 34px"><h2 style="margin: 0; font: 44px/1 Anton, Impact, sans-serif">ENDED <span style="font: 600 21px 'Barlow Condensed', sans-serif; color: #e4def7">&middot; the last 30 days, with how each ended &rsaquo;</span></h2></section>
    <section aria-labelledby="reachH" style="margin-top: 54px; padding-top: 34px; border-top: 1px solid rgba(241,236,255,.22); width: 920px">
      <h2 id="reachH" style="margin: 0 0 10px; font: 44px/1 Anton, Impact, sans-serif">HOW PLAYERS REACH YOU</h2>
      <p class="note" style="margin: 0 0 14px">Players read these on the Reach a person page, which they can open signed out. Up to 5 links, each a label and an address: a web address that starts with https://, or an email address.</p>
      ${linkRow('Discord', 'https://discord.example/users/admin', 1)}
      ${linkRow('Email', 'mailto:admin@example.test', 2)}
      <div class="btns" style="margin-top: 18px; padding-top: 18px; border-top: 1px solid rgba(241,236,255,.14)"><button class="btn"><b>ADD A LINK</b></button><button class="btn primary"><b>SAVE HOW PLAYERS REACH YOU</b></button></div>
    </section>
  </div>
`),
});

page({
  file: '38-write-update.html', name: 'Write an update', w: 1440, h: 1600,
  note: "Updates as an admin, Write an update open with a draft: the form in the glass's piece, its labels in the field label's own color, each change's Remove named in words, and the post as players will see it under the form.",
  body: frame(1440, 1600, `
  ${smoke(1440, 1600, [[40, 220, 1360, 1320, .92]])}
  ${menu(ADMIN_TABS, 'UPDATES')}
  ${title('UPDATES')}
  ${pageLead('What changed in the game, from the people who make it.')}
  <form aria-labelledby="wH" class="piece" style="position: absolute; left: 64px; top: 300px; width: 920px; box-sizing: border-box; padding: 30px 34px; --cut: 24px">
    <h2 id="wH" style="margin: 0 0 8px; font: 44px/1 Anton, Impact, sans-serif">WRITE AN UPDATE</h2>
    <p class="note" style="margin: 0 0 22px">This posts as Gabe. Every player gets it as an alert. No model writes it, and the page says it is always true, so check the facts.</p>
    <div class="field"><label>TITLE</label><input type="text" value="Whoops! costs less on short posts"></div>
    <div class="field" style="margin-top: 22px"><label>WORDS</label><textarea style="box-sizing: border-box; width: 100%; height: 130px; padding: 12px 16px; background: rgba(18,12,36,.9); border: 1px solid #19e3ff; color: #f1ecff; font: 600 21px/1.4 'Barlow Condensed', sans-serif">A long post still costs more to splat. A short one costs what the slot says.</textarea><div class="count"><span></span><span>78 of 20000</span></div></div>
    <fieldset style="margin: 22px 0 0; padding: 0; border: 0"><legend class="field" style="padding: 0"><label style="margin: 0">WHAT CHANGED</label></legend>
      <p class="note" style="margin: 8px 0 12px">A bold label (it can be left empty) and the words after it, one change to a row. A row with nothing in it is left out.</p>
      <div style="display: grid; grid-template-columns: 190px 1fr auto; gap: 12px; align-items: center"><input class="sel" type="text" value="Whoops!" aria-label="Label, change 1"><input class="sel" type="text" value="0.25 more for every 500 characters, from the first 500." aria-label="What changed, change 1"><button class="btn" aria-label="Remove change 1" style="min-height: 56px"><b>REMOVE</b></button></div>
    </fieldset>
    <div class="btns" style="margin-top: 22px; padding-top: 22px; border-top: 1px solid rgba(241,236,255,.22)"><button class="btn"><b>ADD A CHANGE</b></button><button class="btn primary"><b>POST UPDATE</b></button></div>
  </form>
  <section aria-labelledby="pvU" style="position: absolute; left: 64px; top: 1150px; width: 920px">
    <h3 id="pvU" class="sec">WHAT EVERYONE WILL SEE</h3>
    <article class="piece" style="padding: 26px 30px; --cut: 24px; --edge: rgba(167,139,250,.7)">
      <div class="by"><img src="${GABE}" alt="" style="width: 56px; height: 56px"><div><b style="font-size: 28px">GABE</b><span>Made this. Sorry.</span></div></div>
      <h4 style="margin: 16px 0 6px; font: 34px/1.05 Anton, Impact, sans-serif">Whoops! costs less on short posts</h4>
      <p style="margin: 0 0 12px; font: 500 21px/1.5 'Barlow Condensed', sans-serif">A long post still costs more to splat. A short one costs what the slot says.</p>
      <p style="margin: 0; font: 800 19px 'Barlow Condensed', sans-serif; letter-spacing: 2px; color: #c9f8ff">WHAT CHANGED</p>
      <p style="margin: 4px 0 0; font: 500 21px 'Barlow Condensed', sans-serif"><b>Whoops!</b> 0.25 more for every 500 characters, from the first 500.</p>
    </article>
  </section>
`),
});

page({
  file: '39-admin-phone.html', name: 'Admin on a phone', w: 840, h: 884,
  note: 'Two phone screens at 390 by 844: the queue, a move\'s action under its words; and Write an update, each change\'s fields stacked with Remove at its foot.',
  body: `<div style="width: 840px; height: 884px; display: flex; gap: 20px; padding: 20px; box-sizing: border-box; background: #2a2833; font-family: 'Barlow Condensed', sans-serif">
  ${phone('The queue', `${phoneMenu}
    <section style="position: absolute; left: 16px; top: 90px; width: 358px">
      <h2 style="margin: 0 0 10px; font: 34px/1 Anton, Impact, sans-serif">WAITING TO LAND <span style="font: 800 20px 'Barlow Condensed', sans-serif; color: #ffd23f">1</span></h2>
      <article style="padding: 14px 0 16px 16px; border-left: 3px solid #ffd23f; background: rgba(7,5,13,.55)">
        <b style="font: 800 19px 'Barlow Condensed', sans-serif; color: #ffd23f">IN 17 HOURS</b> <span style="font: 500 19px 'Barlow Condensed', sans-serif; color: #e4def7">&middot; Oct 31, 2:10 pm</span>
        <h3 style="margin: 6px 0 4px; font: 800 21px 'Barlow Condensed', sans-serif">Rename <u>Games</u> to Small Soldiers Situation Room</h3>
        <p style="margin: 0 0 12px; font: 500 19px/1.4 'Barlow Condensed', sans-serif; color: #e4def7">Changes back when 8 different characters post there, or Nov 14.</p>
        <button class="btn" style="border-color: #ffd23f"><b>HOLD</b></button>
      </article>
      <h2 style="margin: 26px 0 10px; font: 34px/1 Anton, Impact, sans-serif">IN FORCE <span style="font: 800 20px 'Barlow Condensed', sans-serif; color: #19e3ff">1</span></h2>
      <article style="padding: 14px 0 16px 16px; border-left: 3px solid #19e3ff; background: rgba(7,5,13,.55)">
        <b style="font: 800 19px 'Barlow Condensed', sans-serif; color: #19e3ff">SINCE OCT 30</b> <span style="font: 500 19px 'Barlow Condensed', sans-serif; color: #e4def7">&middot; ends Nov 13</span>
        <h3 style="margin: 6px 0 8px; font: 800 21px 'Barlow Condensed', sans-serif">Renamed <u>General</u> to Pointless Toast Palace</h3>
        <div style="height: 10px; border: 1px solid #19e3ff; margin-right: 16px"><div style="width: 58%; height: 100%; background: #19e3ff"></div></div>
        <p style="margin: 4px 0 12px; font: 500 18px 'Barlow Condensed', sans-serif">7 of 12</p>
        <button class="btn" style="border-color: #ff3d6e"><b>REVERSE</b></button>
      </article>
    </section>`, [[0, 80, 390, 700, .9]], 'u1')}
  ${phone('Write an update', `${phoneMenu}
    <form style="position: absolute; left: 16px; top: 90px; width: 358px">
      <h2 style="margin: 0 0 10px; font: 34px/1 Anton, Impact, sans-serif">WRITE AN UPDATE</h2>
      <div class="field"><label>TITLE</label><input type="text" value="Whoops! costs less on short posts"></div>
      <div class="field" style="margin-top: 16px"><label>WORDS</label><textarea style="box-sizing: border-box; width: 100%; height: 100px; padding: 10px 14px; background: rgba(18,12,36,.9); border: 1px solid #19e3ff; color: #f1ecff; font: 600 20px/1.4 'Barlow Condensed', sans-serif">A long post still costs more to splat.</textarea><div class="count"><span></span><span>38 of 20000</span></div></div>
      <div class="field" style="margin-top: 16px"><label>WHAT CHANGED</label><input type="text" value="Whoops!" aria-label="Label, change 1"><input type="text" value="0.25 more for every 500 characters." aria-label="What changed, change 1" style="margin-top: 8px"><button class="btn" aria-label="Remove change 1" style="margin-top: 8px; min-height: 44px"><b>REMOVE</b></button></div>
      <div class="btns" style="margin-top: 16px"><button class="btn"><b>ADD A CHANGE</b></button><button class="btn primary"><b>POST UPDATE</b></button></div>
    </form>`, [[0, 80, 390, 700, .9]], 'u2')}
</div>`,
});

/* ---------------------------------------------------------------- after the batches: Debut, dropping now (the owner, on #249) */

page({
  file: '40-debut-now.html', name: 'Drop a character now', w: 1440, h: 1000,
  note: "The Debut dialog, dropping now, for a character waiting to debut: the same frame as 24-debut.html, How loud as one row of three, and the footer's line saying it lands at once.",
  body: dialog(1440, 1000, 1100, 'MY CHARACTERS &rsaquo; DEBUT', 'DROP WAITING WANDA NOW', `
    <fieldset style="margin: 0; padding: 0; border: 0"><legend class="sec">HOW LOUD</legend>
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px">${opt('SILENT', "Nobody is told. Waiting Wanda's first post is its entrance.", false, 'dn')}${opt('ANNOUNCED', 'The System posts that Waiting Wanda debuts, never as what.', true, 'dn')}${opt('ANNOUNCED, WITH ITS CLASS', "The System also says what class Waiting Wanda is, and that stays public. This can't be taken back.", false, 'dn')}</div>
    </fieldset>
    <section style="margin: 36px 0"><h3 class="sec">WHAT EVERYONE WILL SEE</h3>
      <div class="preview"><div><b>The System</b><br><span style="font-size: 11px; color: #444">At once, in the season's Turns thread.</span></div><div><b>Waiting Wanda</b> debuts.</div></div>
    </section>
    ${foot('Waiting Wanda goes on the board at once and can post at once, instead of at the next settlement.', 'CANCEL', 'DROP WAITING WANDA NOW')}
  `),
});

console.log('wrote the backfill boards');

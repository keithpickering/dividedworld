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
.tab{display:flex;align-items:center;min-height:52px;padding:0 20px;transform:skewX(-10deg);text-decoration:none;font:800 21px 'Barlow Condensed',sans-serif;letter-spacing:2px;color:#e4def7}
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
  return `<nav aria-label="Menu" style="position: absolute; left: 0; right: 0; top: 0; height: 84px; z-index: 5; display: flex; align-items: center; gap: 8px; padding: 0 40px; background: rgba(7,5,13,.9); border-bottom: 1px solid rgba(201,248,255,.5); box-shadow: 0 1px 16px rgba(25,227,255,.35)">
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

console.log('wrote the backfill boards');

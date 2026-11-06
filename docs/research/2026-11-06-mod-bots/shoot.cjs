/**
 * The Mod Bots design's screen mocks (docs/plans/2026-11-06-mod-bots-design.md, section 9), shot from the real Lens story in
 * Storybook with the visit's pieces laid into the page. Run Storybook (`npm run storybook`), then:
 *   node docs/research/2026-11-06-mod-bots/shoot.cjs
 * The visit, report and filing pieces are mock content; the board, the marks, the Lens and the HUD are the built ones.
 */
const { chromium } = require('playwright');
const path = require('node:path');
const STORY = 'http://localhost:6006/iframe.html?viewMode=story&id=boards-01-lens--lens-whoops-who';

const CLOCK = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="13" r="8" fill="#ffd23d" stroke="#000" stroke-width="2"/><path d="M12 8v5l3 2M9 2h6" stroke="#000" stroke-width="2" fill="none"/></svg>')}`;

const CSS = `
.mock-warn { display:flex; flex-direction:column; align-items:flex-start; gap:1px; margin:2px 0 4px; } .mock-thermo { display:block; }
.mock-warn i { display:inline-block; width:7px; height:9px; border:1px solid currentColor; }
.mock-warn i.on { background: currentColor; }
.mock-layer { border:1px solid #000; background:#fff; padding:6px 10px; margin:0 0 10px; font-style:italic; }
.mock-tag { display:inline-block; margin-left:6px; padding:1px 8px; transform:skewX(-12deg); background:#120a24; color:#ffd23d;
  border:2px solid #ffd23d; font:600 13px/1.4 "Barlow Condensed", sans-serif; letter-spacing:.04em; text-transform:uppercase; text-decoration:none; }
.mock-tag > span { display:inline-block; transform:skewX(12deg); }
.mock-choices { display:flex; flex-direction:column; gap:8px; margin-top:8px; } .mock-choices .kb-kit-tile { width:100%; justify-content:flex-start; display:flex; } .mock-tight { margin-bottom:2px !important; } .mock-tight + .mock-q { margin-top:0; }
.mock-q { font-size: 1.05em; margin: 4px 0 2px; }
.mock-field { width:100%; min-height:70px; background:#0b0716; color:#fff; border:2px solid #8a7bb8; padding:8px; font:15px Verdana, sans-serif; }
`;

function visit({ filed, author }) {
  return ({ CSS_, CLOCK_, filed, author }) => {
    const css = document.createElement('style'); css.textContent = CSS_; document.head.append(css);
    const post = document.getElementById('post-41');
    // Drop the Whoops! ink: this mock is about the visit.
    post.querySelectorAll('canvas, svg.kb-whoops, [data-kb-effect], .kb-effect, .kb-ink').forEach((n) => n.remove());
    const marks = post.querySelector('.kb-marks');
    const mark = marks.querySelector('.kb-mark');
    marks.querySelectorAll('.kb-mark').forEach((m, i) => { if (i > 0) m.remove(); });
    mark.dataset.kbCard = 'visit'; mark.style.setProperty('--kb-mark-color', '#ffd23d'); mark.style.setProperty('--kb-mark-ink', '#ffd23d');
    mark.setAttribute('aria-label', filed ? 'Filed by The Clerk. Opens the visit.' : 'The Clerk is on a visit here, 2 hours 41 minutes left. Opens the visit.');
    mark.querySelector('.kb-mark-icon').src = CLOCK_;
    mark.querySelector('.kb-mark-count').textContent = filed ? 'Filed' : '2:41';
    mark.querySelector('.kb-mark-sign')?.remove();
    // The postbit's warn bar, in the board's world.
    const counts = post.querySelector('.kb-postbit-counts');
    const on = filed ? 6 : 4;
    const bar = document.createElement('span'); bar.className = 'mock-warn kb-small';
    const fill = 6 + Math.round(66 * on / 10);
    bar.innerHTML = `<svg class="mock-thermo" width="84" height="16" viewBox="0 0 84 16" aria-hidden="true"><rect x="10.5" y="4.5" width="72" height="7" rx="3.5" fill="#fff" stroke="#000"/><rect x="11" y="6" width="${fill}" height="4" fill="#d01818"/><circle cx="8" cy="8" r="6.5" fill="#d01818" stroke="#000"/><circle cx="6" cy="6" r="1.6" fill="#fff" opacity=".7"/>${[0,2,4,6,8,10].map((t)=>`<path d="M${11.5+6.6*t},4.5v2" stroke="#000"/>`).join('')}</svg>`; bar.insertAdjacentHTML('afterbegin', `<span>Warnings: ${on}/10</span>`);
    counts.prepend(bar);
    // The post body: the board's own words and, once filed, the layer.
    const body = post.querySelector('.kb-bb') || post.querySelector('.kb-act-main');
    if (body) body.innerHTML = (filed ? '<p class="mock-layer">This post was found in violation of Rule 2: No double posting.</p>' : '') +
      '<p>Third time this week. I wrote the changelog at 9:13, posted it here at 9:14, then realized I forgot the part about the hats.</p><p>Posting the hats now.</p>';
    // Report link on every post's foot.
    document.querySelectorAll('.kb-act-links').forEach((l) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'kb-link-button'; b.textContent = 'Report'; l.append(b); });
    // Presence: the Clerk on a visit.
    const names = document.querySelector('.kb-presence-names');
    if (names && !filed) names.innerHTML = '<a href="#">Story reader</a>, <a href="#">The Clerk</a><a class="mock-tag" href="#post-41"><span>On a visit · post #41</span></a>';
    // The Lens: one tab, the visit.
    const lens = document.querySelector('.kb-lens');
    lens.style.setProperty('--kb-lens-ink', '#ffd23d');
    lens.setAttribute('aria-label', 'The visit to this post');
    lens.querySelector('.kb-lens-tabs').innerHTML = `<button type="button" role="tab" class="kb-lens-tab kb-glass-display" aria-selected="true">${filed ? 'Filed' : 'On a visit'}</button>`;
    const row = (note, who, verb, at, quote, reacts) => `<li class="kb-lens-row" style="--kb-play-ink:#ffd23d"><p class="kb-lens-note">${note}</p>
      <p class="kb-lens-by"><span class="kb-lens-who kb-glass-display">${who}</span> · ${verb} ${at}</p>${quote ? `<blockquote class="kb-lens-message">“${quote}”</blockquote>` : ''}
      <div class="kb-lens-row-foot"><div class="kb-reactions">${reacts ? `<ul class="kb-reaction-list"><li><button type="button" class="kb-meta-tile kb-reaction"><span class="kb-meta-tile-in"><span class="kb-reaction-emoji">${reacts[0]}</span> ${reacts[1]}</span></button></li></ul>` : ''}<button type="button" class="kb-meta-tile kb-reaction kb-react-button"><span class="kb-meta-tile-in">+ React</span></button></div>
      <div class="kb-lens-actions"><button type="button" class="kb-kit-tile kb-lens-action"><span class="kb-kit-tile-label">Spin thread</span></button></div></div></li>`;
    const story = `<div class="kb-lens-section kb-lens-who-section"><button type="button" class="kb-lens-fold" aria-expanded="true"><span class="kb-lens-fold-sign" aria-hidden="true"></span>How it went · ${filed ? 4 : 3} acts</button><ul class="kb-lens-rows">
      ${filed ? row('Filed', 'The Clerk', 'filed', 'Oct 30, 12:14 AM', 'Stamped, initialed, and filed under D for Double.', ['😂', 4]) : ''}
      ${row('A try to talk it down · failed', 'Pipewrench', 'answered', 'Oct 29, 10:02 PM', '', ['😭', 2])}
      ${row('The verdict · a visit', 'The Clerk', 'ruled', 'Oct 29, 9:51 PM', 'Two posts, one minute apart. I have a form for this.', ['🔥', 3])}
      ${row('The report', 'Gloomba', 'reported', 'Oct 29, 9:50 PM', 'double posting AGAIN', ['🍅', 2])}</ul></div>`;
    const glassName = (s) => `<span class="kb-glass-display">${s}</span>`;
    const state = filed
      ? `<div class="kb-lens-section kb-lens-state"><p class="kb-lens-line">${glassName('The Clerk')} filed its report</p>
         <p class="kb-lens-ends">Rule 2, No double posting: a minor breach. Spritey's warn bar gained 2 points (6 of 10); they drop off on Nov 13. The post keeps its words under the notice.</p></div>
         ${author ? `<div class="kb-lens-section kb-lens-act"><div class="kb-kit" style="--kb-tag:#ffd23d"><button type="button" class="kb-kit-tile" data-kb-lit=""><span class="kb-kit-tile-label">Appeal · 0.50 Aura</span></button></div>
         <p class="kb-lens-ends">The Clerk hears it. Refunded if overturned; it may be upheld, reduced, or increased by up to 2 points. One appeal per filing, and your plea is public.</p></div>` : ''}`
      : `<div class="kb-lens-section kb-lens-state"><p class="kb-lens-line">${glassName('The Clerk')} is on a visit</p>
         <p class="kb-lens-ends">Charge: Rule 2, No double posting (minor, 2 warn points). If nobody talks it down by Oct 30, 12:14 AM, Spritey's warn bar gains 2 points and this post is marked as breaking Rule 2.</p></div>
         <div class="kb-lens-section kb-lens-act"><p class="kb-lens-line mock-tight">Talk it down</p><p class="mock-q">The Clerk asks: which form is used to request another form?</p>
         <div class="mock-choices kb-kit" style="--kb-tag:#ffd23d">${['Form 1-A', 'Form 0', 'Form 27-B/6'].map((c) => `<button type="button" class="kb-kit-tile"><span class="kb-kit-tile-label">${c}</span></button>`).join('')}</div>
         <p class="kb-lens-ends">One try for Story reader. A wrong answer, and The Clerk watches Story reader's next post for 24 hours (Obstruction, minor). No timer.</p></div>`;
    lens.querySelector('.kb-lens-body').innerHTML = state + story;
  };
}

function report() {
  return ({ CSS_ }) => {
    const css = document.createElement('style'); css.textContent = CSS_; document.head.append(css);
    document.querySelectorAll('.kb-act-links').forEach((l) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'kb-link-button'; b.textContent = 'Report'; l.append(b); });
    const lens = document.querySelector('.kb-lens');
    lens.style.setProperty('--kb-lens-ink', '#ffd23d');
    lens.querySelector('.kb-lens-tabs').innerHTML = '<button type="button" role="tab" class="kb-lens-tab kb-glass-display" aria-selected="true">Report post #42</button>';
    lens.querySelector('.kb-lens-body').innerHTML = `<div class="kb-lens-section kb-lens-state">
      <p class="kb-lens-ends">Your report is public: it names Story reader, and anyone can react to it. The Clerk, on General's beat, judges it now: a visit, dismissed, or it backfires onto Story reader's latest post.</p></div>
      <div class="kb-lens-section kb-lens-act"><label class="kb-lens-line" for="mock-why">Why (shown with your report)</label><textarea id="mock-why" class="mock-field">she said magenta is classless. that is a personal attack on magenta</textarea>
      <div class="kb-kit" style="--kb-tag:#ffd23d;margin-top:10px"><button type="button" class="kb-kit-tile" data-kb-lit=""><span class="kb-kit-tile-label">Report · 0.25 Aura</span></button></div>
      <p class="kb-lens-ends">Story reader has 3 reports left today.</p></div>`;
    const post = document.getElementById('post-42');
    const r = post.getBoundingClientRect();
    const fl = lens.closest('.kb-float'); fl.style.top = `${r.top + 30}px`;
  };
}

(async () => {
  const b = await chromium.launch();
  const shots = [
    ['01-on-a-visit', visit({ filed: false }), { filed: false }],
    ['02-filed-author', visit({}), { filed: true, author: true }],
    ['03-report', report(), null],
  ];
  for (const [name, fn, o] of shots) {
    for (const [w, h, sfx] of [[1440, 1000, ''], [390, 844, '-phone']]) {
      const p = await b.newPage({ viewport: { width: w, height: h } });
      await p.goto(w < 500 ? STORY + '-phone' : STORY, { waitUntil: 'networkidle' });
      await p.waitForTimeout(2500);
      await p.evaluate(fn, { CSS_: CSS, CLOCK_: CLOCK, filed: o?.filed, author: !!o?.author });
      await p.waitForTimeout(300);
      await p.screenshot({ path: path.join(__dirname, `${name}${sfx}.png`) });
      if (name === '01-on-a-visit') {
        await p.evaluate(() => { document.querySelector('.kb-float')?.remove(); document.querySelector('.kb-presence').scrollIntoView({ block: 'center' }); });
        await p.waitForTimeout(200);
        await p.screenshot({ path: path.join(__dirname, `04-presence${sfx}.png`) });
      }
      await p.close();
    }
  }
  await b.close();
})();

// Writes the six conduct boards and glass-tokens.css into this folder. Run from anywhere: node mock.mjs
// It reads, and never writes, the app: glass.json through the engine's own glassVars (engine/ui/glass/apply.ts) for the glass's
// token values, and instances/divided-world/ui/conduct.ts for the seven sections. Everything else the boards draw comes from the
// app's stylesheets, linked by relative path, so a board is the real CSS over hand-written markup of the real class names.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const { glassVars } = await import(pathToFileURL(path.join(root, 'engine/ui/glass/apply.ts')).href);
const { conduct } = await import(pathToFileURL(path.join(root, 'instances/divided-world/ui/conduct.ts')).href);
const glass = JSON.parse(fs.readFileSync(path.join(root, 'instances/divided-world/ui/glass.json'), 'utf8'));

/* ---- glass-tokens.css: the standard key's values and the instance's fonts, as the app puts them on the root ---- */
const vars = glassVars(glass, 'standard');
const faces = glass.fonts.map((f) => `@font-face{font-family:'${f.family}';font-weight:${f.weight};font-style:${f.style};font-display:block;src:url(../../../instances/divided-world/ui/${f.file}) format('woff2')}`);
fs.writeFileSync(path.join(here, 'glass-tokens.css'), [
  '/* Written by mock.mjs from instances/divided-world/ui/glass.json through engine/ui/glass/apply.ts glassVars (the standard key). Do not edit. */',
  ...faces,
  ':root{',
  ...Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`),
  '}',
  '',
].join('\n'));

const css = [
  'engine/ui/base.css', 'instances/divided-world/ui/theme.css',
  'engine/ui/glass/tokens.css', null /* glass-tokens.css */, 'engine/ui/glass/base.css', 'engine/ui/glass/calm.css', 'engine/ui/glass/parts.css', 'engine/ui/glass/shell.css',
  'engine/ui/thread/thread.css', 'engine/ui/postbit/postbit.css', 'engine/ui/bbcode/bbcode.css',
  'engine/ui/cards/lens.css', 'engine/ui/cards/visit.css', 'engine/ui/cards/forms.css', 'engine/ui/account/account.css',
];
const links = css.map((c) => `<link rel="stylesheet" href="${c === null ? 'glass-tokens.css' : '../../../' + c}">`).join('\n') + '\n<link rel="stylesheet" href="board.css">';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const count = (s) => [...s].length;

/* ---- the page ---- */
function page({ title, comment, body, bodyStyle = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<!-- ${comment} Written by mock.mjs; a reference for the look, not code to copy. -->
${links}
</head>
<body${bodyStyle ? ` style="${bodyStyle}"` : ''}>
${body}
<script>
/* What the app's JS decides from the window's width: the Phone board's glass layout below 1152px (engine/ui/glass/board.ts), the stacked postbit at 40em. */
(function () {
  var w = window.innerWidth, r = document.documentElement;
  if (w < 1152) r.setAttribute('data-kb-layout', 'phone');
  if (w <= 640) document.querySelectorAll('[data-kb-postbit]').forEach(function (e) { e.setAttribute('data-kb-postbit', 'stacked'); });
  if (w <= 640) document.querySelectorAll('.kb-acts-head').forEach(function (e) { e.remove(); });
})();
</script>
</body>
</html>
`;
}

/* ---- board pieces, in the app's own class names ---- */
const people = {
  pickle: { name: 'Pickle Baron', title: 'Promo Cutter', posts: 212, joined: 'Mar 2026' },
  gravy: { name: 'Gravy Knight', title: 'Heel in Training', posts: 148, joined: 'Apr 2026' },
  spritey: { name: 'Spritey', title: 'Fan Favorite', posts: 301, joined: 'Feb 2026' },
};

function bit(p) {
  return `<div class="kb-postbit" role="group" aria-label="About ${p.name}" data-kb-postbit="side"><span class="kb-postbit-avatar" data-kb-slot="square" aria-hidden="true"><span class="kb-postbit-none">${p.name[0]}</span></span><div class="kb-postbit-text"><span class="kb-postbit-name"><a href="#">${p.name}</a></span><span class="kb-postbit-title kb-small kb-muted">${p.title}</span><span class="kb-postbit-counts kb-small kb-muted"><span>Posts: ${p.posts}</span><span>Joined ${p.joined}</span></span></div></div>`;
}

const btn = (label, extra = '') => `<button type="button" class="kb-button" data-kb-size="small"${extra}>${label}</button>`;

/** A post: the postbit, the line, the words, the footer's actions and whatever its actions have opened. */
function post({ n, who, when, main, links, panels = '' }) {
  return `<article class="kb-act" id="post-${n}" data-kb-seq="${n}" data-kb-parity="${n % 2 === 0 ? 'even' : 'odd'}" data-kb-kind="post" data-kb-postbit="side" aria-label="Post ${n} by ${people[who].name}">
${bit(people[who])}
<header class="kb-act-meta" data-kb-cell="line"><time>${when}</time><a class="kb-act-number" href="#post-${n}">#${n}</a></header>
<div class="kb-act-main" data-kb-cell="words">${main}</div>
<footer class="kb-act-foot" data-kb-cell="actions"><div class="kb-act-links kb-small">${links}</div></footer>
<div class="kb-act-panels">${panels}</div>
</article>`;
}

const bb = (html) => `<div class="kb-bb">${html}</div>`;
const readTheCode = '<a href="conduct.html">Read the code</a>';
const NOTE = `<p class="kb-glass kb-hidden-note" role="note"><span>Hidden by an admin: it broke the code of conduct.</span> ${readTheCode}</p>`;
const ownerNote = NOTE;

function thread({ title, acts, headNote = '' }) {
  return `<div class="kb-page">
<p class="kb-crumb"><a href="#">Index</a> › <a href="#">Promos &amp; Callouts</a> › ${esc(title)}</p>
<div class="kb-thread">
<div class="kb-thread-head"><h1 class="kb-heading kb-thread-title">${esc(title)}</h1><nav class="kb-pager kb-small" aria-label="Pages"><span class="kb-pager-where">Page 1 of 1</span></nav></div>
${headNote}
<div class="kb-acts"><div class="kb-acts-head" aria-hidden="true"><span>Author</span><span>Message</span></div>
${acts}
</div>
</div>
</div>`;
}

const TITLE = 'Who keeps reacting Salty to my Promos?';
const OP = post({
  n: 1, who: 'pickle', when: 'Nov 9, 2026, 1:02 PM',
  main: bb('Three promos this week. Three Salty reactions each. I want names, I want receipts, and I want one of you to admit the pun about my cape was good.'),
  links: btn('Quote') + btn('Spin thread') + btn('History'),
});
const ROAST = bb('Receipts: the cape pun landed about as well as your last title shot. You rehearsed the pause, the pause was loud, and the pause was all anyone remembered.');
const postTwo = (extra = {}) => post({
  n: 2, who: 'gravy', when: 'Nov 9, 2026, 2:14 PM', main: ROAST, links: btn('Quote') + btn('Spin thread') + btn('History'), ...extra,
});

/* ---- the Lens: the real frame, tabs and body classes; Report is the board's own form, unchanged ---- */
const REASON_NOTE = '';
function lens() {
  const tab = (label, sel) => `<button type="button" role="tab" class="kb-lens-tab kb-glass-skew" aria-selected="${sel}"><span class="kb-glass-upright">${label}</span></button>`;
  return `<div class="kb-glass kb-float">
<div class="kb-glass-dialog kb-glass-cut-dialog kb-float-box kb-lens" role="dialog" aria-modal="false" aria-label="Report this post" data-kb-lens="dock" data-kb-more="false">
<div class="kb-glass-dialog-bar"><div class="kb-lens-tabstrip"><div class="kb-lens-tabs" role="tablist" aria-label="Form">${tab('Whoops!', false)}${tab('Report post #2', true)}</div></div><button type="button" class="kb-glass-dialog-close"><span class="kb-visually-hidden">Close</span></button></div>
<div class="kb-lens-fade" aria-hidden="true"></div>
<div class="kb-lens-body" role="tabpanel" aria-label="Report post #2">
<form class="kb-visit kb-mod-form" aria-label="Report post #2" onsubmit="return false">
<div class="kb-lens-section kb-visit-state"><p class="kb-visit-facts">Your report is public: it names Gravy Knight, and anyone can react to it. A Mod Bot on this board's beat judges it now: a visit, dismissed, or it backfires onto Gravy Knight's latest post. If the Mod cannot judge it, your Aura comes back.</p></div>
<div class="kb-lens-section kb-mod-field"><h3 class="kb-visit-heading"><label for="why">Why (shown with your report)</label></h3><textarea id="why" class="kb-mod-textarea" rows="3" aria-describedby="why-count">${REASON_NOTE}</textarea><p id="why-count" class="kb-glass-field-count"><span class="kb-glass-field-hint"></span> <span class="kb-glass-field-tally">0 of 280</span></p></div>
<div class="kb-lens-section kb-visit-appeal-section"><button type="submit" class="kb-glass-button kb-glass-skew kb-visit-appeal" data-kb-kind="secondary" data-kb-size="m"><span class="kb-glass-upright"><span class="kb-glass-label">Report · 5 Aura</span></span></button><p class="kb-visit-terms">Spritey has 2 reports left today.</p></div>
</form>
<p class="kb-report-foot"><button type="button" class="kb-linklike kb-report-link" aria-haspopup="dialog">Report to admins</button></p>
</div>
</div>
</div>`;
}

/* ---- the report dialog ---- */
const KICKER = 'Post #2 by Gravy Knight, current version';
const LEAD = 'This reaches a person, not the game. An admin reads every report, and the player is never told who sent it.';
const NOTE_TEXT = 'The last line goes after their real job, not their character. The rest is just roasting and I would leave it.';

function sections(selected) {
  return `<fieldset class="kb-report-sections"><legend class="kb-visually-hidden">Which part of the code of conduct</legend>
${conduct.sections.map((s) => `<div class="kb-report-section"><label><input type="radio" name="section" value="${s.key}"${s.key === selected ? ' checked' : ''}><span>${esc(s.title)}</span></label><a href="conduct.html#${s.key}" aria-label="Read: ${esc(s.title)}">Read</a></div>`).join('\n')}
</fieldset>`;
}

const buttons = (...bs) => `<div class="kb-glass-form-foot"><div class="kb-button-row" data-kb-align="end">${bs.join('')}</div></div>`;
const gbtn = (label, kind) => `<button type="button" class="kb-glass-button kb-glass-skew" data-kb-kind="${kind}" data-kb-size="m"><span class="kb-glass-upright"><span class="kb-glass-label">${label}</span></span></button>`;

function dialog({ id, kicker = KICKER, body, sheet = false }) {
  return `<div class="kb-glass-dialog kb-glass-cut-dialog kb-report" role="dialog" aria-modal="true" aria-labelledby="${id}-t" aria-describedby="${id}-lead"${sheet ? ' data-kb-place="sheet"' : ''}>
<div class="kb-glass-dialog-bar"><div class="kb-glass-dialog-titles"><p class="kb-glass-dialog-kicker">${esc(kicker)}</p><h2 id="${id}-t" class="kb-glass-dialog-head kb-glass-display" tabindex="-1">Report to admins</h2></div><button type="button" class="kb-glass-dialog-close"><span class="kb-visually-hidden">Close</span></button></div>
<div class="kb-glass-dialog-body kb-report-body">
${body}
</div>
</div>`;
}

function formBody(id, { err = '' } = {}) {
  return `<p id="${id}-lead" class="kb-acct-text">${LEAD}</p>
${err ? `<p role="alert" class="kb-report-said">${err}</p>` : ''}
<form onsubmit="return false">
${sections('person')}
<div style="margin-top:24px"><label class="kb-report-label" for="${id}-note">Anything an admin should know (optional)</label>
<textarea id="${id}-note" class="kb-mod-textarea" rows="4" aria-describedby="${id}-count">${esc(NOTE_TEXT)}</textarea>
<p id="${id}-count" class="kb-glass-field-count"><span class="kb-glass-field-hint"></span> <span class="kb-glass-field-tally">${count(NOTE_TEXT)} of 1000</span></p></div>
${buttons(gbtn('Cancel', 'quiet'), gbtn('Send to admins', 'secondary'))}
</form>`;
}

const stage = (inner, { dock = false } = {}) => `<div class="stage${dock ? ' has-dock' : ''}" style="--stage-h:var(--h-main)">${inner}</div>`;
const heights = (h, hp) => `:root{--h-main:${h}px}:root[data-kb-layout='phone']{--h-main:${hp}px}`;
const hstyle = (h, hp) => `<style>${heights(h, hp)}</style>`;

/* ---- the boards ---- */
const boards = {};

/* 1: the Lens, with the plain link at its foot */
boards['01-lens-foot'] = page({
  title: 'The Lens with Report to admins',
  comment: 'Board 1 of the conduct design session (docs/plans/2026-11-02-conduct-plan.md, Task 6): a post with the Lens open on its Report tab, and the plain Report to admins link at the Lens\'s very foot under a hairline rule.',
  body: hstyle(900, 844) + stage(thread({ title: TITLE, acts: OP + postTwo() }) + lens(), { dock: true }),
});

/* 2: History, three versions */
{
  const rowLink = (n) => `<button type="button" class="kb-linklike kb-report-row-link kb-small" aria-haspopup="dialog" aria-label="Report to admins: ${n}">Report to admins</button>`;
  const history = `<div id="history-2"><ol class="kb-post-history" data-kb-quotable="hidden" aria-label="Versions of this post, oldest first">
<li><span class="kb-small kb-muted">Original, Nov 9, 2026, 2:14 PM</span>${rowLink('original')}${bb('Receipts: the cape pun landed about as well as your last title shot. You rehearsed the pause, the pause was loud, and the pause was all anyone remembered.')}</li>
<li><span class="kb-small kb-muted">Edit 1, Nov 9, 2026, 2:31 PM</span>${NOTE}</li>
<li><span class="kb-small kb-muted">Edit 2, Nov 9, 2026, 3:05 PM · Current</span>${rowLink('edit 2')}${bb('Receipts: the cape pun was fine. The pause after it was a crime against timing, and I will say so again.')}</li>
</ol></div>`;
  boards['02-history'] = page({
    title: 'History with Report to admins',
    comment: 'Board 2 of the conduct design session: a post\'s History panel open on the board, three versions, Report to admins on each version row but the hidden one, which shows the one-line note.',
    body: thread({
      title: TITLE,
      acts: OP + post({
        n: 2, who: 'gravy', when: 'Nov 9, 2026, 2:14 PM', main: bb('Receipts: the cape pun was fine. The pause after it was a crime against timing, and I will say so again.'),
        links: btn('Quote') + btn('Spin thread') + btn('History', ' aria-expanded="true" aria-controls="history-2"'), panels: history,
      }),
    }),
  });
}

/* 3: the report dialog over the thread */
{
  const over = `<div class="kb-glass kb-glass-overlay"><div style="display:contents">${dialog({ id: 'r', body: formBody('r') })}</div></div>`;
  const sheet = `<div class="kb-glass kb-glass-overlay" data-kb-sheet>${dialog({ id: 'r', body: formBody('r'), sheet: true })}</div>`;
  boards['03-dialog'] = page({
    title: 'The report dialog',
    comment: 'Board 3 of the conduct design session: the report dialog over the thread, form state: the seven sections of instances/divided-world/ui/conduct.ts as radios, one selected, a note typed with its live count. A centered modal at 1440, a sheet on the phone.',
    body: hstyle(1180, 1700) + stage(`${thread({ title: TITLE, acts: OP + postTwo() })}<div class="only-main">${over}</div><div class="only-phone">${sheet}</div>`),
  });
}

/* 4: the three other states */
{
  const sent = dialog({ id: 's', body: `<p id="s-lead" class="kb-report-said">Sent. An admin will read it, and we'll email you when they have. Nothing changes on the board.</p>${buttons(gbtn('Close', 'secondary'))}` });
  const limit = dialog({ id: 'l', body: `<p id="l-lead" class="kb-report-said">You have 3 reports waiting for an admin. You can send another once one of them is read.</p>${buttons(gbtn('Close', 'secondary'))}` });
  const error = dialog({ id: 'e', body: formBody('e', { err: 'That did not send. Check your connection and press Send to admins again; what you typed is still here.' }) });
  boards['04-dialog-states'] = page({
    title: 'The report dialog\'s states',
    comment: 'Board 4 of the conduct design session: sent, the limit (n = 3) and an error, each in place of the form or above it, with focus on the dialog\'s heading.',
    body: `<div class="kb-glass states"><figure><figcaption class="state-cap">Sent</figcaption>${sent}</figure><figure><figcaption class="state-cap">Limit, n = 3</figcaption>${limit}</figure><figure><figcaption class="state-cap">Error</figcaption>${error}</figure></div>`,
  });
}

/* 5: a hidden post and a quote of it */
{
  const hidden = post({ n: 2, who: 'gravy', when: 'Nov 9, 2026, 2:14 PM', main: NOTE, links: btn('Quote') + btn('Spin thread') + btn('History') });
  const quote = `<blockquote class="kb-quote"><cite class="kb-quote-from"><a href="#">Gravy Knight</a> <a href="#post-2">Post #2</a></cite><div class="kb-quote-body">${NOTE}</div></blockquote>`;
  const reply = post({
    n: 3, who: 'spritey', when: 'Nov 9, 2026, 2:40 PM',
    main: bb(`${quote}I will say it where everyone can see it: whatever that was, the pause was still the funniest part of the week.`),
    links: btn('Quote') + btn('Spin thread') + btn('History'),
  });
  boards['05-hidden-post'] = page({
    title: 'A hidden post and a quote of it',
    comment: 'Board 5 of the conduct design session: a thread with a hidden post (the glass note strip in place of the body; the postbit, the line and the footer stay) and a later post quoting it (the same note inside the quote\'s frame, the cite keeping its link).',
    body: thread({ title: TITLE, acts: OP + hidden + reply }),
  });
}

/* 6: the author's view */
{
  const own = (inner) => `<div class="kb-glass kb-hidden-own">${inner}</div>`;
  const words = 'Bold words from a mask who has been Salty since the day the board opened. Maybe stick to your day job at the hardware store.';
  const a = post({
    n: 2, who: 'gravy', when: 'Nov 9, 2026, 2:14 PM',
    main: NOTE + own(`<p class="kb-hidden-own-head">Only you see this</p><div class="kb-hidden-own-words">${esc(words)}</div><button type="button" class="kb-glass-button kb-glass-skew" data-kb-kind="secondary" data-kb-size="s"><span class="kb-glass-upright"><span class="kb-glass-label">Edit</span></span></button>`),
    links: btn('Quote') + btn('Spin thread') + btn('Edit') + btn('History'),
  });
  const b = post({
    n: 2, who: 'gravy', when: 'Nov 9, 2026, 2:14 PM',
    main: NOTE + own('<p>You edited this post. An admin will look at your edit before it shows again.</p>'),
    links: btn('Quote') + btn('Spin thread') + btn('Edit') + btn('History'),
  });
  const wrap = (acts, cap) => `<p class="cap">${cap}</p><div class="kb-acts"><div class="kb-acts-head" aria-hidden="true"><span>Author</span><span>Message</span></div>${acts}</div>`;
  boards['06-author-view'] = page({
    title: 'The author\'s view of a hidden post',
    comment: 'Board 6 of the conduct design session: the author\'s own view of a post hidden until edited (the note, then a muted panel, "Only you see this", with their words and Edit), and the waiting state after a second hide until edited and their edit. The two captions are the board\'s, not the screen\'s.',
    body: `<div class="kb-page"><p class="kb-crumb"><a href="#">Index</a> › <a href="#">Promos &amp; Callouts</a> › ${esc(TITLE)}</p>
<h1 class="kb-heading kb-thread-title">${esc(TITLE)}</h1>
${wrap(a, 'Gravy Knight\'s own view, the first time it is hidden until edited.')}
${wrap(b, 'Gravy Knight\'s own view after a second hide until edited, and their edit.')}
</div>`,
  });
}

for (const [name, html] of Object.entries(boards)) fs.writeFileSync(path.join(here, `${name}.html`), html);
console.log(`wrote ${Object.keys(boards).length} boards and glass-tokens.css`);

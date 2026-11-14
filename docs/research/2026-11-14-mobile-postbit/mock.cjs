// Mobile postbit mock: the real app's postbit at 360 wide, with the proposed CSS injected.
// The avatar's width is half the height of the elements on its right (variant 1: 109px, 3.6em at 15px; variant 2, no group bar there: about 82px, 2.7em).
// Run against `npx vite preview web --port 4173` of `npx vite build web --mode e2e`: node mock.cjs <outdir>
const { chromium } = require('playwright');
const tall = (w) => `
  .kb-postbit[data-kb-postbit="side"] { align-items: flex-start !important; }
  .kb-postbit[data-kb-postbit="side"] .kb-postbit-avatar[data-kb-slot="portrait"] {
    overflow: visible !important; flex: 0 0 ${w} !important; width: ${w} !important; aspect-ratio: 1 / 2 !important; }
  .kb-postbit[data-kb-postbit="side"] .kb-postbit-avatar[data-kb-slot="portrait"] > picture,
  .kb-postbit[data-kb-postbit="side"] .kb-postbit-avatar[data-kb-slot="portrait"] > picture > img { height: 100%; object-fit: fill; }
  .kb-postbit[data-kb-postbit="side"] .kb-postbit-avatar[data-kb-slot="portrait"] > .kb-outfit[data-kb-on="portrait"] { display: block !important; }
  .kb-postbit[data-kb-postbit="side"] .kb-postbit-avatar[data-kb-slot="portrait"] > .kb-outfit[data-kb-on="square"] { display: none !important; }
`;
const swapped = `
  .kb-postbit[data-kb-postbit="side"] .kb-postbit-name { order: 0; }
  .kb-postbit[data-kb-postbit="side"] .kb-postbit-rank { order: 1; }
  .kb-postbit[data-kb-postbit="side"] .kb-postbit-title { order: 2; }
  .kb-postbit[data-kb-postbit="side"] .kb-postbit-group { order: 3; }
`;
const under = (w) => `
  .mock-left { display: flex; flex-direction: column; flex: 0 0 ${w}; width: ${w}; gap: 0.3em; }
  .mock-left .kb-group-bar { width: 100%; margin: 0; letter-spacing: 0.02em; }
  .mock-left .kb-postbit-avatar { flex: none !important; }
  .kb-postbit[data-kb-postbit="side"] .kb-postbit-name { order: 0; }
  .kb-postbit[data-kb-postbit="side"] .kb-postbit-rank { order: 1; }
  .kb-postbit[data-kb-postbit="side"] .kb-postbit-title { order: 2; }
`;
(async () => {
  const b = await chromium.launch({ args: ['--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb'] });
  for (const [name, css, move] of [['0-before', '', false], ['1-tall-swapped-fitted', tall('3.6em') + swapped, false], ['2-tall-group-under-avatar-fitted', tall('2.7em') + under('2.7em'), true]]) {
    const p = await b.newPage({ bypassCSP: true, viewport: { width: 360, height: 800 }, deviceScaleFactor: 2 });
    await p.goto('http://localhost:4173/?fixture=boards&story=boards-01-postbit-gear--gear-and-trophies');
    await p.waitForSelector('.kb-postbit');
    await p.waitForTimeout(500);
    if (css) {
      await p.addStyleTag({ content: css });
      await p.evaluate((move) => {
        for (const bit of document.querySelectorAll('.kb-postbit[data-kb-postbit="side"]')) {
          bit.querySelector('picture > source')?.remove(); // the phone's square source: the whole 1:2 crop instead
          if (!move) continue;
          const left = document.createElement('div'); left.className = 'mock-left';
          const av = bit.querySelector('.kb-postbit-avatar'); const grp = bit.querySelector('.kb-postbit-group');
          av.before(left); left.append(av); if (grp) left.append(grp);
        }
      }, move);
    }
    await p.waitForTimeout(300);
    const posts = p.locator('.kb-act');
    await posts.first().screenshot({ path: `${process.argv[2]}/${name}-post1.png` });
    await posts.nth(1).screenshot({ path: `${process.argv[2]}/${name}-post2.png` });
    await p.close();
  }
  await b.close();
})();

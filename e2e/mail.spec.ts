import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { luminance, parseColor } from './glass-text.ts';
import { authTemplates } from '../supabase/functions/_shared/mail/auth.ts';

/**
 * The two Auth emails in a real browser (glass-mail plan, Task 6), as the committed templates read once Supabase has filled its
 * placeholders with a code, a redirect and a token hash. At 600 and at 320 wide, with the images loading and refused, each template
 *   - never scrolls sideways,
 *   - holds its code as one run of six digits a player can select whole,
 *   - links its button to the link,
 *   - and every text node meets 4.5:1 on the cell behind it.
 * It needs no server: the page is set from the template, and the images are answered from the instance's public/mail folder by route
 * (the deployed https://dw.gripe/mail/ URLs), or, for "images off", the pictures aborted. Outside the build, with the rest of the e2e run.
 *
 * The contrast is read as e2e/glass-text.spec.ts reads a surface: the color as drawn (opacity above it included) against the pixels
 * photographed under the line with its text hidden, the worst pixel being the ground. e2e/glass-text.ts holds the arithmetic
 * (`luminance`, `parseColor`); an email has no glass, so its cell is the nearest ancestor with a background (the smoke image is
 * a background-image over the ground color, so the photograph is the truth where an image is on).
 */
const CODE = '482915';
const REDIRECT = 'https://dw.gripe/sign-in?next=%2Fboard%2Fgeneral';
const HASH = 'sampletokenhash';
const LINK = `${REDIRECT}#token_hash=${HASH}`;
const MAIL = new URL('../instances/divided-world/ui/public/mail/', import.meta.url);

const BUTTON: Record<string, string> = { 'sign-in': 'Sign in', 'sign-up': 'Finish signing up' };
const TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', woff2: 'font/woff2' };

async function serve(page: Page, images: boolean) {
  await page.route('https://dw.gripe/mail/**', (route) => {
    const rel = new URL(route.request().url()).pathname.replace('/mail/', '');
    /* "Images off" refuses the pictures and keeps the fonts, as a client that blocks remote images does. */
    if (!images && /\.(jpg|png)$/.test(rel)) return route.abort();
    return route.fulfill({ body: readFileSync(new URL(rel, MAIL)), contentType: TYPES[rel.split('.').pop()!] });
  });
}

const filled = (html: string) => html.replaceAll('{{ .Token }}', CODE).replaceAll('{{ .RedirectTo }}', REDIRECT).replaceAll('{{ .TokenHash }}', HASH);

type Template = ReturnType<typeof authTemplates>[number];
const nameOf = (t: Template) => t.path.replace(/^.*\//, '').replace('.html', '');

/** A template as a recipient's client shows it: filled, at a width, with the pictures loading or refused, and its fonts ready. */
async function show(page: Page, t: Template, width: number, images: boolean) {
  await page.setViewportSize({ width, height: 1000 });
  await serve(page, images);
  await page.setContent(filled(t.html), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
}

/** Faults of sideways scroll: [] when the document is no wider than the window. */
async function sideways(page: Page): Promise<string[]> {
  const w = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  return w.scroll <= w.client ? [] : [`the document scrolls sideways: ${w.scroll}px of content in a ${w.client}px window`];
}

/** Faults of the code: it must be one element holding one text run that selects as the six digits. */
async function codeRun(page: Page): Promise<string[]> {
  const got = await page.evaluate((code) => {
    const el = [...document.querySelectorAll('p')].find((p) => (p.textContent ?? '').replace(/\s/g, '') === code);
    if (!el) return null;
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    const text = sel.toString();
    sel.removeAllRanges();
    return { text, nodes: el.childNodes.length };
  }, CODE);
  if (!got) return ['no element holds the code alone'];
  return [...(got.text === CODE ? [] : [`the code selects as ${JSON.stringify(got.text)}, not ${CODE}`]), ...(got.nodes === 1 ? [] : [`the code is split into ${got.nodes} runs`])];
}

interface Line { text: string; color: string; box: { x: number; y: number; width: number; height: number } }

/** Faults of contrast: each text node's color as drawn against the pixels photographed under its box with every text hidden; the worst pixel decides. */
async function contrast(page: Page): Promise<string[]> {
  const lines = await page.evaluate(() => {
    const out: Line[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? '').trim();
      const el = n.parentElement!;
      if (!text || el.closest('script, style, [style*="display:none"]')) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      let alpha = 1;
      for (let e: Element | null = el; e; e = e.parentElement) alpha *= Number(getComputedStyle(e).opacity);
      const c = getComputedStyle(el).color;
      out.push({ text, color: alpha === 1 ? c : `${c}|${alpha}`, box: { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height } });
    }
    return out;
  });
  if (lines.length <= 5) return [`only ${lines.length} lines of text were found`];
  await page.addStyleTag({ content: '* { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important }' });
  const shot = (await page.screenshot({ fullPage: true })).toString('base64');
  const grounds = await page.evaluate(async ([png, boxes]) => {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const cx = cv.getContext('2d')!;
    cx.drawImage(img, 0, 0);
    return (boxes as Line['box'][]).map((b) => {
      const x = Math.max(0, Math.floor(b.x)), y = Math.max(0, Math.floor(b.y));
      const w = Math.max(1, Math.min(img.width - x, Math.ceil(b.width))), h = Math.max(1, Math.min(img.height - y, Math.ceil(b.height)));
      const d = cx.getImageData(x, y, w, h).data;
      /* Every distinct pixel under the line: the caller takes the worst ratio over them. */
      const seen = new Map<number, [number, number, number]>();
      for (let i = 0; i < d.length; i += 4) seen.set((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!, [d[i]!, d[i + 1]!, d[i + 2]!]);
      return [...seen.values()];
    });
  }, [shot, lines.map((l) => l.box)] as const);
  const faults: string[] = [];
  lines.forEach((l, i) => {
    const [c, alpha] = l.color.split('|');
    const fg = parseColor(c!)!;
    const a = (alpha ? Number(alpha) : 1) * fg[3];
    const lf = (rgb: readonly number[], back: readonly number[]) => luminance(...(rgb.map((v, k) => v * a + back[k]! * (1 - a)) as [number, number, number]));
    let min = Infinity;
    for (const bg of grounds[i]!) {
      const L1 = lf(fg, bg), L2 = luminance(bg[0]!, bg[1]!, bg[2]!);
      min = Math.min(min, (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05));
    }
    if (min < 4.5) faults.push(`${JSON.stringify(l.text.slice(0, 40))}: ${min.toFixed(2)}:1`);
  });
  return faults;
}

for (const t of authTemplates()) {
  const name = nameOf(t);
  for (const width of [600, 320]) {
    for (const images of [true, false]) {
      test(`the ${name} email at ${width} wide, images ${images ? 'on' : 'off'}`, async ({ page }, testInfo) => {
        await show(page, t, width, images);
        await testInfo.attach(`${name}-${width}-${images ? 'images' : 'noimages'}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
        expect(await sideways(page), 'sideways scroll').toEqual([]);
        expect(await codeRun(page), 'the code').toEqual([]);
        await expect(page.getByRole('link', { name: BUTTON[name]! })).toHaveAttribute('href', LINK);
        expect(await contrast(page), 'text under 4.5:1 on the cell behind it').toEqual([]);
      });
    }
  }
}

/*
 * The poisons: each defect the checks above exist to catch, planted in a real filled template and expected named. None ships in a template.
 */
const sample = authTemplates()[0]!;

test('the poison: a text color dimmed below 4.5:1 is named with its ratio', async ({ page }) => {
  await show(page, sample, 600, true);
  await page.addStyleTag({ content: 'h1, p { color: #3a2a5a !important }' });
  expect(await contrast(page)).toContainEqual(expect.stringMatching(/^"Sign in to Divided World": 1\.\d\d:1$/));
});

test('the poison: a wide element makes the document scroll sideways, and is named', async ({ page }) => {
  await show(page, sample, 320, true);
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div style="width:900px;height:4px"></div>'));
  expect(await sideways(page)).toEqual([expect.stringMatching(/^the document scrolls sideways: \d+px of content in a 320px window$/)]);
});

test('the poison: the code split across two spans does not select as one run', async ({ page }) => {
  await show(page, sample, 600, true);
  await page.evaluate((code) => {
    const el = [...document.querySelectorAll('p')].find((p) => p.textContent === code)!;
    el.innerHTML = `<span>${code.slice(0, 3)}</span><span>${code.slice(3)}</span>`;
  }, CODE);
  expect(await codeRun(page)).toEqual(['the code is split into 2 runs']);
});

test('the poison: a space inside the code selects as more than the six digits', async ({ page }) => {
  await show(page, sample, 600, true);
  await page.evaluate((code) => {
    const el = [...document.querySelectorAll('p')].find((p) => p.textContent === code)!;
    el.textContent = `${code.slice(0, 3)} ${code.slice(3)}`;
  }, CODE);
  expect(await codeRun(page)).toEqual([expect.stringContaining('selects as "482 915"')]);
});

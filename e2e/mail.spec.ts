import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { luminance, parseColor } from './glass-text.ts';
import { authTemplates } from '../supabase/functions/_shared/mail/auth.ts';

/**
 * The two Auth emails in a real browser (glass-mail plan, Task 6), as the committed templates read once Supabase has filled its
 * two placeholders with a code and a link. At 600 and at 320 wide, with the images loading and refused, each template
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
const LINK = 'https://dw.gripe/auth/sample-link';
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

const filled = (html: string) => html.replaceAll('{{ .Token }}', CODE).replaceAll('{{ .ConfirmationURL }}', LINK);

for (const t of authTemplates()) {
  const name = t.path.replace(/^.*\//, '').replace('.html', '');
  for (const width of [600, 320]) {
    for (const images of [true, false]) {
      test(`the ${name} email at ${width} wide, images ${images ? 'on' : 'off'}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 1000 });
        await serve(page, images);
        await page.setContent(filled(t.html), { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        await testInfo.attach(`${name}-${width}-${images ? 'images' : 'noimages'}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

        const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
        expect(widths.scroll, 'the document scrolls sideways').toBeLessThanOrEqual(widths.client);

        const selected = await page.evaluate((code) => {
          const el = [...document.querySelectorAll('p')].find((p) => p.textContent === code);
          if (!el) return null;
          const range = document.createRange();
          range.selectNodeContents(el);
          const sel = getSelection()!;
          sel.removeAllRanges();
          sel.addRange(range);
          return { text: sel.toString(), nodes: el.childNodes.length };
        }, CODE);
        expect(selected, 'no element holds the code alone').not.toBeNull();
        expect(selected!.text).toBe(CODE);
        expect(selected!.nodes, 'the code is split into more than one run').toBe(1);

        await expect(page.getByRole('link', { name: BUTTON[name]! })).toHaveAttribute('href', LINK);

        await page.evaluate(() => getSelection()!.removeAllRanges());
        /* Contrast: hide every text, photograph, then read each text node's color against the pixels under its box. */
        const lines = await page.evaluate(() => {
          const out: { text: string; color: string; box: { x: number; y: number; width: number; height: number } }[] = [];
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
        expect(lines.length).toBeGreaterThan(5);
        await page.addStyleTag({ content: '* { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important }' });
        const shot = (await page.screenshot({ fullPage: true })).toString('base64');
        const worst = await page.evaluate(async ([png, boxes]) => {
          const img = new Image();
          img.src = `data:image/png;base64,${png}`;
          await img.decode();
          const cv = document.createElement('canvas');
          cv.width = img.width; cv.height = img.height;
          const cx = cv.getContext('2d')!;
          cx.drawImage(img, 0, 0);
          return (boxes as { x: number; y: number; width: number; height: number }[]).map((b) => {
            const x = Math.max(0, Math.floor(b.x)), y = Math.max(0, Math.floor(b.y));
            const w = Math.max(1, Math.min(img.width - x, Math.ceil(b.width))), h = Math.max(1, Math.min(img.height - y, Math.ceil(b.height)));
            const d = cx.getImageData(x, y, w, h).data;
            /* The pixel the text is hardest to read on: the one nearest its own color, found by the caller; return distinct pixels. */
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
          for (const bg of worst[i]!) {
            const L1 = lf(fg, bg), L2 = luminance(bg[0]!, bg[1]!, bg[2]!);
            min = Math.min(min, (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05));
          }
          if (min < 4.5) faults.push(`${JSON.stringify(l.text.slice(0, 40))}: ${min.toFixed(2)}:1`);
        });
        expect(faults, 'text under 4.5:1 on the cell behind it').toEqual([]);
      });
    }
  }
}

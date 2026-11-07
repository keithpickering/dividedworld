/**
 * The mail shell: one frame, drawn the same for every email, around a list of typed blocks.
 * `renderHtml` writes the HTML part (a table layout with every style inline, because mail
 * clients drop or rewrite what a stylesheet says); `renderText` writes the plain-text part
 * from the same blocks, so the words are never a second set.
 *
 * Three things here are safety, not style:
 * - Every string a caller supplies is escaped before it is written, and an `href` must be
 *   `https:`, `mailto:` or exactly a slot the caller declares (a placeholder another system
 *   fills in later, such as Supabase's `{{ .ConfirmationURL }}`). Anything else throws, naming
 *   the block, rather than ship a link that runs script.
 * - Escaping touches `& < > " '` and nothing else, so a slot used as a value survives as
 *   written; and nothing the shell writes itself contains `{{`, so Go's template engine finds
 *   only the slots the caller put there.
 * - Every color written is a theme color or `blend` of two of them: the shell has no color
 *   literals of its own, and no second palette to drift from the instance's.
 *
 * Nothing here names an instance or touches a DOM: the theme carries all of that.
 */
import type { Block, Mail, MailTheme } from './types.ts';

export interface RenderOptions {
  /** Placeholders a button's href may be, exactly (for example `{{ .ConfirmationURL }}`). */
  readonly slots?: readonly string[];
}

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0');

/** `color` at `alpha` over `over`, as a 6-digit hex. The shell's only color arithmetic. */
export function blend(color: string, over: string, alpha: number): string {
  const chan = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  let out = '#';
  for (let i = 0; i < 3; i++) out += hex2(chan(color, i) * alpha + chan(over, i) * (1 - alpha));
  return out;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function checkTheme(t: MailTheme): void {
  for (const [k, v] of Object.entries(t.colors)) if (!/^#[0-9a-fA-F]{6}$/.test(v)) throw new Error(`theme color ${k}: not a 6-digit hex`);
  for (const [k, v] of [['site', t.site], ...Object.entries(t.assets), ...t.fonts.map((f) => ['font ' + f.family, f.url] as const)])
    if (!/^https:\/\/[^\s"'<>()\\]+$/.test(v)) throw new Error(`theme ${k}: not an absolute https URL`);
  for (const [k, v] of Object.entries(t.stacks)) if (/["<>;{}]/.test(v)) throw new Error(`theme stack ${k}: holds a character that breaks an inline style`);
  for (const f of t.fonts) if (/["'<>;{}\\]/.test(f.family)) throw new Error(`theme font ${f.family}: bad family`);
}

function checkHref(href: string, where: string, slots: readonly string[]): string {
  if (!/^(https:|mailto:)/.test(href) && !slots.includes(href)) throw new Error(`${where}: href ${JSON.stringify(href)} is not https:, mailto: or a declared slot`);
  if (/[\u0000-\u001f\u007f]/.test(href)) throw new Error(`${where}: href holds a control character`);
  return esc(href);
}

export function renderHtml(theme: MailTheme, mail: Mail, options: RenderOptions = {}): string {
  checkTheme(theme);
  const slots = options.slots ?? [];
  const c = theme.colors;
  const D = theme.stacks.display;
  const B = theme.stacks.body;
  const rule = blend(c.violet, c.ground, 0.35);
  const quoteEdge = blend(c.violet, c.ground, 0.55);
  const seam = [0.38, 0.18, 0.07].map((a) => blend(c.neon, c.ground, a));
  const groundBg = `background:${c.ground};background-image:linear-gradient(${c.ground},${c.ground})`;

  // Gmail's apps invert colors; wrapping text in two blended divs keeps it light there (the
  // `u + .body` selector matches only Gmail). The markup is inert everywhere else.
  const gm = (inner: string) => `<div class="gs"><div class="gd">${inner}</div></div>`;
  const line = (tag: string, style: string, text: string, cls = '') =>
    gm(`<${tag}${cls ? ` class="${cls}"` : ''} style="${style}">${esc(text)}</${tag}>`);
  const row = (td: string) => `<tr><td class="pad" style="padding:0 40px">${td}</td></tr>`;
  const seamRow = (bg: string) =>
    `<tr><td height="1" style="height:1px;line-height:1px;font-size:0;background:${bg}">&nbsp;</td></tr>`;
  const lab = (color: string) =>
    `margin:0 0 6px;font-family:${B};font-weight:600;font-size:16px;letter-spacing:2px;text-transform:uppercase;color:${color}`;

  const draw = (b: Block, i: number): string => {
    const where = `${b.type} block ${i + 1}`;
    switch (b.type) {
      case 'heading':
        return row(line('h1', `margin:0 0 16px;font-family:${D};font-weight:400;font-size:30px;line-height:1.15;letter-spacing:1px;text-transform:uppercase;color:${c.hi}`, b.text, 'd'));
      case 'paragraph':
        return row(line('p', `margin:0 0 18px;font-family:${B};font-weight:500;font-size:20px;line-height:1.45;color:${c.text2}`, b.text));
      case 'note':
        return row(line('p', `margin:0 0 28px;font-family:${B};font-weight:500;font-size:18px;line-height:1.45;color:${c.text2}`, b.text));
      case 'code':
        return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 24px;border-collapse:separate"><tr>
<td style="background:${c.field};border:1px solid ${c.neon};border-right:0;padding:18px 0 20px 24px">${line('p', lab(c.neonText), b.label)}${line('p', `margin:0;font-family:${D};font-size:48px;line-height:1;letter-spacing:12px;color:${c.hi};font-variant-numeric:tabular-nums`, b.code, 'd')}</td>
<td width="12" valign="top" style="width:12px;background:${c.field};border:1px solid ${c.neon};border-left:0;padding:0;line-height:0;vertical-align:top"><img src="${theme.assets.cutPanel}" width="13" height="13" alt="" style="display:block;margin:-1px -1px 0 0;border:0"></td></tr></table>`);
      case 'button':
        return row(`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 26px"><tr>
<td style="background:${c.neon};padding:14px 10px 14px 26px"><a href="${checkHref(b.href, where, slots)}" style="font-family:${B};font-weight:700;font-size:19px;letter-spacing:2px;text-transform:uppercase;color:${c.ink};text-decoration:none;display:inline-block">${esc(b.label)}</a></td>
<td width="12" valign="bottom" style="width:12px;background:${c.neon};padding:0;line-height:0"><img src="${theme.assets.cutButton}" width="12" height="12" alt="" style="display:block;border:0"></td></tr></table>`);
      case 'facts':
        return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;border-top:1px solid ${rule}">${b.rows
          .map(([k, v]) => `<tr>
<td valign="top" style="width:96px;padding:10px 12px 10px 0;border-bottom:1px solid ${rule}">${line('p', `margin:0;font-family:${B};font-weight:600;font-size:16px;letter-spacing:2px;text-transform:uppercase;color:${c.neonText}`, k)}</td>
<td style="padding:10px 0;border-bottom:1px solid ${rule}">${line('p', `margin:0;font-family:${B};font-weight:500;font-size:20px;line-height:1.35;color:${c.text}`, v)}</td></tr>`)
          .join('')}</table>`);
      case 'quote':
        return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px"><tr><td style="background:${c.field};border:1px solid ${quoteEdge};padding:16px 20px">${line('p', lab(c.violet).replace('0 0 6px', '0 0 8px'), b.label)}${line('p', `margin:0;font-family:${B};font-weight:500;font-size:19px;line-height:1.45;color:${c.text2}`, b.words)}</td></tr></table>`);
    }
  };

  const fontFaces = theme.fonts
    .map((f) => {
      const fmt = /\.woff2$/.test(f.url) ? ' format("woff2")' : /\.woff$/.test(f.url) ? ' format("woff")' : '';
      return `@font-face{font-family:'${f.family}';font-weight:${f.weight};font-style:${f.style};src:url(${f.url})${fmt}}`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${esc(mail.subject)}</title>
<style>
${fontFaces}
:root{color-scheme:dark}
@media (max-width:620px){.pad{padding-left:24px!important;padding-right:24px!important}.mast{height:132px!important}}
u + .body .gs{background:${c.ground};mix-blend-mode:screen}
u + .body .gd{background:${c.ground};mix-blend-mode:difference}
</style>
<!--[if mso]><style>body,table,td,p,a,div{font-family:Arial,sans-serif!important}h1,.d{font-family:Impact,Arial,sans-serif!important}</style><![endif]-->
</head>
<body class="body" style="margin:0;padding:0;${groundBg}">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(mail.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${c.ground}" style="${groundBg}"><tr><td align="center" style="padding:0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td class="mast" height="180" valign="middle" background="${theme.assets.smoke}" bgcolor="${c.ground}" style="height:180px;background:${c.ground} url(${theme.assets.smoke}) center top / cover no-repeat;padding:0 40px">
<!--[if gte mso 9]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:600px;height:180px"><v:fill type="frame" src="${theme.assets.smoke}" color="${c.ground}"/><v:textbox inset="40px,0,40px,0"><![endif]-->
${line('p', `margin:0;font-family:${D};font-size:34px;line-height:1;letter-spacing:2px;text-transform:uppercase;color:${c.text}`, theme.name, 'd')}
<!--[if gte mso 9]></v:textbox></v:rect><![endif]--></td></tr>
${seamRow(c.pale)}
${seam.map(seamRow).join('\n')}
<tr><td height="36" style="height:36px;line-height:36px;font-size:0">&nbsp;</td></tr>
${mail.blocks.map(draw).join('\n')}
<tr><td class="pad" style="padding:8px 40px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid ${rule};padding:18px 0 0">${gm(`<p style="margin:0;font-family:${B};font-weight:500;font-size:16px;line-height:1.4;color:${c.text2}">${esc(theme.name)} &middot; <a href="${esc(theme.site)}" style="color:${c.neonText}">${esc(theme.site.replace(/^https:\/\//, '').replace(/\/$/, ''))}</a></p>`)}</td></tr></table></td></tr>
<tr><td align="center" style="padding:28px 0 40px"><img src="${theme.assets.coin}" width="40" height="40" alt="" style="display:block;border:0"></td></tr>
</table></td></tr></table></body></html>`;
}

/** The plain-text part, from the same blocks. No markup; blocks are separated by a blank line. */
export function renderText(mail: Mail): string {
  const parts = mail.blocks.map((b) => {
    switch (b.type) {
      case 'heading': return b.text.toUpperCase();
      case 'paragraph':
      case 'note': return b.text;
      case 'code': return `${b.label}\n${b.code}`;
      case 'button': return `${b.label}: ${b.href}`;
      case 'facts': return b.rows.map(([k, v]) => `${k}: ${v}`).join('\n');
      case 'quote': return [b.label, ...b.words.split('\n')].map((l) => `> ${l}`).join('\n');
    }
  });
  return parts.join('\n\n') + '\n';
}

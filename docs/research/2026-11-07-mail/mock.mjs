// Mockup generator: the shell's blocks as functions, two emails out. Not the build's code; the plan's Task 2 builds the real one.
import fs from 'node:fs';
const T = { ground: '#07050d', field: '#160d2a', text: '#f1ecff', text2: '#e4def7', hi: '#ffffff', pale: '#c9f8ff', neon: '#19e3ff', neonText: '#9ef4ff', violet: '#a78bfa', ink: '#03141a' };
const mix = (a, b, t) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * t + parseInt(b.slice(i, i + 2), 16) * (1 - t)).toString(16).padStart(2, '0')).join('');
const DISPLAY = "Anton, Impact, 'Arial Narrow Bold', sans-serif";
const BODY = "'Barlow Condensed', 'Arial Narrow', Arial, sans-serif";
const F = '../../../instances/divided-world/ui/fonts/';
const gfix = (inner) => inner; // Gmail's blend wrappers live in the real shell
const row = (td) => `<tr><td style="padding:0 40px" class="pad">${td}</td></tr>`;
const blocks = {
  heading: (t) => row(`<h1 style="margin:0 0 16px;font-family:${DISPLAY};font-weight:400;font-size:30px;line-height:1.15;letter-spacing:1px;text-transform:uppercase;color:${T.hi}">${t}</h1>`),
  p: (t) => row(`<p style="margin:0 0 18px;font-family:${BODY};font-weight:500;font-size:20px;line-height:1.45;color:${T.text2}">${t}</p>`),
  code: (label, code) => row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 24px;border-collapse:separate"><tr>
<td style="background:${T.field};border:1px solid ${T.neon};border-right:0;padding:18px 0 20px 24px">
<p style="margin:0 0 6px;font-family:${BODY};font-weight:600;font-size:16px;letter-spacing:2px;text-transform:uppercase;color:${T.neonText}">${label}</p>
<p style="margin:0;font-family:${DISPLAY};font-size:48px;line-height:1;letter-spacing:12px;color:${T.hi};font-variant-numeric:tabular-nums">${code}</p></td>
<td width="12" valign="top" style="width:12px;background:${T.field};border:1px solid ${T.neon};border-left:0;padding:0;line-height:0;vertical-align:top"><img src="cut-panel.png" width="13" height="13" alt="" style="display:block;margin:-1px -1px 0 0;border:0"></td></tr></table>`),
  button: (label, href) => row(`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 26px"><tr>
<td style="background:${T.neon};padding:14px 10px 14px 26px"><a href="${href}" style="font-family:${BODY};font-weight:700;font-size:19px;letter-spacing:2px;text-transform:uppercase;color:${T.ink};text-decoration:none;display:inline-block">${label}</a></td>
<td width="12" valign="bottom" style="width:12px;background:${T.neon};padding:0;line-height:0"><img src="cut-button.png" width="12" height="12" alt="" style="display:block;border:0"></td></tr></table>`),
  facts: (rows) => row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;border-top:1px solid ${mix(T.violet, T.ground, 0.35)}">${rows.map(([k, v]) => `<tr>
<td valign="top" style="width:96px;padding:10px 12px 10px 0;border-bottom:1px solid ${mix(T.violet, T.ground, 0.35)};font-family:${BODY};font-weight:600;font-size:16px;letter-spacing:2px;text-transform:uppercase;color:${T.neonText}">${k}</td>
<td style="padding:10px 0;border-bottom:1px solid ${mix(T.violet, T.ground, 0.35)};font-family:${BODY};font-weight:500;font-size:20px;line-height:1.35;color:${T.text}">${v}</td></tr>`).join('')}</table>`),
  quote: (who, words) => row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px"><tr><td style="background:${T.field};border:1px solid ${mix(T.violet, T.ground, 0.55)};padding:16px 20px">
<p style="margin:0 0 8px;font-family:${BODY};font-weight:600;font-size:16px;letter-spacing:2px;text-transform:uppercase;color:${T.violet}">${who}</p>
<p style="margin:0;font-family:${BODY};font-weight:500;font-size:19px;line-height:1.45;color:${T.text2}">${words}</p></td></tr></table>`),
  note: (t) => row(`<p style="margin:0 0 28px;font-family:${BODY};font-weight:500;font-size:18px;line-height:1.45;color:${T.text2}">${t}</p>`),
};
const shell = ({ subject, preheader, body }) => `<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${subject}</title>
<style>
@font-face{font-family:Anton;font-weight:400;src:url(${F}Anton-Regular.woff2) format("woff2")}
@font-face{font-family:'Barlow Condensed';font-weight:500;src:url(${F}BarlowCondensed-Medium.woff2) format("woff2")}
@font-face{font-family:'Barlow Condensed';font-weight:600;src:url(${F}BarlowCondensed-SemiBold.woff2) format("woff2")}
@font-face{font-family:'Barlow Condensed';font-weight:700;src:url(${F}BarlowCondensed-Bold.woff2) format("woff2")}
:root{color-scheme:dark}
a{color:${T.neonText}}
@media (max-width:620px){.pad{padding-left:24px!important;padding-right:24px!important}.mast{height:132px!important}}
</style></head>
<body style="margin:0;padding:0;background:${T.ground};background-image:linear-gradient(${T.ground},${T.ground})">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${T.ground}" style="background:${T.ground};background-image:linear-gradient(${T.ground},${T.ground})"><tr><td align="center" style="padding:0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td class="mast" height="180" valign="middle" background="smoke.jpg" bgcolor="${T.ground}" style="height:180px;background:${T.ground} url(smoke.jpg) center top / cover no-repeat;padding:0 40px">
<p style="margin:0;font-family:${DISPLAY};font-size:34px;line-height:1;letter-spacing:2px;text-transform:uppercase;color:${T.text}">Divided World</p></td></tr>
<tr><td height="1" style="height:1px;line-height:1px;font-size:0;background:${T.pale}">&nbsp;</td></tr>
<tr><td height="1" style="height:1px;line-height:1px;font-size:0;background:${mix(T.neon, T.ground, 0.38)}">&nbsp;</td></tr>
<tr><td height="1" style="height:1px;line-height:1px;font-size:0;background:${mix(T.neon, T.ground, 0.18)}">&nbsp;</td></tr>
<tr><td height="1" style="height:1px;line-height:1px;font-size:0;background:${mix(T.neon, T.ground, 0.07)}">&nbsp;</td></tr>
<tr><td height="36" style="height:36px;line-height:36px;font-size:0">&nbsp;</td></tr>
${body.join('\n')}
<tr><td style="padding:8px 40px 0" class="pad"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid ${mix(T.violet, T.ground, 0.35)};padding:18px 0 0;font-family:${BODY};font-weight:500;font-size:16px;line-height:1.4;color:${T.text2}">Divided World · <a href="https://dw.gripe" style="color:${T.neonText}">dw.gripe</a></td></tr></table></td></tr>
<tr><td align="center" style="padding:28px 0 40px"><img src="coin-96.png" width="40" height="40" alt="" style="display:block;border:0"></td></tr>
</table></td></tr></table></body></html>`;
const b = blocks;
fs.writeFileSync(process.argv[2] + '/01-sign-in.html', shell({ subject: 'Your Divided World sign-in code', preheader: 'Your code is 482915.', body: [
  b.heading('Sign in to Divided World'),
  b.p('Type this code where you asked for it, or use the button to sign in.'),
  b.code('Your code', '482915'),
  b.button('Sign in', '#'),
  b.note('If you did not ask to sign in, you can ignore this email: nobody can sign in without the code or the link.'),
] }));
fs.writeFileSync(process.argv[2] + '/02-hidden-post.html', shell({ subject: 'An admin hid one of your posts', preheader: 'Edit it and it comes back.', body: [
  b.heading('An admin hid one of your posts'),
  b.p('A person, not the game, read this post and hid it because it broke the code of conduct. Your words are kept. Edit the post and it comes back.'),
  b.facts([['Thread', 'Who keeps reacting Salty to my Promos?'], ['Rule', '1. The mask is fair game; the person isn’t.'], ['Note', 'The last line is about their job, not their character. Cut it and the rest can stand.']]),
  b.quote('Your post', 'Bold words from a mask who’s been Salty since the day the board opened. Maybe stick to your day job at the…'),
  b.button('Edit the post', '#'),
  b.note('Think the admin got it wrong? Reply to this email and a person will read it.'),
] }));

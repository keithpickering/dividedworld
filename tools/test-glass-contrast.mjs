/**
 * Tests for the guard in tools/check-glass-contrast.mjs.
 *
 *   node tools/test-glass-contrast.mjs
 *
 * The guard holds every instance's glass (instances/<name>/ui/glass.json) to its contrast before
 * anything renders: it composites each smoke recipe's layers at full noise over the ground for the
 * worst pixel, thins them by the calm for the calmed worst, and reads every text token, class color,
 * ink and size against them. A smoke that grows brighter, a calm that thins, a token that drifts
 * toward the smoke's color all look right in the house colors and change no other test, so each is
 * planted here and must fire, and the real glass runs first and last so a guard that has gone quiet
 * over nothing fails here.
 *
 * The first block pins the math to the numbers the plans give (the worst pixel of each recipe, and
 * the poisons' ratios), so a model that drifts from the audit's fails before any poison does.
 */
import { SURFACES, ceilingsFile, ceilingsStale, contrastRatio, glassCeilings, glassFaults, luminance, recipeWorsts, treeGlass } from './check-glass-contrast.mjs';

let pass = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    failures.push(name + (detail ? '  <- ' + detail : ''));
    console.log('  FAIL  ' + name + (detail ? '  <- ' + detail : ''));
  }
  return Boolean(condition);
}

const HOME = 'instances/divided-world/ui/glass.json';
const real = treeGlass()[HOME];
/** A fresh copy of Divided World's glass, for a poison to change. */
const fresh = () => structuredClone(real);
const near = (a, b, eps) => typeof a === 'number' && Math.abs(a - b) <= eps;
const text = (faults) => faults.map((f) => `${f.where}: ${f.why}`).join('\n');
/** Every fault whose line holds all the given words. */
const named = (faults, ...words) => faults.filter((f) => words.every((w) => `${f.where}: ${f.why}`.includes(w)));

check('the real glass is read', real !== undefined && Object.keys(real.smoke?.recipes ?? {}).length === 9, JSON.stringify(Object.keys(real?.smoke?.recipes ?? {})));
check('the real glass is clean', glassFaults(real).length === 0, text(glassFaults(real)));

/* ---- the math, against the numbers the plans give ---- */
{
  const worsts = recipeWorsts(real);
  /* The plans' worst pixels (the glass plan's section 6 table, the web plan's rgb(77,126,247)), to the third place. */
  const plan = { hud: 0.216, page: 0.230, characters: 0.196, turn: 0.116, effect: 0.103, react: 0.087, cards: 0.193, vending: 0.230, settlement: 0.274 };
  for (const [recipe, lum] of Object.entries(plan)) {
    check(`the ${recipe} recipe's worst pixel is ${lum}`, near(worsts[recipe]?.full.luminance, lum, 0.0021), String(worsts[recipe]?.full.luminance));
  }
  check('the page recipe\'s worst pixel is rgb(77,126,247), as the web plan says', JSON.stringify(worsts.page?.full.rgb.map(Math.round)) === '[77,126,247]', JSON.stringify(worsts.page?.full.rgb));
  check('the phone HUD\'s two layers are 0.249 at worst, as the glass plan says', near(worsts.hud?.narrow?.full.luminance, 0.249, 0.001), String(worsts.hud?.narrow?.full.luminance));
  check('a calm thins the smoke: the calmed worst is far below the full one', (worsts.page?.calmed.luminance ?? 1) < 0.05, String(worsts.page?.calmed.luminance));

  /* The web plan's poison numbers, which fix the calm's model (each layer thinned to 1 - calm) and the 8-bit color of a layer. */
  const ratio = (fg, bg) => contrastRatio(fg, bg);
  const thin = fresh();
  thin.calm.opacity = 0.3;
  const thinned = recipeWorsts(thin).page.calmed.rgb;
  check('with the calm at 0.3, #e4def7 is 4.42:1 on the page recipe', near(ratio('#e4def7', thinned), 4.42, 0.006), String(ratio('#e4def7', thinned)));
  check('#9ef4ff on the page recipe\'s full worst is under 3:1 (the plan: 2.99)', ratio('#9ef4ff', worsts.page.full.rgb) < 3 && near(ratio('#9ef4ff', worsts.page.full.rgb), 2.99, 0.01), String(ratio('#9ef4ff', worsts.page.full.rgb)));
  const loud = fresh();
  loud.smoke.recipes.page.layers[1].opacity = 1.0;
  check('with the cyan at 1.0, white is 1.69:1 on the page recipe', near(ratio('#ffffff', recipeWorsts(loud).page.full.rgb), 1.69, 0.006), String(ratio('#ffffff', recipeWorsts(loud).page.full.rgb)));
  check('#f1ecff on the settlement recipe\'s full worst is under 3:1 (the plan: 2.81)', ratio('#f1ecff', worsts.settlement.full.rgb) < 3 && near(ratio('#f1ecff', worsts.settlement.full.rgb), 2.81, 0.01), String(ratio('#f1ecff', worsts.settlement.full.rgb)));
  check('white is 3.24:1 on the settlement recipe\'s full worst', near(ratio('#ffffff', worsts.settlement.full.rgb), 3.24, 0.006), String(ratio('#ffffff', worsts.settlement.full.rgb)));
  check('luminance and ratio are WCAG\'s: white on black is 21:1', near(ratio('#ffffff', '#000000'), 21, 0.0001) && near(luminance('#ffffff'), 1, 0.0001));
}

/* ---- the web plan's seven poisons ---- */
{
  const g = fresh();
  g.calm.opacity = 0.3;
  const r = named(glassFaults(g), '--kb-glass-text-2', 'body');
  check('the calm lowered to 0.3: #e4def7 falls to 4.42:1', r.length > 0 && r.some((f) => f.why.includes('4.42')), text(glassFaults(g)).slice(0, 600));
  check('and the fault names the recipe, the token, the pair and the ratio', r.some((f) => /recipe page/.test(f.where) && f.why.includes('#e4def7') && /needs 4\.5/.test(f.why)), JSON.stringify(r[0]));
}
{
  const g = fresh();
  g.keys.standard['--kb-glass-neon-text'].tags = ['body', 'waiting', 'large'];
  const r = named(glassFaults(g), '--kb-glass-neon-text', 'large');
  check('a large heading token in #9ef4ff on the full smoke fires, 2.99:1', r.length > 0 && r.some((f) => /recipe page/.test(f.where) && f.why.includes('2.99')), text(glassFaults(g)).slice(0, 600));
}
{
  const g = fresh();
  g.smoke.recipes.page.layers[1].opacity = 1.0;
  const r = named(glassFaults(g), '--kb-glass-text-hi', 'large');
  check('the cyan layer\'s opacity raised to 1.0: white large text falls to 1.69:1', r.some((f) => /recipe page/.test(f.where) && f.why.includes('1.69')), text(glassFaults(g)).slice(0, 600));
}
{
  const g = fresh();
  g.sizes.body.px = 19;
  const r = named(glassFaults(g), 'size body');
  check('a body size of 19px fires: 17.1px of ink', r.length > 0 && r.some((f) => f.why.includes('17.1')), text(glassFaults(g)).slice(0, 600));
}
{
  const g = fresh();
  g.keys.standard['--kb-glass-text'].value = 'rgba(241, 236, 255, 0.8)';
  const r = named(glassFaults(g), '--kb-glass-text', 'opaque');
  check('a text color with an alpha of 0.8 fires', r.length > 0, text(glassFaults(g)).slice(0, 600));
  const h = fresh();
  h.keys.standard['--kb-glass-text-2'].value = '#e4def7cc';
  check('an 8-digit hex with an alpha fires too', named(glassFaults(h), '--kb-glass-text-2', 'opaque').length > 0);
}
{
  const g = fresh();
  delete g.keys.high['--kb-glass-text-2'];
  const r = named(glassFaults(g), '--kb-glass-text-2', 'high');
  check('a high key missing one token the standard key has fires, naming it', r.length > 0 && r.some((f) => /standard/.test(f.why)), text(glassFaults(g)).slice(0, 600));
  const e = fresh();
  e.keys.high['--kb-glass-extra'] = { value: '#ffffff' };
  check('a high key with a token the standard key lacks fires', named(glassFaults(e), '--kb-glass-extra', 'high').length > 0);
  const d = fresh();
  d.keys.high['--kb-glass-text'].value = '#5a5a5a';
  check('a high key text token under 7:1 on the bare ground fires', named(glassFaults(d), '--kb-glass-text', 'high', '7').length > 0, text(glassFaults(d)).slice(0, 400));
}
{
  const g = fresh();
  delete g.fonts[1].ink;
  const r = named(glassFaults(g), 'font', 'ink');
  check('a font with no ink ratio fires', r.length > 0 && r.some((f) => f.where.includes('BarlowCondensed-Medium')), text(glassFaults(g)).slice(0, 600));
}

/* ---- the glass plan's section 6 poisons ---- */
{
  const g = fresh();
  g.smoke.surfaces.log = 'nonesuch';
  const r = named(glassFaults(g), 'surface log', 'nonesuch');
  check('a surface naming a recipe that does not exist fires', r.length > 0, text(glassFaults(g)).slice(0, 400));
}
{
  const g = fresh();
  delete g.smoke.recipes.settlement.calmAll;
  const r = named(glassFaults(g), 'recipe settlement', '#f1ecff', 'large');
  check('the settlement recipe without calmAll: #f1ecff large falls under 3:1', r.length > 0 && r.some((f) => /2\.8/.test(f.why)), text(glassFaults(g)).slice(0, 600));
}
{
  const g = fresh();
  g.smoke.recipes.hud.narrow[1].opacity = 1.0;
  const r = named(glassFaults(g), 'recipe hud', 'narrow', 'large');
  check('the hud recipe\'s narrow cyan raised to 1.0 fires, naming the narrow layers', r.length > 0, text(glassFaults(g)).slice(0, 600));
  check('and only the narrow layers\' check fires: the wide layers are untouched', named(glassFaults(g), 'recipe hud').every((f) => f.where.includes('narrow')));
}
{
  const g = fresh();
  g.keys.standard['--kb-glass-ink-neon'].value = '#5a5a5a';
  const r = named(glassFaults(g), '--kb-glass-ink-neon', 'ink');
  check('an ink token of #5a5a5a on cyan fires', r.length > 0 && r.some((f) => /--kb-glass-neon/.test(f.why) || /--kb-glass-neon/.test(f.where)), text(glassFaults(g)).slice(0, 600));
}
{
  const g = fresh();
  g.classes.face.large = '#2a4a66';
  const r = named(glassFaults(g), 'class face', 'large');
  check('a class color whose large text is under 3:1 fires', r.length > 0, text(glassFaults(g)).slice(0, 600));
  const k = fresh();
  k.classes.heel.ink = '#5a5a5a';
  check('a class ink under 4.5:1 on its fill fires', named(glassFaults(k), 'class heel', 'ink').length > 0);
}

/* ---- the rest of the contract ---- */
{
  const g = fresh();
  delete g.smoke.surfaces.hud;
  check('a surface the engine lists and the theme leaves out fires', named(glassFaults(g), 'surface hud').length > 0);
  const e = fresh();
  e.smoke.surfaces.lobby = 'page';
  check('a surface the engine does not list fires', named(glassFaults(e), 'surface lobby').length > 0);
  check('the engine\'s closed list is read from engine/ui/types.ts: thirteen surfaces', SURFACES.length === 13 && SURFACES.includes('settlement') && SURFACES.includes('hud'), JSON.stringify(SURFACES));
}
{
  const g = fresh();
  g.keys.standard['--kb-glass-ground'].value = 'rgba(7, 5, 13, 0.9)';
  check('a translucent ground fires: the smoke is composited over it', named(glassFaults(g), '--kb-glass-ground', 'opaque').length > 0);
}
{
  const g = fresh();
  g.sizes['phone-small'].px = 15;
  check('a phone size under 16px fires', named(glassFaults(g), 'size phone-small', '16').length > 0);
  const h = fresh();
  h.sizes.body.family = 'Papyrus';
  check('a size in a face the instance does not ship fires', named(glassFaults(h), 'size body', 'Papyrus').length > 0);
}
{
  const g = fresh();
  g.keys.standard['--kb-glass-ink-ready'].on = ['--kb-glass-nonesuch'];
  check('an ink set on a token that is not in the key fires', named(glassFaults(g), '--kb-glass-ink-ready', '--kb-glass-nonesuch').length > 0);
}

/* ---- the ceilings Part 2's rendered measurement reads ---- */
{
  const ceilings = glassCeilings(real);
  const hud = ceilings.surfaces.hud;
  check('each surface carries its recipe, worst pixel and calmed worst', hud?.recipe === 'hud' && near(hud.worst, 0.216, 0.0021) && hud.calmedWorst < 0.05, JSON.stringify(hud && { recipe: hud.recipe, worst: hud.worst }));
  check('a body token\'s ceiling is the brightest background it still holds 4.5:1 on', near(hud?.tokens['--kb-glass-text-2']?.body, (luminance('#e4def7') + 0.05) / 4.5 - 0.05, 0.0001), JSON.stringify(hud?.tokens['--kb-glass-text-2']));
  check('a large token\'s ceiling is 3:1', near(hud?.tokens['--kb-glass-text']?.large, (luminance('#f1ecff') + 0.05) / 3 - 0.05, 0.0001), JSON.stringify(hud?.tokens['--kb-glass-text']));
  check('every surface has its ceilings', SURFACES.every((s) => ceilings.surfaces[s] !== undefined), JSON.stringify(Object.keys(ceilings.surfaces)));
  check('the settlement surface says it is calmAll', ceilings.surfaces.settlement?.calmAll === true && ceilings.surfaces.page === undefined);
  const file = ceilingsFile({ 'divided-world': ceilings });
  check('the ceilings file is the ceilings as JSON, for each instance', JSON.parse(file)['divided-world'].surfaces.hud.recipe === 'hud');
  check('a file equal to the computed ceilings is not stale', ceilingsStale(file, file) === false);
  const brighter = fresh();
  brighter.smoke.recipes.hud.layers[0].opacity = 0.9;
  const stale = ceilingsFile({ 'divided-world': glassCeilings(brighter) });
  check('a ceilings file that no longer matches glass.json is stale', ceilingsStale(file, stale) === true);
  check('a missing ceilings file is stale', ceilingsStale(file, null) === true);
}

/* ---- the real tree ---- */
{
  const all = treeGlass();
  check('the real tree holds Divided World\'s glass', Object.keys(all).includes(HOME), JSON.stringify(Object.keys(all)));
  for (const [file, glass] of Object.entries(all)) check(`${file} is clean`, glassFaults(glass).length === 0, text(glassFaults(glass)));
}

console.log(`\n  glass-contrast: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('  test-glass-contrast: FAILED\n    ' + failures.join('\n    '));
  process.exit(1);
}

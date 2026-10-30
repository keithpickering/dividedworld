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
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SURFACES, calmOf, ceilingsFile, ceilingsStale, contrastRatio, glassCeilings, glassFaults, luminance, recipeWorsts, treeGlass } from './check-glass-contrast.mjs';

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
  const f = named(glassFaults(g), 'surface hud');
  check('a surface the engine lists and the theme leaves out fires, as not named', f.length === 1 && f[0].why.includes('is not named'), text(glassFaults(g)));
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

/* ---- every fault class the guard has, planted once ---- */
/** The faults of a poisoned copy of the real glass whose line holds all the words, or []. */
const poisoned = (poison, ...words) => {
  const g = fresh();
  poison(g);
  return named(glassFaults(g), ...words);
};
/** The smallest ratio a gray makes against every recipe's calmed worst pixel (and the narrow ones'). */
const grayAt = (v) => [v, v, v];
const calmedBackgrounds = () => Object.values(recipeWorsts(real)).flatMap((w) => [w.calmed.rgb, ...(w.narrow ? [w.narrow.calmed.rgb] : [])]);
const minRatio = (rgb, bgs) => Math.min(...bgs.map((bg) => contrastRatio(rgb, bg)));
const hexOf = (v) => `#${v.toString(16).padStart(2, '0').repeat(3)}`;
/** The gray whose smallest ratio against `bgs` is nearest `target`. */
const grayFor = (bgs, target) => {
  let best = 0;
  for (let v = 0; v < 256; v++) if (Math.abs(minRatio(grayAt(v), bgs) - target) < Math.abs(minRatio(grayAt(best), bgs) - target)) best = v;
  return best;
};

check('an ink that names no fills fires', poisoned((g) => { g.keys.standard['--kb-glass-ink-ready'].on = []; }, '--kb-glass-ink-ready', 'names the fills').length === 1);
check('an ink that names no fills fires in the high key too', poisoned((g) => { g.keys.high['--kb-glass-ink-ready'].on = []; }, 'high key', 'names the fills').length === 1);
check('a translucent high-key ground fires', poisoned((g) => { g.keys.high['--kb-glass-ground'].value = 'rgba(0,0,0,0.9)'; }, '--kb-glass-ground', 'high').length > 0);
check('a high key whose tags differ from the standard key\'s fires', poisoned((g) => { g.keys.high['--kb-glass-text'].tags = ['body']; }, '--kb-glass-text', 'high key tags').length === 1);
check('a calm with no opacity fires', poisoned((g) => { g.calm.opacity = 0; }, 'calm', 'opacity').length === 1);
check('a calm opacity above 1 fires', poisoned((g) => { g.calm.opacity = 1.2; }, 'calm', 'opacity').length === 1);
check('a negative feather fires', poisoned((g) => { g.calm.feather = -1; }, 'calm', 'feather').length === 1);
check('a glass with no calm fires', poisoned((g) => { delete g.calm; }, 'calm', 'opacity').length === 1);
check('a recipe with no layers fires', poisoned((g) => { g.smoke.recipes.react.layers = []; }, 'recipe react', 'no layers').length === 1);
check('narrow layers that are empty fire', poisoned((g) => { g.smoke.recipes.hud.narrow = []; }, 'recipe hud', 'no narrow layers').length === 1);
check('a layer with no alpha row fires', poisoned((g) => { delete g.smoke.recipes.react.layers[0].alpha; }, 'recipe react', 'layers 1').length === 1);
check('a layer with one frequency fires', poisoned((g) => { g.smoke.recipes.react.layers[0].frequency = [0.01]; }, 'recipe react', 'layers 1').length === 1);
check('a layer with no seed fires', poisoned((g) => { delete g.smoke.recipes.react.layers[0].seed; }, 'recipe react', 'layers 1').length === 1);
check('a layer with a negative blur fires', poisoned((g) => { g.smoke.recipes.react.layers[0].blur = -1; }, 'recipe react', 'layers 1').length === 1);
check('a layer with zero octaves fires', poisoned((g) => { g.smoke.recipes.react.layers[0].octaves = 0; }, 'recipe react', 'layers 1').length === 1);
check('a layer whose opacity is 0 fires', poisoned((g) => { g.smoke.recipes.react.layers[0].opacity = 0; }, 'recipe react', 'layers 1').length === 1);
check('a narrow layer with a bad shape is named as narrow', poisoned((g) => { delete g.smoke.recipes.hud.narrow[0].seed; }, 'recipe hud', 'narrow layers 1').length === 1);
check('a three-digit layer color fires: Smoke reads six digits only', poisoned((g) => { g.smoke.recipes.react.layers[0].color = '#80f'; }, 'recipe react', 'layers 1', '#rrggbb').length === 1);
check('an rgb() layer color fires', poisoned((g) => { g.smoke.recipes.react.layers[0].color = 'rgb(128,64,255)'; }, 'recipe react', 'layers 1', '#rrggbb').length === 1);
check('an eight-digit layer color fires', poisoned((g) => { g.smoke.recipes.react.layers[0].color = '#8040ff80'; }, 'recipe react', 'layers 1').length === 1);
check('a font with no family fires', poisoned((g) => { delete g.fonts[0].family; }, 'font fonts/Anton-Regular.woff2', 'needs a family').length === 1);
check('a font with no file fires', poisoned((g) => { delete g.fonts[0].file; }, 'font (no file)', 'needs a family').length === 1);
check('a font with no weight fires', poisoned((g) => { delete g.fonts[0].weight; }, 'font fonts/Anton-Regular.woff2', 'needs a family').length === 1);
check('a font with a style that is neither normal nor italic fires', poisoned((g) => { g.fonts[0].style = 'oblique'; }, 'font fonts/Anton-Regular.woff2', 'needs a family').length === 1);
check('a font with an ink ratio above 1 fires', poisoned((g) => { g.fonts[0].ink = 1.2; }, 'font fonts/Anton-Regular.woff2', 'ink ratio').length === 1);
check('a size of 0px fires', poisoned((g) => { g.sizes.body.px = 0; }, 'size body', 'not a size').length === 1);
check('a token whose value is not a color fires', poisoned((g) => { g.keys.standard['--kb-glass-text'].value = 'white'; }, '--kb-glass-text', 'not a color').length > 0);
check('a class with no fill fires', poisoned((g) => { delete g.classes.face.fill; }, 'class face', 'needs a fill').length === 1);

/* The per-recipe calm: its own, else the theme's. */
{
  const thinner = fresh();
  thinner.smoke.recipes.page.calm = 0.3;
  const f = named(glassFaults(thinner), 'recipe page');
  check('a recipe\'s own thinner calm is the one it is read at', f.length > 0 && f.every((x) => x.why.includes('calmed')), text(f));
  const thicker = fresh();
  thicker.smoke.recipes.page.calm = 0.99;
  check('a recipe\'s own thicker calm lowers its calmed worst below the theme\'s', recipeWorsts(thicker).page.calmed.luminance < recipeWorsts(real).page.calmed.luminance);
  check('and leaves the other recipes at the theme\'s calm', recipeWorsts(thicker).hud.calmed.luminance === recipeWorsts(real).hud.calmed.luminance);
  check('the calm a recipe is read at is the one the screen draws on its surface (calmOf, engine/ui/glass/calm.test.tsx)', calmOf(thicker, thicker.smoke.recipes.page) === 0.99 && calmOf(real, real.smoke.recipes.page) === real.calm.opacity);
}
/*
 * A recipe's own calm is drawn on its surface as the calm's opacity, so it is held to what the
 * theme's is: one above 1 would read its calmed worst as the bare ground (every body token passes
 * over any smoke) while the screen draws a backing no thicker than a full one; 0 or less, or a
 * calm that is not a number, has no backing the screen can draw.
 */
check('a recipe calm above 1 fires, though it would read every calmed pixel as the ground', poisoned((g) => { g.smoke.recipes.react.calm = 1.5; }, 'recipe react', 'own calm').length === 1);
check('a recipe calm of 0 fires', poisoned((g) => { g.smoke.recipes.react.calm = 0; }, 'recipe react', 'own calm').length === 1);
check('a negative recipe calm fires', poisoned((g) => { g.smoke.recipes.react.calm = -0.2; }, 'recipe react', 'own calm').length === 1);
check('a recipe calm that is not a number fires', poisoned((g) => { g.smoke.recipes.react.calm = '0.9'; }, 'recipe react', 'own calm').length === 1);

/* The narrow layers' calmed worst, in the ceilings and in the class check. */
{
  const hud = glassCeilings(real).surfaces.hud;
  const w = recipeWorsts(real).hud.narrow;
  check('the ceilings carry the narrow layers\' worst and calmed worst', near(hud.narrowWorst, w.full.luminance, 0.0001) && near(hud.narrowCalmedWorst, w.calmed.luminance, 0.0001) && hud.narrowCalmedWorst < hud.narrowWorst, JSON.stringify(hud));
  check('a surface whose recipe has no narrow layers carries none', glassCeilings(real).surfaces.react.narrowWorst === undefined && glassCeilings(real).surfaces.react.narrowCalmedWorst === undefined);
  const g = fresh();
  g.smoke.recipes.hud.calm = 0.001;
  for (const l of g.smoke.recipes.hud.layers) l.color = '#000000';
  g.smoke.recipes.hud.narrow[0].color = '#ffffff';
  g.smoke.recipes.hud.narrow[0].opacity = 1;
  const f = named(glassFaults(g), 'class ', '(narrow)');
  check('a class\'s large text on only the narrow layers\' calmed worst fires, naming them', f.length === 4 && f.every((x) => x.why.includes('recipe hud (narrow)')), text(glassFaults(g)).slice(0, 500));
}

/* The thresholds, each pinned from both sides. */
{
  const bgs = calmedBackgrounds();
  const passing = grayFor(bgs, 3.4);
  const failing = grayFor(bgs, 2.7);
  const token = (value) => ({ value, tags: ['waiting'] });
  const add = (g, v) => { g.keys.standard['--kb-glass-wait'] = token(hexOf(v)); g.keys.high['--kb-glass-wait'] = token('#ffffff'); };
  const gpass = fresh();
  add(gpass, passing);
  check(`a waiting token at ${minRatio(grayAt(passing), bgs).toFixed(2)}:1 passes: waiting asks 3:1, not 4.5`, named(glassFaults(gpass), '--kb-glass-wait').length === 0, text(named(glassFaults(gpass), '--kb-glass-wait')));
  const gfail = fresh();
  add(gfail, failing);
  check(`a waiting token at ${minRatio(grayAt(failing), bgs).toFixed(2)}:1 fires: it is under 3:1`, named(glassFaults(gfail), '--kb-glass-wait', 'waiting', 'needs 3:1').length > 0);

  /* A high-key ink between 4.5 and 7 on its fill fires: the high key asks 7:1 of an ink. */
  const fill = [0x19, 0xe3, 0xff];
  let ink = 0;
  for (let v = 0; v < 256; v++) if (Math.abs(contrastRatio(grayAt(v), fill) - 5.5) < Math.abs(contrastRatio(grayAt(ink), fill) - 5.5)) ink = v;
  const g = fresh();
  g.keys.high['--kb-glass-ink-neon'].value = hexOf(ink);
  const f = named(glassFaults(g), '--kb-glass-ink-neon', 'high key', 'needs 7:1');
  check(`a high-key ink at ${contrastRatio(grayAt(ink), fill).toFixed(2)}:1 on cyan fires: the high key asks 7:1`, f.length > 0 && contrastRatio(grayAt(ink), fill) >= 4.5, text(glassFaults(g)).slice(0, 300));
  const s = fresh();
  s.keys.standard['--kb-glass-ink-neon'].value = hexOf(ink);
  check('the same ink in the standard key passes: it asks 4.5:1', named(glassFaults(s), '--kb-glass-ink-neon').length === 0);
}

/* ---- main(): the script itself, run against a scratch tree ---- */
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repo = path.resolve(here, '..');
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
  /** A scratch repository with the guard, the engine's types, and the given glass (null for none), staged. */
  const scratch = ({ glass, types = true, ceilings = null }) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-contrast-'));
    git(dir, 'init', '-q');
    fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
    fs.copyFileSync(path.join(here, 'check-glass-contrast.mjs'), path.join(dir, 'tools', 'check-glass-contrast.mjs'));
    fs.symlinkSync(path.join(repo, 'node_modules'), path.join(dir, 'node_modules'));
    fs.mkdirSync(path.join(dir, 'engine', 'ui'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'engine', 'ui', 'types.ts'), types ? fs.readFileSync(path.join(repo, 'engine', 'ui', 'types.ts'), 'utf8') : 'export type Nothing = never;\n');
    if (glass) {
      fs.mkdirSync(path.join(dir, 'instances', 'x', 'ui'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'instances', 'x', 'ui', 'glass.json'), JSON.stringify(glass));
    }
    if (ceilings !== null) {
      fs.mkdirSync(path.join(dir, 'e2e'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'e2e', 'glass-ceilings.json'), ceilings);
    }
    git(dir, 'add', '-A', '-f');
    return dir;
  };
  const run = (dir, ...args) => spawnSync('node', [path.join(dir, 'tools', 'check-glass-contrast.mjs'), ...args], { cwd: dir, encoding: 'utf8' });
  const dirs = [];
  const make = (o) => { const d = scratch(o); dirs.push(d); return d; };

  const none = run(make({ glass: null }));
  check('reading no glass.json refuses rather than passing', none.status === 1 && /refusing to report a pass on nothing/.test(none.stderr), none.stderr);
  const blind = run(make({ glass: real, types: false }));
  check('reading no engine surfaces refuses too', blind.status === 1 && /refusing to report a pass on nothing/.test(blind.stderr), blind.stderr);

  const missing = run(make({ glass: real }));
  check('a missing ceilings file exits 1, naming --write', missing.status === 1 && /does not exist/.test(missing.stderr) && /--write/.test(missing.stderr), missing.stderr);

  const dir = make({ glass: real });
  const wrote = run(dir, '--write');
  check('--write writes the ceilings file and exits 0', wrote.status === 0 && fs.existsSync(path.join(dir, 'e2e', 'glass-ceilings.json')), wrote.stderr + wrote.stdout);
  const written = fs.readFileSync(path.join(dir, 'e2e', 'glass-ceilings.json'), 'utf8');
  check('the scratch tree writes what the real tree\'s guard computes for the same glass', written === ceilingsFile({ x: glassCeilings(real) }));
  const current = run(dir);
  check('a current ceilings file passes', current.status === 0 && /is current/.test(current.stdout), current.stderr + current.stdout);

  const moved = fresh();
  moved.smoke.recipes.hud.layers[0].opacity = 0.9;
  fs.writeFileSync(path.join(dir, 'instances', 'x', 'ui', 'glass.json'), JSON.stringify(moved));
  git(dir, 'add', '-A', '-f');
  const stale = run(dir);
  check('a glass changed after the ceilings were written exits 1 as stale', stale.status === 1 && /no longer matches the glass/.test(stale.stderr), stale.stderr + stale.stdout);

  const bad = fresh();
  bad.calm.opacity = 0.3;
  const faulty = run(make({ glass: bad }));
  check('a glass that fails its contrast exits 1 and names the instance and the token', faulty.status === 1 && /x: recipe page: --kb-glass-text-2/.test(faulty.stderr), faulty.stderr.slice(0, 400));
  const nowrite = run(make({ glass: bad }), '--write');
  check('--write does not write over a glass that fails', nowrite.status === 1, nowrite.stderr.slice(0, 200));

  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
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

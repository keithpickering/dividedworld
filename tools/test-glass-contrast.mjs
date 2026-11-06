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
import { CLASS_LARGE, OVERLAYS, OVERLAY_READINGS, OVERLAY_RULES, SURFACES, calmOf, ceilingsFile, ceilingsStale, classLargeFaults, contrastRatio, glassCeilings, glassFaults, luminance, overlayCeilings, overlayRuleFaults, overlayWorst, readClassLarge, readScrim, recipeWorsts, treeGlass } from './check-glass-contrast.mjs';

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
  const plan = { hud: 0.216, page: 0.230, characters: 0.196, turn: 0.116, effect: 0.103, react: 0.087, cards: 0.193, vending: 0.230, settlement: 0.245 };
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
  loud.smoke.recipes.page.colors[1].opacity = 1.0;
  check('with the cyan at 1.0, white is 1.69:1 on the page recipe', near(ratio('#ffffff', recipeWorsts(loud).page.full.rgb), 1.69, 0.006), String(ratio('#ffffff', recipeWorsts(loud).page.full.rgb)));
  /* The recipe's cyan layer is 0.30 (the glass polish): the settlement's title stands on the bare smoke, so #f1ecff holds 3:1 on it. The board's 0.40 read 2.81. */
  check('#f1ecff on the settlement recipe\'s full worst holds 3:1 (3.08; the board\'s 0.40 cyan read 2.81)', ratio('#f1ecff', worsts.settlement.full.rgb) >= 3 && near(ratio('#f1ecff', worsts.settlement.full.rgb), 3.08, 0.01), String(ratio('#f1ecff', worsts.settlement.full.rgb)));
  check('white is 3.55:1 on the settlement recipe\'s full worst', near(ratio('#ffffff', worsts.settlement.full.rgb), 3.55, 0.006), String(ratio('#ffffff', worsts.settlement.full.rgb)));
  check('luminance and ratio are WCAG\'s: white on black is 21:1', near(ratio('#ffffff', '#000000'), 21, 0.0001) && near(luminance('#ffffff'), 1, 0.0001));
}

/*
 * The field's worst pixels, pinned (the glass polish design, section 6). The field's layers are
 * composited in each recipe's colors and opacities by the model the recipes' own layers had, with
 * opacity 0 for a layer a recipe did not draw, so every recipe's worst is the one the recipe had before
 * the field: these are the numbers from before it. A recipe with no narrowColors reads the first
 * colors on the field's narrow layers; where that is the same pixel as its wide layers it reports no phone worst.
 */
{
  const worsts = recipeWorsts(real);
  const pinned = {
    page: [0.2310, 0.0126, null, null], characters: [0.1960, 0.0110, null, null], turn: [0.1167, 0.0079, null, null],
    effect: [0.1032, 0.0094, null, null], react: [0.0875, 0.0053, null, null], cards: [0.1933, 0.0141, 0.2108, 0.0127],
    vending: [0.2297, 0.0145, null, null], settlement: [0.2454, 0.0149, null, null], hud: [0.2161, 0.0196, 0.2492, 0.0136],
  };
  for (const [recipe, [full, calmed, nFull, nCalmed]] of Object.entries(pinned)) {
    const w = worsts[recipe];
    check(`the ${recipe} recipe's worst, calmed worst and phone worsts are ${full}, ${calmed}, ${nFull}, ${nCalmed}`,
      near(w?.full.luminance, full, 0.00006) && near(w?.calmed.luminance, calmed, 0.00006)
        && (nFull === null ? w?.narrow === undefined : near(w?.narrow?.full.luminance, nFull, 0.00006) && near(w?.narrow?.calmed.luminance, nCalmed, 0.00006)),
      JSON.stringify(w && [w.full.luminance, w.calmed.luminance, w.narrow?.full.luminance, w.narrow?.calmed.luminance]));
  }
  check('a layer a recipe leaves at opacity 0 adds nothing: the page recipe\'s worst is the same with its unused colors changed', (() => {
    const g = fresh();
    g.smoke.recipes.page.colors[2].color = '#ffffff';
    g.smoke.recipes.page.colors[3].color = '#ffffff';
    return near(recipeWorsts(g).page.full.luminance, worsts.page.full.luminance, 1e-9);
  })());
  check('a layer brought in raises the worst: the page recipe with its third layer at 0.5 white is brighter', (() => {
    const g = fresh();
    g.smoke.recipes.page.colors[2] = { color: '#ffffff', opacity: 0.5 };
    return recipeWorsts(g).page.full.luminance > worsts.page.full.luminance + 0.05;
  })());
  check('the field is four layers and three narrow, each drifting at its own rate', real.smoke.field?.layers.length === 4 && real.smoke.field?.narrow?.length === 3 && new Set(real.smoke.field.layers.map((l) => l.drift.seconds)).size === 4, JSON.stringify(real.smoke.field?.layers.map((l) => l.drift)));
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
  g.smoke.recipes.page.colors[1].opacity = 1.0;
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
  /* The settlement's title is bare on the smoke, so the recipe must stay dim enough: the board's brighter cyan layer fails it. */
  g.smoke.recipes.settlement.colors.find((l) => l.color === '#14d9ff').opacity = 0.4;
  const r = named(glassFaults(g), 'recipe settlement', '#f1ecff', 'large');
  check('the settlement recipe with the board\'s 0.40 cyan layer: #f1ecff large falls under 3:1', r.length > 0 && r.some((f) => /2\.8/.test(f.why)), text(glassFaults(g)).slice(0, 600));
}
{
  const g = fresh();
  g.smoke.recipes.hud.narrowColors[1].opacity = 1.0;
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
  const r = named(glassFaults(g), 'class face', 'large', 'surface turn', 'recipe turn', '#2a4a66', 'needs 3:1');
  check('a class color whose large text is under 3:1 on a surface that draws it fires, naming the class, the surface, the recipe, the color and the ratio', r.length > 0, text(glassFaults(g)).slice(0, 600));
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
check('a recipe with no colors fires', poisoned((g) => { g.smoke.recipes.react.colors = []; }, 'recipe react', 'colors').length === 1);
check('a recipe with one color too few fires, naming the field\'s count', poisoned((g) => { g.smoke.recipes.page.colors.pop(); }, 'recipe page', 'has 3 colors', 'one per field layer (4)').length === 1);
check('a recipe with one color too many fires', poisoned((g) => { g.smoke.recipes.page.colors.push({ color: '#000000', opacity: 0 }); }, 'recipe page', 'has 5 colors').length === 1);
check('narrow colors that are empty fire', poisoned((g) => { g.smoke.recipes.hud.narrowColors = []; }, 'recipe hud', 'narrowColors').length === 1);
check('narrow colors one too few fire, naming the narrow field\'s count', poisoned((g) => { g.smoke.recipes.hud.narrowColors.pop(); }, 'recipe hud', 'has 2 narrowColors', 'one per narrow field layer (3)').length === 1);
check('narrow colors on a field with no narrow layers fire', poisoned((g) => { delete g.smoke.field.narrow; }, 'recipe cards', 'narrowColors', 'no narrow layers').length === 1);
check('a field of five layers fires: the cap is 4', poisoned((g) => { g.smoke.field.layers.push(structuredClone(g.smoke.field.layers[0])); for (const r of Object.values(g.smoke.recipes)) r.colors.push({ color: '#000000', opacity: 0 }); }, 'field', 'at most 4').length === 1);
check('a narrow field of four layers fires: the cap is 3', poisoned((g) => { g.smoke.field.narrow.push(structuredClone(g.smoke.field.narrow[0])); for (const r of Object.values(g.smoke.recipes)) r.narrowColors?.push({ color: '#000000', opacity: 0 }); }, 'field', 'at most 3').length === 1);
check('a drift of 0 seconds fires, naming the layer', poisoned((g) => { g.smoke.field.layers[1].drift.seconds = 0; }, 'field', 'layers 2', 'drift', 'seconds and travel').length === 1);
check('a drift of 0 travel fires', poisoned((g) => { g.smoke.field.layers[0].drift.travel = 0; }, 'field', 'layers 1', 'drift').length === 1);
check('a negative drift fires', poisoned((g) => { g.smoke.field.layers[0].drift.seconds = -4; }, 'field', 'layers 1', 'drift').length === 1);
check('a layer with no drift fires', poisoned((g) => { delete g.smoke.field.layers[2].drift; }, 'field', 'layers 3', 'drift').length === 1);
check('a narrow layer with a bad drift is named as narrow', poisoned((g) => { g.smoke.field.narrow[0].drift.seconds = 0; }, 'field', 'narrow layers 1', 'drift').length === 1);
check('a glass with no field fires', poisoned((g) => { delete g.smoke.field; }, 'field', 'no layers').length >= 1);
check('a field with no layers fires', poisoned((g) => { g.smoke.field.layers = []; for (const r of Object.values(g.smoke.recipes)) r.colors = []; }, 'field', 'no layers').length === 1);
check('a narrow field that is empty fires', poisoned((g) => { g.smoke.field.narrow = []; for (const r of Object.values(g.smoke.recipes)) delete r.narrowColors; }, 'field', 'no narrow layers').length === 1);
check('a field layer with no alpha row fires', poisoned((g) => { delete g.smoke.field.layers[0].alpha; }, 'field', 'layers 1').length === 1);
check('a field layer with one frequency fires', poisoned((g) => { g.smoke.field.layers[0].frequency = [0.01]; }, 'field', 'layers 1').length === 1);
check('a field layer with no seed fires', poisoned((g) => { delete g.smoke.field.layers[0].seed; }, 'field', 'layers 1').length === 1);
check('a field layer with a negative blur fires', poisoned((g) => { g.smoke.field.layers[0].blur = -1; }, 'field', 'layers 1').length === 1);
check('a field layer with zero octaves fires', poisoned((g) => { g.smoke.field.layers[0].octaves = 0; }, 'field', 'layers 1').length === 1);
check('a narrow field layer with a bad shape is named as narrow', poisoned((g) => { delete g.smoke.field.narrow[0].seed; }, 'field', 'narrow layers 1').length === 1);
check('a layer color of opacity 0 is fine: it leaves the layer out on that surface', poisoned((g) => { g.smoke.recipes.react.colors[0].opacity = 0; }, 'recipe react').length === 0);
check('a layer color with an opacity above 1 fires', poisoned((g) => { g.smoke.recipes.react.colors[0].opacity = 1.2; }, 'recipe react', 'colors 1').length === 1);
check('a layer color with a negative opacity fires', poisoned((g) => { g.smoke.recipes.react.colors[0].opacity = -0.1; }, 'recipe react', 'colors 1').length === 1);
check('a three-digit layer color fires: Smoke reads six digits only', poisoned((g) => { g.smoke.recipes.react.colors[0].color = '#80f'; }, 'recipe react', 'colors 1', '#rrggbb').length === 1);
check('an rgb() layer color fires', poisoned((g) => { g.smoke.recipes.react.colors[0].color = 'rgb(128,64,255)'; }, 'recipe react', 'colors 1', '#rrggbb').length === 1);
check('an eight-digit layer color fires', poisoned((g) => { g.smoke.recipes.react.colors[0].color = '#8040ff80'; }, 'recipe react', 'colors 1').length === 1);
check('a narrow layer color with a bad shape is named as narrow', poisoned((g) => { g.smoke.recipes.hud.narrowColors[0].color = 'red'; }, 'recipe hud', 'narrowColors 1').length === 1);
/* A null where an object belongs is a named fault, never a crash further down. */
const crashes = (poison) => { try { poison(); return false; } catch { return true; } };
check('a null field layer fires, naming the layer, and does not crash', !crashes(() => poisoned((g) => { g.smoke.field.layers[1] = null; })) && poisoned((g) => { g.smoke.field.layers[1] = null; }, 'field', 'layers 2', 'not an object').length === 1);
check('a null narrow field layer fires, naming the layer', !crashes(() => poisoned((g) => { g.smoke.field.narrow[0] = null; })) && poisoned((g) => { g.smoke.field.narrow[0] = null; }, 'field', 'narrow layers 1', 'not an object').length === 1);
check('a null recipe color fires, naming the recipe and the color', !crashes(() => poisoned((g) => { g.smoke.recipes.react.colors[1] = null; })) && poisoned((g) => { g.smoke.recipes.react.colors[1] = null; }, 'recipe react', 'colors 2', 'not an object').length === 1);
check('a null narrow color fires, naming the recipe and the color', !crashes(() => poisoned((g) => { g.smoke.recipes.hud.narrowColors[2] = null; })) && poisoned((g) => { g.smoke.recipes.hud.narrowColors[2] = null; }, 'recipe hud', 'narrowColors 3', 'not an object').length === 1);
check('a null recipe fires, naming the recipe', !crashes(() => poisoned((g) => { g.smoke.recipes.cards = null; })) && poisoned((g) => { g.smoke.recipes.cards = null; }, 'recipe cards', 'not an object').length === 1);
check('a null recipe does not crash the ceilings or the worsts', !crashes(() => { const g = fresh(); g.smoke.recipes.cards = null; glassCeilings(g); recipeWorsts(g); }));
check('field layers that are not an array fire, and do not crash', !crashes(() => poisoned((g) => { g.smoke.field.layers = { 0: {} }; })) && poisoned((g) => { g.smoke.field.layers = { 0: {} }; }, 'field', 'no layers').length === 1);
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

/** A class large text list that draws it on `surface` alone, as `draw`. */
const only = (surface, draw) => Object.fromEntries(SURFACES.map((s) => [s, s === surface ? draw : 'none']));

/* The narrow layers' calmed worst, in the ceilings and in the class check. */
{
  const hud = glassCeilings(real).surfaces.hud;
  const w = recipeWorsts(real).hud.narrow;
  check('the ceilings carry the narrow layers\' worst and calmed worst', near(hud.narrowWorst, w.full.luminance, 0.0001) && near(hud.narrowCalmedWorst, w.calmed.luminance, 0.0001) && hud.narrowCalmedWorst < hud.narrowWorst, JSON.stringify(hud));
  check('a surface whose recipe has no narrow layers carries none', glassCeilings(real).surfaces.react.narrowWorst === undefined && glassCeilings(real).surfaces.react.narrowCalmedWorst === undefined);
  /* The hud draws no class large text in the engine's list, so each of these reads it under a list that says it does. */
  const g = fresh();
  g.smoke.recipes.hud.calm = 0.001;
  for (const l of g.smoke.recipes.hud.colors) l.color = '#000000';
  g.smoke.recipes.hud.narrowColors[0].color = '#ffffff';
  g.smoke.recipes.hud.narrowColors[0].opacity = 1;
  const f = named(glassFaults(g, only('hud', 'calmed')), 'class ', 'surface hud');
  check('a class\'s large text on only the narrow layers\' calmed worst fires on a calmed surface, naming them', f.length === Object.keys(g.classes).length && f.every((x) => x.why.includes('narrow calmed worst') && x.why.includes('recipe hud')), text(f).slice(0, 500));
  const n = fresh();
  for (const l of n.smoke.recipes.hud.colors) l.color = '#000000';
  const nf = named(glassFaults(n, only('hud', 'full')), 'class ', 'surface hud');
  check('a class\'s large text on only the narrow layers\' full worst fires on a full surface, naming them', nf.length === Object.keys(n.classes).length && nf.every((x) => x.why.includes('narrow full worst')), text(nf).slice(0, 500));
}

/*
 * Class large text, per screen (the glass plan, section 6, amended 2026-10-30: the owner's answer
 * "Per screen + 9% lift"). The engine says, for every surface, whether a class's large text is
 * drawn there on the full smoke, in a calm, or not at all (classLargeText, engine/ui/glass/apply.ts);
 * the guard reads each class against that and writes a class ceiling only where it is drawn.
 */
{
  const list = CLASS_LARGE?.entries ?? {};
  /* A list's names are its own, never an object's inherited ones. */
  const inherited = readClassLarge("export const classLargeText = { toString: 'none' };");
  check('a name an object inherits is read as the list\'s own name once, not as named twice', inherited?.unreadable.length === 0, JSON.stringify(inherited));
  check('a surface an object inherits a name for is still left out when the list does not name it',
    classLargeFaults({ entries: {}, unreadable: [] }, ['constructor']).some((x) => x.why.startsWith('leaves out')));
  check('the engine\'s class large list is read from engine/ui/glass/apply.ts: every surface, each full, calmed or none',
    CLASS_LARGE !== null && SURFACES.every((s) => ['full', 'calmed', 'none'].includes(list[s])) && Object.keys(list).length === SURFACES.length && CLASS_LARGE.unreadable.length === 0,
    JSON.stringify(CLASS_LARGE));
  check('the engine\'s own list is clean', classLargeFaults(CLASS_LARGE).length === 0, text(classLargeFaults(CLASS_LARGE)));
  /* The boards' reading, the amendment's: turn and react on the full smoke, settlement in a calm, and none drawn anywhere else. */
  const boards = { turn: 'full', react: 'full', settlement: 'calmed' };
  check('the engine\'s list is the boards\': turn and react on the full smoke, the settlement in a calm, none elsewhere',
    SURFACES.every((s) => CLASS_LARGE?.entries[s] === (boards[s] ?? 'none')), JSON.stringify(CLASS_LARGE?.entries));

  /* Heel's large text back at #ff8a96: 2.80:1 on the turn recipe's full worst. */
  const heel = fresh();
  heel.classes.heel.large = '#ff8a96';
  const hf = named(glassFaults(heel), 'class heel', 'surface turn', 'recipe turn', '#ff8a96', 'full worst', '2.80', 'needs 3:1');
  check('Heel\'s large text back at #ff8a96 fires on turn, read against the full smoke, at 2.80:1', hf.length === 1, text(glassFaults(heel)).slice(0, 600));
  check('and only on the surfaces that draw it on the full smoke', named(glassFaults(heel), 'class heel').every((f) => list[f.why.match(/surface (\w+)/)?.[1]] === 'full'), text(glassFaults(heel)));
  check('Heel\'s large text at #ff959f meets 3:1 on the turn recipe\'s full worst', contrastRatio('#ff959f', recipeWorsts(real).turn.full.rgb) >= 3 && contrastRatio('#ff8a96', recipeWorsts(real).turn.full.rgb) < 3);

  /* The list: every surface, no other, each a draw the guard knows. */
  const { turn: _turn, ...withoutTurn } = /** @type {Record<string, string>} */ (list);
  const missing = { entries: withoutTurn, unreadable: [] };
  check('a list that leaves out a surface is refused, naming it', classLargeFaults(missing).some((f) => f.where.includes('turn') && /leaves out/.test(f.why)), text(classLargeFaults(missing)));
  const unknown = { entries: { ...list, lobby: 'full' }, unreadable: [] };
  check('a list that names a surface the engine does not list is refused', classLargeFaults(unknown).some((f) => f.where.includes('lobby') && /not one the engine lists/.test(f.why)), text(classLargeFaults(unknown)));
  const odd = { entries: { ...list, turn: 'sometimes' }, unreadable: [] };
  check('a list that gives a surface a draw other than full, calmed or none is refused', classLargeFaults(odd).some((f) => f.where.includes('turn') && f.why.includes('sometimes')), text(classLargeFaults(odd)));
  check('no list at all is refused', classLargeFaults(null).length === 1, text(classLargeFaults(null)));

  /* The reader: the const from the source, through `as const` and `satisfies`, and nothing it cannot read. */
  const src = (body) => `import type { GlassSurface } from '../types.ts';\nexport const classLargeText = ${body};\n`;
  const read = readClassLarge(src(`{ turn: 'full', 'react': 'full', settlement: 'calmed' } as const satisfies Partial<Record<GlassSurface, string>>`));
  check('the reader reads a list through as const and satisfies, and quoted names', JSON.stringify(read?.entries) === '{"turn":"full","react":"full","settlement":"calmed"}', JSON.stringify(read));
  check('a source without the list reads as none', readClassLarge('export const somethingElse = {};\n') === null);
  const spread = readClassLarge(src(`{ ...other, turn: 'full' }`));
  check('a spread in the list is unreadable, and refused', spread?.unreadable.length === 1 && classLargeFaults(spread).some((f) => /cannot read/.test(f.why)), JSON.stringify(spread));
  const computed = readClassLarge(src(`{ turn: draw }`));
  check('a value that is not a string literal is unreadable, and refused', computed?.unreadable.length === 1 && classLargeFaults(computed).some((f) => /cannot read/.test(f.why)), JSON.stringify(computed));

  /* A calmed surface is read against the calmed worst, a full one against the full worst. #ff959f on the page recipe: 1.79:1 full, 8.03:1 calmed. */
  const g = fresh();
  check('a color that passes calmed but fails full: #ff959f on the page recipe', contrastRatio('#ff959f', recipeWorsts(real).page.full.rgb) < 3 && contrastRatio('#ff959f', recipeWorsts(real).page.calmed.rgb) >= 3);
  check('it passes on a calmed surface that uses the recipe', named(glassFaults(g, only('log', 'calmed')), 'class heel').length === 0, text(named(glassFaults(g, only('log', 'calmed')), 'class heel')));
  const onFull = named(glassFaults(g, only('log', 'full')), 'class heel', 'surface log', 'recipe page', 'full worst');
  check('and fails on a full surface that uses it', onFull.length === 1 && onFull[0].why.includes('1.79'), text(glassFaults(g, only('log', 'full'))));
  check('a none surface reads nothing, on a recipe whose full worst its class colors fail', glassFaults(g, only('log', 'none')).length === 0);
  const all = fresh();
  all.smoke.recipes.settlement.calmAll = true;
  check('a full surface on a calmAll recipe is read calmed, as a large token is', named(glassFaults(all, only('settlement', 'full')), 'class ').length === 0, text(glassFaults(all, only('settlement', 'full'))));
  check('and without calmAll the same full surface fails its class colors', named(glassFaults(g, only('settlement', 'full')), 'class ').length > 0);

  /* The ceilings: a class ceiling per class where the list draws it, none where it does not. */
  const c = glassCeilings(real);
  const ceilingOf = (hex) => (luminance(hex) + 0.05) / 3 - 0.05;
  check('a surface that draws class large text carries each class\'s ceiling, at 3:1', near(c.surfaces.turn?.classes?.heel?.large, ceilingOf('#ff959f'), 0.0001) && Object.keys(c.surfaces.turn?.classes ?? {}).join() === Object.keys(real.classes).join(), JSON.stringify(c.surfaces.turn?.classes));
  check('and says how it is drawn there', c.surfaces.turn?.classLarge === 'full' && c.surfaces.settlement?.classLarge === 'calmed', JSON.stringify([c.surfaces.turn?.classLarge, c.surfaces.settlement?.classLarge]));
  const none = SURFACES.filter((s) => list[s] === 'none');
  check('a none surface carries no class ceiling, so Part 2\'s measurement has none to pass class large text on', none.length > 0 && none.every((s) => c.surfaces[s].classes === undefined && c.surfaces[s].classLarge === undefined), JSON.stringify(none.map((s) => [s, c.surfaces[s].classes])));
  const off = glassCeilings(real, only('log', 'none'));
  check('a surface the list turns to none loses its class ceiling', off.surfaces.turn.classes === undefined && off.surfaces.turn.tokens !== undefined, JSON.stringify(off.surfaces.turn));
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


/*
 * Overlay sheets (the onboarding follow-ups design, section 3): the spotlight's panel stands on none of the smoke surfaces. It is
 * `--kb-glass-ground` over a base (the panel's own `--kb-glass-violet` background, which the ground's ::after is laid on) and, outside the
 * panel, a scrim of the ground at N% over whatever page is behind, which can be white. The worst pixel under the text is the ground
 * over the brighter of the two bases; the panel's border (violet) is read against the scrim over white. Colors are rounded to bytes at
 * each composite, as the browser draws them.
 */
{
  const tipsCss = fs.readFileSync(new URL('../engine/ui/tips/tips.css', import.meta.url), 'utf8');
  const reading = OVERLAY_READINGS.tips;
  const at = (percent, base = reading?.base) => ({ tips: { percent, base } });
  const faultsOf = (glass, scrims = at(reading?.percent)) => glassFaults(glass, undefined, scrims);

  check('the engine lists the tips overlay, and the guard has a rule for it', JSON.stringify(OVERLAYS) === '["tips"]' && OVERLAY_RULES.tips !== undefined, JSON.stringify(OVERLAYS));
  check('the scrim is read from tips.css as 72, and the panel\'s base as --kb-glass-violet', reading?.percent === 72 && reading?.base === '--kb-glass-violet', JSON.stringify(reading));
  check('readScrim reads the .kb-tips-dim rule\'s color-mix percentage', readScrim(tipsCss, '.kb-tips-dim') === 72);
  check('readScrim finds no rule when the class is renamed', readScrim(tipsCss.replace('.kb-tips-dim {', '.kb-tips-veil {'), '.kb-tips-dim') === null);
  check('readScrim finds none when the rule no longer mixes the ground', readScrim(tipsCss.replace('var(--kb-glass-ground) 72%', 'black 72%'), '.kb-tips-dim') === null);

  /* Divided World's numbers, with their arithmetic. Standard key: ground #07050d = (7, 5, 13), violet #a78bfa = (167, 139, 250). */
  const w = overlayWorst(real, 'standard', 72, '--kb-glass-violet');
  /* The scrim over white: 255 * 0.28 + ground * 0.72 = (76.44, 75.0, 80.76) -> (76, 75, 81), the border's ground. */
  check('the scrim over white is rgb(76,75,81)', JSON.stringify(w?.scrim) === '[76,75,81]', JSON.stringify(w?.scrim));
  /* The tip stands on the glass's opaque ground #07050d, laid inside its violet edge: the worst pixel is the ground itself, rgb(7,5,13), whatever is under it. */
  check('the ground is the worst pixel, rgb(7,5,13)', JSON.stringify(w?.rgb) === '[7,5,13]', JSON.stringify(w?.rgb));
  check('the worst luminance is 0.0018', near(w?.luminance, 0.0018, 0.00005), String(w?.luminance));
  const high = overlayWorst(real, 'high', 72, '--kb-glass-violet');
  check('under the high key the ground is the same #07050d, so the worst is rgb(7,5,13)', JSON.stringify(high?.rgb) === '[7,5,13]', JSON.stringify(high?.rgb));
  const ratios = Object.fromEntries(['--kb-glass-text', '--kb-glass-text-hi', '--kb-glass-text-2', '--kb-glass-pale'].map((t) => [t, [contrastRatio(real.keys.standard[t].value, w.rgb), contrastRatio(real.keys.high[t].value, high.rgb)]]));
  /*
   * PINNED: contrast on the worst, standard / high, to two places, as (L_fg + 0.05) / (L_bg + 0.05) with the luminances to four places.
   * Standard, L_bg 0.0018 (rgb(7,5,13), the opaque ground): text #f1ecff 0.9091 / 0.0518 = 17.54; text-hi #ffffff 1.05 / 0.0518 = 20.26;
   * text-2 #e4def7 0.8045 / 0.0518 = 15.52; pale #c9f8ff 0.9177 / 0.0518 = 17.71.
   * High, the same ground: text #ffffff 20.26; text-hi 20.26; text-2 #f1ecff 17.54; pale 17.71.
   */
  const pin = { '--kb-glass-text': [17.54, 20.26], '--kb-glass-text-hi': [20.26, 20.26], '--kb-glass-text-2': [15.52, 17.54], '--kb-glass-pale': [17.71, 17.71] };
  for (const [t, [s2, h2]] of Object.entries(pin)) check(`${t} on the worst is ${s2}:1 standard and ${h2}:1 high`, near(ratios[t][0], s2, 0.006) && near(ratios[t][1], h2, 0.006), JSON.stringify(ratios[t]));
  /* The border: violet #a78bfa (luminance 0.3319) against the scrim over white rgb(76,75,81), luminance 0.0716: 0.3819 / 0.1216 = 3.17 (the pin is the computed ratio). */
  check('the border violet on the scrim over white is 3.17:1, over its 3:1', near(contrastRatio(real.keys.standard['--kb-glass-violet'].value, w.scrim), 3.17, 0.006), String(contrastRatio(real.keys.standard['--kb-glass-violet'].value, w.scrim)));
  const dimViolet = fresh();
  dimViolet.keys.standard['--kb-glass-violet'].value = '#6d5aa8';
  check('a violet border below 3:1 on the scrim is named', named(faultsOf(dimViolet), 'overlay tips', 'border').length >= 1, text(faultsOf(dimViolet)));
  check('the real glass passes the overlay rules', named(faultsOf(real), 'overlay').length === 0, text(named(faultsOf(real), 'overlay')));

  /* The poisons, each red before the guard knew overlays. */
  const half = fresh();
  half.keys.standard['--kb-glass-ground'].value = 'rgba(7, 5, 13, 0.3)';
  const halfFaults = named(faultsOf(half), 'overlay tips', '--kb-glass-text-2');
  check('a ground at alpha 0.3 fails --kb-glass-text-2 on the worst', halfFaults.length === 1 && /standard key/.test(halfFaults[0].why) && /needs 4\.5:1/.test(halfFaults[0].why), text(halfFaults));
  check('the 0.3 ground would pass over the scrim alone: it is the violet base under it that makes it the worst', overlayWorst(half, 'standard', 72, null).luminance < 0.05 && overlayWorst(half, 'standard', 72, '--kb-glass-violet').luminance > 0.12, '');
  const thin = faultsOf(real, at(30));
  check('a scrim read as 30% fails the panel\'s border at 3:1', named(thin, 'overlay tips', 'border').length >= 1 && /needs 3:1/.test(text(named(thin, 'overlay tips', 'border'))), text(thin));
  const high7 = fresh();
  high7.keys.high['--kb-glass-ground'].value = 'rgba(9, 5, 18, 0.5)';
  check('under the high key a ground that is not opaque fails text-2 at 7:1', named(faultsOf(high7), 'overlay tips', 'high key', '--kb-glass-text-2', 'needs 7:1').length === 1, text(faultsOf(high7)));
  const noGround = fresh();
  delete noGround.keys.high['--kb-glass-ground'];
  check('a ground token missing from a key is an error', named(faultsOf(noGround), 'overlay tips', '--kb-glass-ground', 'high key').length >= 1, text(faultsOf(noGround)));
  const noGround2 = fresh();
  noGround2.keys.standard['--kb-glass-ground'].value = 'ground';
  check('a ground token that is not a color is an error', named(faultsOf(noGround2), 'overlay tips', '--kb-glass-ground', 'standard key').length >= 1, text(faultsOf(noGround2)));

  check('a GlassOverlay with no rule in the guard is refused', overlayRuleFaults(['tips', 'toast'], OVERLAY_RULES).some((f) => /toast/.test(f.where) && /no rule/.test(f.why)), text(overlayRuleFaults(['tips', 'toast'], OVERLAY_RULES)));
  check('a rule for an overlay the engine does not list is refused', overlayRuleFaults([], OVERLAY_RULES).some((f) => /tips/.test(f.where) && /does not list/.test(f.why)), text(overlayRuleFaults([], OVERLAY_RULES)));
  check('the real overlays and rules agree', overlayRuleFaults(OVERLAYS, OVERLAY_RULES).length === 0);

  const c = overlayCeilings(real, OVERLAY_READINGS).tips;
  check('the ceilings carry the scrim, the worst luminance and each token\'s ceiling', c?.scrim === 72 && near(c.worst, w.luminance, 0.0001)
    && ['--kb-glass-text', '--kb-glass-text-hi', '--kb-glass-text-2', '--kb-glass-pale'].every((t) => near(c.tokens[t]?.body, (luminance(real.keys.standard[t].value) + 0.05) / 4.5 - 0.05, 0.0001)), JSON.stringify(c));
  check('the ceilings file for an instance has overlays.tips', glassCeilings(real).overlays?.tips?.scrim === 72);
}

/* ---- main(): the script itself, run against a scratch tree ---- */
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repo = path.resolve(here, '..');
  // core.autocrlf off: a scratch repository has no .gitattributes, and Git for Windows would warn of CRLF on every add.
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' });
  // Stage the scratch tree but never node_modules. Git on Linux stages the link as one entry; Git for Windows walks
  // into a junction as a directory, stages every file of node_modules, and its CRLF warnings overrun execFileSync's
  // output buffer.
  const stage = (dir) => git(dir, 'add', '-A', '-f', '--', '.', ':(exclude)node_modules');
  /** A scratch repository with the guard, the engine's types, and the given glass (null for none), staged. */
  const scratch = ({ glass, types = true, ceilings = null, apply = null, typesText = null, tipsCss = null }) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-contrast-'));
    git(dir, 'init', '-q');
    fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
    fs.copyFileSync(path.join(here, 'check-glass-contrast.mjs'), path.join(dir, 'tools', 'check-glass-contrast.mjs'));
    // A junction, not a directory symlink: Windows refuses a directory symlink (EPERM) without admin rights or
    // Developer Mode, and creates a junction for anyone. Node ignores the type everywhere else.
    fs.symlinkSync(path.join(repo, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
    fs.mkdirSync(path.join(dir, 'engine', 'ui'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'engine', 'ui', 'types.ts'), types ? (typesText ?? fs.readFileSync(path.join(repo, 'engine', 'ui', 'types.ts'), 'utf8')) : 'export type Nothing = never;\n');
    fs.mkdirSync(path.join(dir, 'engine', 'ui', 'tips'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'engine', 'ui', 'tips', 'tips.css'), tipsCss ?? fs.readFileSync(path.join(repo, 'engine', 'ui', 'tips', 'tips.css'), 'utf8'));
    fs.mkdirSync(path.join(dir, 'engine', 'ui', 'glass'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'engine', 'ui', 'glass', 'apply.ts'), apply ?? fs.readFileSync(path.join(repo, 'engine', 'ui', 'glass', 'apply.ts'), 'utf8'));
    if (glass) {
      fs.mkdirSync(path.join(dir, 'instances', 'x', 'ui'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'instances', 'x', 'ui', 'glass.json'), JSON.stringify(glass));
    }
    if (ceilings !== null) {
      fs.mkdirSync(path.join(dir, 'e2e'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'e2e', 'glass-ceilings.json'), ceilings);
    }
    stage(dir);
    return dir;
  };
  const run = (dir, ...args) => spawnSync('node', [path.join(dir, 'tools', 'check-glass-contrast.mjs'), ...args], { cwd: dir, encoding: 'utf8' });
  const dirs = [];
  const make = (o) => { const d = scratch(o); dirs.push(d); return d; };

  const none = run(make({ glass: null }));
  check('reading no glass.json refuses rather than passing', none.status === 1 && /refusing to report a pass on nothing/.test(none.stderr), none.stderr);
  const blind = run(make({ glass: real, types: false }));
  check('reading no engine surfaces refuses too', blind.status === 1 && /refusing to report a pass on nothing/.test(blind.stderr), blind.stderr);

  const realApply = fs.readFileSync(path.join(repo, 'engine', 'ui', 'glass', 'apply.ts'), 'utf8');
  const gap = realApply.replace(/^\s*turn: '(full|calmed|none)',.*\r?\n/m, ''); // \r?: `.` stops at the \r of a CRLF checkout
  check('the scratch list without turn differs from the real one', gap !== realApply);
  const short = run(make({ glass: real, apply: gap }));
  check('the script refuses an engine list that leaves out a surface', short.status === 1 && /class large text list/.test(short.stderr) && /turn/.test(short.stderr), short.stderr.slice(0, 400));
  const extra = run(make({ glass: real, apply: realApply.replace(/^(\s*)turn: /m, "$1lobby: 'full',\n$1turn: ") }));
  check('the script refuses an engine list that names an unknown surface', extra.status === 1 && /lobby/.test(extra.stderr), extra.stderr.slice(0, 400));
  const unread = run(make({ glass: real, apply: 'export const nothing = 1;\n' }));
  check('the script refuses when it cannot find the engine\'s list', unread.status === 1 && /class large text list/.test(unread.stderr), unread.stderr.slice(0, 400));


  const realTips = fs.readFileSync(path.join(repo, 'engine', 'ui', 'tips', 'tips.css'), 'utf8');
  const realTypes = fs.readFileSync(path.join(repo, 'engine', 'ui', 'types.ts'), 'utf8');
  const renamed = realTips.replace('.kb-tips-dim {', '.kb-tips-veil {');
  check('the scratch stylesheet with the scrim renamed differs from the real one', renamed !== realTips);
  const veiled = run(make({ glass: real, tipsCss: renamed }));
  check('the script refuses a tips.css whose scrim rule is renamed', veiled.status === 1 && /overlay tips/.test(veiled.stderr) && /\.kb-tips-dim/.test(veiled.stderr), veiled.stderr.slice(0, 400));
  const lighter = run(make({ glass: real, tipsCss: realTips.replace('var(--kb-glass-ground) 72%', 'var(--kb-glass-ground) 30%') }));
  check('the script refuses a scrim lightened to 30% in the stylesheet, naming the border', lighter.status === 1 && /overlay tips/.test(lighter.stderr) && /border/.test(lighter.stderr), lighter.stderr.slice(0, 400));
  const typed = realTypes.replace("export type GlassOverlay = 'tips';", "export type GlassOverlay = 'tips' | 'toast';");
  check('the scratch types with a second overlay differ from the real ones', typed !== realTypes);
  const ruleless = run(make({ glass: real, typesText: typed }));
  check('the script refuses a GlassOverlay it has no rule for', ruleless.status === 1 && /toast/.test(ruleless.stderr) && /no rule/.test(ruleless.stderr), ruleless.stderr.slice(0, 400));

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
  moved.smoke.recipes.hud.colors[0].opacity = 0.9;
  fs.writeFileSync(path.join(dir, 'instances', 'x', 'ui', 'glass.json'), JSON.stringify(moved));
  stage(dir);
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
  check('the settlement surface is not calmAll (its title stands bare), and a recipe set calmAll says so', ceilings.surfaces.settlement?.calmAll === false && ceilings.surfaces.page === undefined && (() => { const g = structuredClone(real); g.smoke.recipes.settlement.calmAll = true; return glassCeilings(g).surfaces.settlement?.calmAll === true; })());
  const file = ceilingsFile({ 'divided-world': ceilings });
  check('the ceilings file is the ceilings as JSON, for each instance', JSON.parse(file)['divided-world'].surfaces.hud.recipe === 'hud');
  check('a file equal to the computed ceilings is not stale', ceilingsStale(file, file) === false);
  const brighter = fresh();
  brighter.smoke.recipes.hud.colors[0].opacity = 0.9;
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

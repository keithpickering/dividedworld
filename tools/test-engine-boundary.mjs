/**
 * Tests for the guard in tools/check-engine-boundary.mjs.
 *
 *   node tools/test-engine-boundary.mjs
 *
 * The guard holds "KayfaBB never knows which instance it runs": nothing under engine/
 * reaches into instances/, and no instance reaches into another. An import that crosses
 * the line changes no test and no screen; the engine simply starts knowing a name it
 * should not. So each way a file can name another (a static import, a re-export, a
 * dynamic import, a require) is planted here and must fire, and each way a file can
 * look like it crosses without crossing must stay clean. The last case runs the guard
 * over the real tree, so a guard that has gone quiet over nothing fails here.
 */
import { boundaryFaults, treeFiles } from './check-engine-boundary.mjs';

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

const ENGINE = 'engine/rules/settle.ts';
const fires = (text, file = ENGINE, extra = {}) => boundaryFaults({ [file]: text, ...extra });

/* ---- the engine importing an instance, every way a file can name another ---- */
{
  const r = fires(`import { instance } from '../../instances/divided-world/index.ts';\n`);
  check('a static import from engine/ into instances/ fires', r.length === 1, JSON.stringify(r));
  check('and it names the file, the line and the target', r[0]?.file === ENGINE && r[0]?.line === 1 && r[0]?.target === 'instances/divided-world/index.ts', JSON.stringify(r));
}
check('a type-only import fires too: the engine may not know an instance\'s types either',
  fires(`import type { Face } from '../../instances/divided-world/classes/face.ts';`).length === 1);
check('a re-export fires', fires(`export { instance } from '../../instances/divided-world/index.ts';`).length === 1);
check('a star re-export fires', fires(`export * from '../../instances/divided-world/index.ts';`).length === 1);
check('a side-effect import fires', fires(`import '../../instances/divided-world/index.ts';`).length === 1);
check('a dynamic import fires', fires(`const m = await import('../../instances/divided-world/index.ts');`).length === 1);
check('a dynamic import in a template literal with no substitution fires',
  fires('const m = await import(`../../instances/divided-world/index.ts`);').length === 1);
check('a require fires', fires(`const m = require('../../instances/divided-world/index.ts');`).length === 1);
check('an import type expression fires', fires(`let x: import('../../instances/divided-world/index.ts').Instance;`).length === 1);
check('a path that leaves engine/ and comes back through instances/ fires',
  fires(`import x from '../../engine/../instances/divided-world/index.ts';`).length === 1);
check('a bare specifier naming instances/ fires (a package.json "imports" alias, a path mapping)',
  fires(`import x from '#instances/divided-world';`).length === 1);
{
  const r = fires(`const name = 'divided-world';\nconst m = await import('../../instances/' + name + '/index.ts');`);
  check('a dynamic import the guard cannot read fires in engine/, since it could name anything', r.length === 1 && /cannot read/.test(r[0]?.why ?? ''), JSON.stringify(r));
}
check('a triple-slash reference fires', fires(`/// <reference path="../../instances/divided-world/index.ts" />\nexport {};`).length === 1);
check('import.meta.resolve fires', fires(`export const u = import.meta.resolve('../../instances/divided-world/index.ts');`).length === 1);
check('an absolute path into instances/ fires', fires(`import x from '/srv/app/instances/divided-world/index.ts';`).length === 1);
check('a file in a subdirectory of engine/ is held to the same line',
  fires(`import x from '../../../instances/divided-world/index.ts';`, 'engine/rules/classes/x.ts').length === 1);
check('a .mjs file in engine/ is held to the same line',
  fires(`import x from '../instances/divided-world/index.ts';`, 'engine/x.mjs').length === 1);

/* ---- one instance importing another ---- */
check('an instance importing another instance fires',
  fires(`import x from '../other-world/index.ts';`, 'instances/divided-world/index.ts').length === 1);
check('an instance importing another through a bare path fires',
  fires(`import x from 'instances/other-world/index.ts';`, 'instances/divided-world/index.ts').length === 1);
check('an instance importing another through an absolute path fires',
  fires(`import x from '/srv/app/instances/other-world/index.ts';`, 'instances/divided-world/index.ts').length === 1);
check('an instance\'s triple-slash reference to another fires',
  fires(`/// <reference path="../other-world/index.ts" />\nexport {};`, 'instances/divided-world/index.ts').length === 1);
check('an instance importing the engine is clean, which is the direction the boundary allows',
  fires(`import type { Instance } from '../../engine/rules/types.ts';`, 'instances/divided-world/index.ts').length === 0);
check('an instance importing its own files is clean',
  fires(`import { face } from './classes/face.ts';`, 'instances/divided-world/index.ts').length === 0);
check('an instance\'s dynamic import of its own file is clean',
  fires(`const m = await import('./classes/face.ts');`, 'instances/divided-world/index.ts').length === 0);

/* ---- what only looks like a crossing ---- */
check('an engine file importing the engine is clean', fires(`import type { Instance } from './types.ts';`).length === 0);
check('an engine file importing node: built-ins is clean', fires(`import assert from 'node:assert/strict';`).length === 0);
check('an import inside a comment is not an import',
  fires(`// import x from '../../instances/divided-world/index.ts';\n/* import('../../instances/x.ts') */\nexport const a = 1;`).length === 0);
check('the word instances in a string is not an import',
  fires(`export const doc = "see ../../instances/divided-world/index.ts";`).length === 0);
check('a file outside engine/ and instances/ is not held to it (the composition root meets both)',
  fires(`import { instance } from '../../instances/divided-world/index.ts';\nimport { settle } from '../../engine/rules/settle.ts';`, 'supabase/functions/settle/index.ts').length === 0);
check('a sibling directory whose name starts with "instances" is not instances/',
  fires(`import x from '../../instances-notes/x.ts';`).length === 0);

/* ---- the real tree ---- */
{
  const files = treeFiles();
  const r = boundaryFaults(files);
  check('the real tree is clean', r.length === 0, JSON.stringify(r));
}

console.log(`\n  engine-boundary: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('  test-engine-boundary: FAILED\n    ' + failures.join('\n    '));
  process.exit(1);
}

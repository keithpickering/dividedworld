/**
 * Guard: every instance theme has a preview the picker can draw.
 *
 *   node tools/check-theme-preview.mjs
 *
 * The picker's miniature reads each theme's tokens through tools/theme-preview.mjs, the same parse check-theme.mjs makes.
 * A theme that does not set one of the tokens the miniature needs (REQUIRED_TOKENS), or whose var() resolves to nothing,
 * would show the engine's default there, a preview that is not the theme. The build also refuses it when the stylesheet is
 * imported as `?preview`; this reads every theme file whether or not the instance imports it yet.
 */
import { pathToFileURL } from 'node:url';
import { previewFaults } from './theme-preview.mjs';
import { treeFiles, THEME_FILE } from './check-theme.mjs';

function main() {
  const files = treeFiles();
  const themes = Object.keys(files).filter((f) => THEME_FILE.test(f));
  if (themes.length === 0) { console.error('  theme-preview: no theme was read; refusing to report a pass on nothing'); process.exit(1); }
  const faults = previewFaults(files);
  if (faults.length) {
    console.error(`  theme-preview: ${faults.length} fault(s):`);
    for (const f of faults) console.error(`    ${f.file}  ${f.why}`);
    process.exit(1);
  }
  console.log(`  theme-preview: ${themes.length} theme file(s), every preview token set and resolved`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

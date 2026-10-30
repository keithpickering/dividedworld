/**
 * The glass's stylesheets are loaded by two composition roots: the app (web/src/main.tsx, which the
 * end-to-end build's story route runs through as well) and Storybook (.storybook/preview.tsx). A
 * sheet one of them loads and the other does not draws a story unlike its page (high contrast's
 * solid ground, contrast.css, was the one missing), so the two lists are held to be one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The engine's and the glass's stylesheets a file imports, by their path under engine/ui/. */
function engineSheets(source: string): string[] {
  return [...source.matchAll(/^import\s+'(?:\.\.\/)+engine\/ui\/([^']+\.css)';/gmu)].map((m) => m[1]!).sort();
}

describe('the stylesheets the app and Storybook load', () => {
  test('reads the imports it is given, and no other line', () => {
    expect(engineSheets("import '../../engine/ui/base.css';\nimport '../engine/ui/glass/calm.css';\n// import '../engine/ui/glass/x.css';\nimport './y.css';")).toEqual(['base.css', 'glass/calm.css']);
  });

  test('are the same engine and glass sheets', () => {
    const app = engineSheets(fs.readFileSync(path.join(root, 'web', 'src', 'main.tsx'), 'utf8'));
    const storybook = engineSheets(fs.readFileSync(path.join(root, '.storybook', 'preview.tsx'), 'utf8'));
    expect(app).toContain('glass/contrast.css');
    expect(storybook).toEqual(app);
  });
});

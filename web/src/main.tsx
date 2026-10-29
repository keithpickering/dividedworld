import { createRoot } from 'react-dom/client';
import '../../engine/ui/base.css';
import { applyAppearance } from '../../engine/ui/appearance.ts';
import { instanceUi } from '../../instances/divided-world/ui/index.ts';
import { App } from './App.tsx';
import { createBackend } from './data/backend.ts';

// The device decides until the account's preferences are read (App's Appearance applies them then).
applyAppearance(document, { theme: 'system', motion: 'system' }, instanceUi.themes);
const root = createRoot(document.getElementById('root')!);
createBackend().then(
  (api) => root.render(<App api={api} />),
  (error: unknown) => {
    // Plain words, not in character: a build that cannot reach a forum says so.
    root.render(
      <main style={{ maxWidth: '36rem', margin: '3rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif', lineHeight: 1.5 }}>
        <h1>This site is not set up</h1>
        <p>{error instanceof Error ? error.message : 'This build names no Supabase project.'}</p>
      </main>,
    );
  },
);

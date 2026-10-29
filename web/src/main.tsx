import { createRoot } from 'react-dom/client';
import '../../engine/ui/base.css';
import { applyAppearance } from '../../engine/ui/appearance.ts';
import { instanceUi } from '../../instances/divided-world/ui/index.ts';
import { App } from './App.tsx';
import { createBackend } from './data/backend.ts';

// The device decides until the account's preferences are read (App's Appearance applies them then).
applyAppearance(document, { theme: 'system', motion: 'system' }, instanceUi.themes);
createRoot(document.getElementById('root')!).render(<App api={createBackend()} />);

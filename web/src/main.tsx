import { createRoot } from 'react-dom/client';
import '../../engine/ui/base.css';
import '../../engine/ui/glass/tokens.css';
import '../../engine/ui/glass/base.css';
import '../../engine/ui/glass/calm.css';
import '../../engine/ui/glass/contrast.css';
import { applyAppearance } from '../../engine/ui/appearance.ts';
import { instanceUi } from '../../instances/divided-world/ui/index.ts';
import { App } from './App.tsx';
import { createBackend } from './data/backend.ts';
import { storyFromAddress } from './data/fixtures/address.ts';
import { StartError } from './StartError.tsx';

// The device decides until the account's preferences are read (App's Appearance applies them then).
applyAppearance(document, { theme: 'system', motion: 'system' }, instanceUi.themes);
const root = createRoot(document.getElementById('root')!);
/* The end-to-end build's story route (web/src/data/fixtures/stories.tsx): the board match's stories, with no app around them. */
const story = import.meta.env.MODE === 'e2e' ? storyFromAddress(globalThis.location.search) : null;
if (story !== null) {
  import('./data/fixtures/stories.tsx')
    .then(({ boardStory }) => { const Story = boardStory(story); root.render(<Story />); })
    .catch((error: unknown) => root.render(<StartError error={error} />));
} else {
  createBackend().then(
    (api) => root.render(<App api={api} />),
    (error: unknown) => root.render(<StartError error={error} />),
  );
}

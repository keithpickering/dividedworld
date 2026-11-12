import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { captions } from '../engine/ui/audio/captions.ts';
import { cleanup, configure } from '@testing-library/react';

/* A find under a loaded parallel run can take longer than the default second. */
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
  /* The page's one caption store outlives a test; whatever a test said or held does not. */
  captions.reset();
});

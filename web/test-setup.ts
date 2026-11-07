import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

/* A find under a loaded parallel run can take longer than the default second. */
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
  /* An overlay or a modal closed at full motion leaves a copy for its exit (engine/ui/glass/lift.ts); a test that ends first must not leave it for the next. */
  if (typeof document !== 'undefined') document.querySelectorAll('[data-kb-exiting]').forEach((el) => el.remove());
});

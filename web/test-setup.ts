import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

/* A find under a loaded parallel run can take longer than the default second. */
configure({ asyncUtilTimeout: 5000 });

/* jsdom does not implement window scrolling and prints "Not implemented" for it. */
window.scrollBy = () => {};
window.scrollTo = () => {};

afterEach(() => {
  cleanup();
});

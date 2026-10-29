import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

/* A find under a loaded parallel run can take longer than the default second. */
configure({ asyncUtilTimeout: 5000 });

afterEach(() => cleanup());

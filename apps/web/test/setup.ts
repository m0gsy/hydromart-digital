import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest doesn't auto-register RTL cleanup (no globals) — do it once here so
// mounted trees don't leak across tests.
afterEach(cleanup);

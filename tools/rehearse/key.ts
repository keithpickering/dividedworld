/**
 * The Anthropic key a rehearsal's live calls send (docs/plans/2026-11-11-system-rehearsal-design.md). The design had the
 * rehearsal hold only a placeholder, with a network proxy adding the real key on its way to the provider. A cloud
 * session's proxy refuses a user credential for Anthropic's own hosts, so the owner chose on 2026-11-11 that a live run
 * may take the key from the process environment instead: `ANTHROPIC_API_KEY`, passed from a variable in the shell that
 * starts the run, never typed on a command line or written to a file. With none set, the placeholder is sent as before,
 * for a proxy that holds the key.
 *
 * A mode that never goes live (`stub`, `offline`) never reads the key, so a free run cannot carry it anywhere.
 */
import type { Mode } from './models.ts';

export const PLACEHOLDER_KEY = 'placeholder';

export function rehearsalApiKey(mode: Mode, env: Readonly<Record<string, string | undefined>>): string {
  if (mode === 'stub' || mode === 'offline') return PLACEHOLDER_KEY;
  const key = env.ANTHROPIC_API_KEY?.trim();
  return key ? key : PLACEHOLDER_KEY;
}

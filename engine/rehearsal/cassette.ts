/**
 * The cassette's key (docs/plans/2026-11-11-system-rehearsal-design.md, section 4): a call is identified by everything
 * it sends, hashed, so a cassette replays an answer only to the request that earned it. A request field left out of the
 * key replays a stale answer to a changed prompt, so the key takes every field of a `ChatRequest` or a
 * `CompletionRequest` except `staff` and `meeting`, which number rows in a database and say nothing of the content,
 * plus the kind of call and the model the tier resolved to. Pure and browser-safe: the engine's build has no
 * `node:crypto`, so the hash function is a parameter (the rehearsal's tool passes SHA-256).
 */
import type { ChatRequest, CompletionRequest } from '../system/model.ts';

export type CallKind = 'chat' | 'complete';

/** Canonical JSON: object keys sorted at every depth, a key whose value is undefined left out, as JSON.stringify leaves it. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  const o = value as Record<string, unknown>;
  const parts = Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`);
  return `{${parts.join(',')}}`;
}

/** The key of one call: `hash` of the canonical JSON of the kind, the resolved model and every field but `staff` and `meeting`. */
export function callKey(kind: CallKind, request: ChatRequest | CompletionRequest, model: string, hash: (text: string) => string): string {
  const { staff: _staff, meeting: _meeting, ...content } = request as ChatRequest & CompletionRequest;
  return hash(canonicalJson({ kind, model, request: content }));
}

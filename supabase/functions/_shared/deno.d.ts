/**
 * The little of Deno's global the Edge Functions use, declared for the type check, which runs
 * under Node's types (tsconfig.json). Under Deno the real global is there and this file is not
 * loaded: nothing imports it.
 */
declare const Deno: {
  readonly env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): unknown;
};
/** Supabase's Edge Runtime: work that runs on after the answer has gone. */
declare const EdgeRuntime: { waitUntil(work: Promise<unknown>): void } | undefined;

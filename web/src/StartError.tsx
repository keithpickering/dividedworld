/**
 * The screen a build that cannot start shows, in place of the app: plain words, not in character, and
 * never a blank page. The cause is the Error's own message (no Supabase project named, or a fixture
 * or moment the address names that is not there, with the ones that are).
 */
export function StartError({ error }: { readonly error: unknown }) {
  return (
    <main style={{ maxWidth: '36rem', margin: '3rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif', lineHeight: 1.5 }}>
      <h1>This site could not start</h1>
      <p>{error instanceof Error ? error.message : 'This build names no Supabase project.'}</p>
    </main>
  );
}

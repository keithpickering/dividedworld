/**
 * The screen a build that cannot start shows, in place of the app: plain words, not in character, and
 * never a blank page. The cause is the Error's own message (no Supabase project named, or a fixture
 * or moment the address names that is not there, with the ones that are); anything else thrown is
 * shown as it is, since only the failure is known. The page's stylesheet (engine/ui/base.css) is
 * loaded by main.tsx before this renders.
 */
export function StartError({ error }: { readonly error: unknown }) {
  return (
    <main className="kb-page">
      <h1>This site could not start</h1>
      <p>{error instanceof Error ? error.message : `The site could not start: ${String(error)}`}</p>
    </main>
  );
}

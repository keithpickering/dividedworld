/**
 * The trophies and gear admin page, a glass page at /admin/trophies (the cosmetics plan, Task 11; board 05 of docs/research/2026-11-04-cosmetics/), reached from the queue
 * by the admin pages' strip (AdminPages.tsx). Five plain sections, in the glass's own voice (out of character, "the fiction may lie; the log never does"):
 *
 *   Award a trophy   a trophy (the instance's kinds and the ones an admin made), a character by name, and the award's own words if any. A belt says it passes to the
 *                    character and that its holder's reign ends. A name no character has is said in words and nothing is given.
 *   Grant gear       a gear, a character by name and copies (1 to 100): they go to the wardrobe of whoever plays the character, and this page never says who.
 *   Make a trophy    a name, words, a kind (a trophy or a belt) and a picture: a file the browser draws down to 48 pixels and turns into a WebP (trophy-art.ts), which the
 *                    trophy-art function stores before the trophy is made. A trophy needs no picture.
 *   Recent awards    newest first, each with its giver in plain words and a Reverse; a reversed award stays listed, marked "Taken back", with its button gone. Older
 *                    awards are fetched a page at a time.
 *   Awards that could not be given
 *                    what the season's end or a met demand could not write, kept with the error (`trophyAwardFailures`); each character it was for has a button that
 *                    gives the award by hand (`giveFailedAward`, which records it), which is the way out for an award the machine could not give. A character given its award
 *                    shows "Given" and no button; the failures still owed come first, and older ones are fetched a page at a time.
 *
 * An admin's alone: a player who opens it is told so and nothing is asked for; every write is refused again by the database in its own words. A character is found by
 * its name (`adminCharacterNamed`), and only its name and id come back, never who plays it ("a response never proves a private fact").
 */
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useKayfa } from '../context.tsx';
import { ADMIN_AWARDS_PAGE, type AdminAward, type AdminKind, type Answer, type Id, type TrophyAwardFailure } from '../data/api.ts';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { CalmRegion } from '../glass/Calm.tsx';
import { PageHead } from '../glass/PageHead.tsx';
import { shortDate } from '../postbit/dates.ts';
import { AdminPages } from './AdminPages.tsx';
import { trophyArt } from './trophy-art.ts';
import './trophies.css';

/** Turns the file an admin chose into the WebP the trophy-art function takes; the browser's own io, loaded only when a picture is chosen. */
async function browserArt(file: File): Promise<Blob> {
  const { browserIo } = await import('../profile-edit/picture.ts');
  return trophyArt(browserIo, file);
}

const capital = (words: string): string => words.charAt(0).toUpperCase() + words.slice(1);
const kindWords = (k: AdminKind): string => `${k.name}${k.belt || k.made ? ` (${[k.belt ? 'belt' : null, k.made ? 'made here' : null].filter(Boolean).join(', ')})` : ''}`;

/** A section's own status and problem, and the one write at a time it runs. */
function useWrite() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [problem, setProblem] = useState('');
  const run = async (write: () => Promise<{ readonly said: string } | { readonly problem: string }>) => {
    if (busy) return false;
    setBusy(true);
    setStatus('');
    setProblem('');
    try {
      const done = await write();
      if ('problem' in done) setProblem(done.problem); else setStatus(done.said);
      return !('problem' in done);
    } catch {
      setProblem('No answer came back. It may have gone through: reload the page and look before you try again.');
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, status, problem, run };
}

/** What a section says under its button: the status for a screen reader (always there, so it is announced when its words change) and the problem as an alert. */
function Said({ write, id }: { readonly write: ReturnType<typeof useWrite>; readonly id: string }) {
  return (
    <>
      <div role="status" className="kb-trophies-status">{write.busy ? 'Working…' : write.status}</div>
      {write.problem !== '' && <p role="alert" id={`${id}-problem`} className="kb-trophies-problem">{write.problem}</p>}
    </>
  );
}

export function TrophiesScreen({ makeArt = browserArt }: { readonly makeArt?: (file: File) => Promise<Blob> }) {
  const { api, instance, ui } = useKayfa();
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [awards, setAwards] = useState<readonly AdminAward[] | null>(null);
  const [kinds, setKinds] = useState<readonly AdminKind[]>([]);
  const [more, setMore] = useState(false);
  const [failures, setFailures] = useState<readonly TrophyAwardFailure[] | null>(null);
  const [moreFailures, setMoreFailures] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const [page, broken] = await Promise.all([api.adminAwards(), api.trophyAwardFailures()]);
      if (!page.ok || !broken.ok) { setFailed(true); return; }
      setAwards(page.value.awards);
      setKinds(page.value.kinds);
      setMore(page.value.more);
      setFailures(broken.value.failures);
      setMoreFailures(broken.value.more);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [api]);

  useEffect(() => {
    let live = true;
    void api.isAdmin().then((a) => { if (live) setAdmin(a); }, () => { if (live) setAdmin(false); });
    return () => { live = false; };
  }, [api]);
  useEffect(() => { if (admin) void load(); }, [admin, load]);

  if (admin === null) return <div className="kb-trophies" aria-busy="true" />;
  if (!admin) {
    return (
      <div className="kb-trophies">
        <PageHead title="Trophies" />
        <CalmRegion as="p" className="kb-trophies-lead">The trophies page is for admins.</CalmRegion>
      </div>
    );
  }

  const older = async (): Promise<Answer<unknown>> => {
    const last = awards?.at(-1);
    if (!last) return { ok: true, value: null };
    const page = await api.adminAwards({ before: last.at, beforeId: last.award });
    if (page.ok) { setAwards([...(awards ?? []), ...page.value.awards]); setKinds(page.value.kinds); setMore(page.value.more); }
    return page;
  };
  const olderFailures = async (): Promise<Answer<unknown>> => {
    const last = failures?.at(-1);
    if (!last) return { ok: true, value: null };
    const page = await api.trophyAwardFailures({ before: last.at, beforeId: last.id, beforeOpen: last.open });
    if (page.ok) { setFailures([...(failures ?? []), ...page.value.failures]); setMoreFailures(page.value.more); }
    return page;
  };
  const artOf = (key: string, art: string | null): string | null => art ?? ui.trophies[key]?.art ?? null;

  return (
    <div className="kb-trophies">
      <PageHead title="Trophies" />
      <CalmRegion as="p" className="kb-trophies-lead">
        Give a trophy, grant gear, make a one-off trophy for an event run by hand, and take an award back. Plain words: nothing here is in character.
      </CalmRegion>
      <AdminPages current="trophies" />
      {failed && <CalmRegion as="p" className="kb-trophies-note" role="alert">This page could not be read. Reload the page to try again.</CalmRegion>}
      {awards && failures && (
        <div className="kb-trophies-grid">
          <AwardForm kinds={kinds} reload={load} />
          <GrantForm reload={load} gear={instance.gear.map((g) => ({ key: g.key, name: g.name }))} />
          <MakeForm makeArt={makeArt} reload={load} />
          <Recent awards={awards} more={more} artOf={artOf} reload={load} older={older} />
          <Failures failures={failures} more={moreFailures} kinds={kinds} places={instance.trophies.seasonPlaces} reload={load} older={olderFailures} />
        </div>
      )}
    </div>
  );
}

/** A character by its name: its id, or the words that say why not. */
async function named(api: ReturnType<typeof useKayfa>['api'], name: string): Promise<{ readonly id: Id; readonly name: string } | { readonly problem: string }> {
  const asked = name.trim();
  if (asked === '') return { problem: 'Name the character.' };
  const found = await api.adminCharacterNamed(asked);
  if (!found.ok) return { problem: found.error };
  return found.value ?? { problem: `There is no character named ${asked}.` };
}

function AwardForm({ kinds, reload }: { readonly kinds: readonly AdminKind[]; readonly reload: () => Promise<void> }) {
  const { api } = useKayfa();
  const id = useId();
  const write = useWrite();
  const [kind, setKind] = useState('');
  const [who, setWho] = useState('');
  const [line, setLine] = useState('');
  const chosen = kinds.find((k) => k.key === kind) ?? kinds[0];
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!chosen) return;
    await write.run(async () => {
      const c = await named(api, who);
      if ('problem' in c) return c;
      const said = line.trim();
      const answer = await api.awardTrophy(chosen.key, c.id, said === '' ? undefined : said);
      if (!answer.ok) return { problem: answer.error };
      setWho('');
      setLine('');
      await reload();
      return { said: `Gave ${chosen.name} to ${c.name}.` };
    });
  };
  return (
    <CalmRegion as="section" aria-labelledby={`${id}-h`} className="kb-trophies-panel">
      <h2 id={`${id}-h`} className="kb-trophies-head">Award a trophy</h2>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <label className="kb-trophies-label" htmlFor={`${id}-kind`}>Trophy</label>
        <select id={`${id}-kind`} className="kb-trophies-field" value={chosen?.key ?? ''} onChange={(e) => setKind(e.target.value)}>
          {kinds.map((k) => <option key={k.key} value={k.key}>{kindWords(k)}</option>)}
        </select>
        <label className="kb-trophies-label" htmlFor={`${id}-who`}>To the character</label>
        <input id={`${id}-who`} className="kb-trophies-field" autoComplete="off" value={who} onChange={(e) => setWho(e.target.value)} aria-describedby={write.problem ? `${id}-problem` : undefined} />
        <label className="kb-trophies-label" htmlFor={`${id}-line`}>Its line (optional)</label>
        <input id={`${id}-line`} className="kb-trophies-field" autoComplete="off" maxLength={200} value={line} onChange={(e) => setLine(e.target.value)} />
        {chosen?.belt && <p className="kb-trophies-note">A belt passes to this character and its holder&apos;s reign ends. The award, and who gave it, is shown on the profile and in the character&apos;s log.</p>}
        <ButtonRow><GlassButton type="submit" kind="primary" disabled={write.busy || !chosen}>Award</GlassButton></ButtonRow>
        <Said write={write} id={id} />
      </form>
    </CalmRegion>
  );
}

function GrantForm({ gear, reload }: { readonly gear: readonly { readonly key: string; readonly name: string }[]; readonly reload: () => Promise<void> }) {
  const { api } = useKayfa();
  const id = useId();
  const write = useWrite();
  const [item, setItem] = useState('');
  const [who, setWho] = useState('');
  const [copies, setCopies] = useState('1');
  const chosen = gear.find((g) => g.key === item) ?? gear[0];
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!chosen) return;
    await write.run(async () => {
      const n = copies.trim() === '' ? NaN : Number(copies);
      if (!Number.isInteger(n) || n < 1 || n > 100) return { problem: 'Copies are a whole number from 1 to 100.' };
      const c = await named(api, who);
      if ('problem' in c) return c;
      const answer = await api.grantGear(c.id, chosen.key, n);
      if (!answer.ok) return { problem: answer.error };
      setWho('');
      await reload();
      return { said: `Gave ${n} ${chosen.name} to ${c.name}.` };
    });
  };
  return (
    <CalmRegion as="section" aria-labelledby={`${id}-h`} className="kb-trophies-panel">
      <h2 id={`${id}-h`} className="kb-trophies-head">Grant gear</h2>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <label className="kb-trophies-label" htmlFor={`${id}-item`}>Gear</label>
        <select id={`${id}-item`} className="kb-trophies-field" value={chosen?.key ?? ''} onChange={(e) => setItem(e.target.value)}>
          {gear.map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}
        </select>
        <label className="kb-trophies-label" htmlFor={`${id}-who`}>To the character</label>
        <input id={`${id}-who`} className="kb-trophies-field" autoComplete="off" value={who} onChange={(e) => setWho(e.target.value)} />
        <label className="kb-trophies-label" htmlFor={`${id}-copies`}>Copies</label>
        <input id={`${id}-copies`} className="kb-trophies-field kb-trophies-short" type="number" inputMode="numeric" min={1} max={100} value={copies} onChange={(e) => setCopies(e.target.value)} />
        <p className="kb-trophies-note">The copies go to the wardrobe of whoever plays that character. This page never says who that is.</p>
        <ButtonRow><GlassButton type="submit" kind="primary" disabled={write.busy || !chosen}>Grant</GlassButton></ButtonRow>
        <Said write={write} id={id} />
      </form>
    </CalmRegion>
  );
}

function MakeForm({ makeArt, reload }: { readonly makeArt: (file: File) => Promise<Blob>; readonly reload: () => Promise<void> }) {
  const { api } = useKayfa();
  const id = useId();
  const write = useWrite();
  const [name, setName] = useState('');
  const [line, setLine] = useState('');
  const [belt, setBelt] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await write.run(async () => {
      const n = name.trim();
      if (n === '') return { problem: 'A trophy needs a name.' };
      let art: Blob | null = null;
      if (file) {
        try {
          art = await makeArt(file);
        } catch (error) {
          return { problem: error instanceof Error && error.message !== '' ? error.message : 'That file could not be made into a picture, so nothing was made.' };
        }
      }
      const said = line.trim();
      const answer = await api.makeTrophy(n, said === '' ? null : said, art, belt);
      if (!answer.ok) return { problem: answer.error };
      setName('');
      setLine('');
      setFile(null);
      if (picker.current) picker.current.value = '';
      await reload();
      return { said: `Made ${n}. It is in the list above, ready to award.` };
    });
  };
  return (
    <CalmRegion as="section" aria-labelledby={`${id}-h`} className="kb-trophies-panel">
      <h2 id={`${id}-h`} className="kb-trophies-head">Make a trophy</h2>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <label className="kb-trophies-label" htmlFor={`${id}-name`}>Name</label>
        <input id={`${id}-name`} className="kb-trophies-field" autoComplete="off" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        <label className="kb-trophies-label" htmlFor={`${id}-line`}>Its line (optional)</label>
        <input id={`${id}-line`} className="kb-trophies-field" autoComplete="off" maxLength={200} value={line} onChange={(e) => setLine(e.target.value)} />
        <label className="kb-trophies-label" htmlFor={`${id}-file`}>Picture (any picture; it is drawn down to 48 pixels and kept under 16 KB)</label>
        <input id={`${id}-file`} ref={picker} className="kb-trophies-field" type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <label className="kb-trophies-label" htmlFor={`${id}-belt`}>Kind</label>
        <select id={`${id}-belt`} className="kb-trophies-field" value={belt ? 'belt' : 'trophy'} onChange={(e) => setBelt(e.target.value === 'belt')}>
          <option value="trophy">A trophy</option>
          <option value="belt">A belt (one holder at a time)</option>
        </select>
        <ButtonRow><GlassButton type="submit" kind="primary" disabled={write.busy}>Make it</GlassButton></ButtonRow>
        <Said write={write} id={id} />
      </form>
    </CalmRegion>
  );
}

function Recent({ awards, more, artOf, reload, older }: {
  readonly awards: readonly AdminAward[];
  readonly more: boolean;
  readonly artOf: (key: string, art: string | null) => string | null;
  readonly reload: () => Promise<void>;
  readonly older: () => Promise<Answer<unknown>>;
}) {
  const { api } = useKayfa();
  const id = useId();
  const write = useWrite();
  const table = useRef<HTMLTableElement>(null);
  const [back, setBack] = useState<Id | null>(null);
  /* A reversed award's button is gone: focus goes to the words that took its place. */
  useEffect(() => {
    if (back === null) return;
    table.current?.querySelector<HTMLElement>(`[data-kb-taken="${back}"]`)?.focus();
    setBack(null);
  }, [back, awards]);
  const reverse = (a: AdminAward) => write.run(async () => {
    const answer = await api.reverseAward(a.award);
    if (!answer.ok) return { problem: answer.error };
    await reload();
    setBack(a.award);
    return { said: `Took back ${a.name} from ${a.to}.${a.belt ? ' If the belt was theirs, it goes back to whoever held it before, if anyone did.' : ''}` };
  });
  return (
    <CalmRegion as="section" aria-labelledby={`${id}-h`} className="kb-trophies-panel kb-trophies-wide">
      <h2 id={`${id}-h`} className="kb-trophies-head">Recent awards</h2>
      {awards.length === 0 ? <p className="kb-trophies-note">No trophy has been given yet.</p> : (
        <table ref={table} className="kb-trophies-table">
          <thead><tr><th scope="col"><span className="kb-trophies-hide">Picture</span></th><th scope="col">Trophy</th><th scope="col">To</th><th scope="col">By</th><th scope="col"><span className="kb-trophies-hide">Reverse</span></th></tr></thead>
          <tbody>
            {awards.map((a) => {
              const art = artOf(a.trophy, a.art);
              return (
                <tr key={a.award} data-kb-reversed={a.reversed || undefined}>
                  <td className="kb-trophies-art">{art && <img src={art} alt="" draggable={false} />}</td>
                  <th scope="row">{a.name}{a.belt && <span className="kb-trophies-sub">belt</span>}{a.line && <span className="kb-trophies-sub">{a.line}</span>}</th>
                  <td>{a.to}</td>
                  <td>{capital(a.by)} · {shortDate(a.at)}</td>
                  <td>
                    {a.reversed
                      ? <span className="kb-trophies-taken" tabIndex={-1} data-kb-taken={a.award}>Taken back</span>
                      : <GlassButton size="s" aria-label={`Reverse ${a.name} given to ${a.to}`} disabled={write.busy} onClick={() => void reverse(a)}>Reverse</GlassButton>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {more && <ButtonRow><GlassButton size="s" disabled={write.busy} onClick={() => void write.run(async () => { const a = await older(); return a.ok ? { said: `Showing ${ADMIN_AWARDS_PAGE} more.` } : { problem: a.error }; })}>Older awards</GlassButton></ButtonRow>}
      <Said write={write} id={id} />
    </CalmRegion>
  );
}

function Failures({ failures, more, kinds, places, reload, older }: {
  readonly failures: readonly TrophyAwardFailure[];
  readonly more: boolean;
  readonly kinds: readonly AdminKind[];
  readonly places: readonly string[];
  readonly reload: () => Promise<void>;
  readonly older: () => Promise<Answer<unknown>>;
}) {
  const { api } = useKayfa();
  const id = useId();
  const write = useWrite();
  const nameOf = (key: string): string => kinds.find((k) => k.key === key)?.name ?? key;
  return (
    <CalmRegion as="section" aria-labelledby={`${id}-h`} className="kb-trophies-panel kb-trophies-wide">
      <h2 id={`${id}-h`} className="kb-trophies-head">Awards that could not be given</h2>
      {failures.length === 0 ? <p className="kb-trophies-note">No award has failed.</p> : (
        <>
          <p className="kb-trophies-note">The season or a met demand ended all the same; its award could not be written. Give it by hand to each character it was for; a character that has had it shows Given, and the failures still owed come first.</p>
          <ul className="kb-trophies-failures">
            {failures.map((f) => (
              <li key={f.id}>
                <p className="kb-trophies-what">{f.season !== null ? `Season ${f.season}'s places` : 'A met demand'} · {shortDate(f.at)}</p>
                <p className="kb-trophies-note">{f.error}</p>
                {f.characters === null
                  ? <p className="kb-trophies-note">The characters it was for cannot be read now. Give it from Award a trophy.</p>
                  : (
                    <ButtonRow>
                      {f.characters.map((c) => {
                        const key = f.trophy ?? (c.place !== undefined ? places[c.place - 1] : undefined);
                        if (key === undefined) return null;
                        const trophy = nameOf(key);
                        if (c.given) return <span key={c.id} className="kb-trophies-taken">Given: {trophy} to {c.name}</span>;
                        return (
                          <GlassButton key={c.id} size="s" disabled={write.busy} onClick={() => void write.run(async () => {
                            const answer = await api.giveFailedAward(f.id, c.id);
                            if (!answer.ok) return { problem: answer.error };
                            await reload();
                            return { said: `Gave ${trophy} to ${c.name}.` };
                          })}>Give {trophy} to {c.name}</GlassButton>
                        );
                      })}
                    </ButtonRow>
                  )}
              </li>
            ))}
          </ul>
          {more && <ButtonRow><GlassButton size="s" disabled={write.busy} onClick={() => void write.run(async () => { const a = await older(); return a.ok ? { said: 'Showing older failed awards.' } : { problem: a.error }; })}>Older failed awards</GlassButton></ButtonRow>}
        </>
      )}
      <Said write={write} id={id} />
    </CalmRegion>
  );
}

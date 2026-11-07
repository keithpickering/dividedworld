/**
 * The machine's admin page, a glass page at /admin/machine (the booster packs plan, Task 6; its design, section 7; board 05 of
 * docs/research/2026-11-07-booster-packs/ and the fourth screen of board 04), reached from the queue by the admin pages' strip (AdminPages.tsx). A plain
 * table of every slot in the order players see them, a hidden one too:
 *
 *   Slot          its place on the machine's front (A1, A2, B1 ... two to a row), or a dash for a slot that is hidden and so on no row.
 *   Order         Move up and Move down. They swap the slot with its neighbor and are saved as they are pressed: layout, not a choice to review. The first
 *                 slot's Move up and the last slot's Move down are disabled and do nothing.
 *   Item          what the slot sells: a card (with its rarity) or a pack (with how many cards it gives).
 *   Availability  on sale, sold out or hidden. The admin's word: the Boss's moves lie over it and never change it.
 *   Price         in orbs, stored in hundredths.
 *   The Boss      a Boss move in force on the slot, in plain words, with a link to REVERSE it in the queue.
 *
 * One "Save changes" saves every availability and price that was changed; nothing is sent until then. A price that is not an amount refuses the whole save in
 * words beside it and sends nothing. Taking a pack off sale ends the Boss's Pulls of cards that no pack on sale can still give; the status says how many.
 *
 * Plain, out-of-character text, like the queue ("The fiction may lie; the log never does"). An admin's alone: a player who opens it is told so and the machine
 * is not asked for. The move buttons keep focus on the slot that moved.
 */
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useKayfa } from '../context.tsx';
import type { AdminSlot } from '../data/api.ts';
import { orbs } from '../cards/faces.ts';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { CalmRegion } from '../glass/Calm.tsx';
import { GLASS_NAV } from '../glass/nav.ts';
import { PageHead } from '../glass/PageHead.tsx';
import { shortDate } from '../postbit/dates.ts';
import { Link } from '../router.tsx';
import { AdminPages } from './AdminPages.tsx';
import './machine.css';

type Availability = AdminSlot['availability'];
const AVAILABILITY: readonly { readonly value: Availability; readonly label: string }[] = [
  { value: 'onSale', label: 'On sale' }, { value: 'soldOut', label: 'Sold out' }, { value: 'hidden', label: 'Hidden' },
];

/** A slot's code on the machine's front: A1, A2, B1 ... two to a row. */
const codeOf = (i: number) => `${String.fromCharCode(65 + Math.floor(i / 2))}${(i % 2) + 1}`;

/** What an admin typed in a price field as hundredths of an orb, or null where it is no amount: whole orbs or up to two decimals, at least 0.01. */
export function hundredths(text: string): number | null {
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/u.exec(text.trim());
  if (!m) return null;
  const n = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return n >= 1 ? n : null;
}

/** What an admin has changed on a slot and not saved: the availability and the price as typed. */
interface Edit { readonly availability: Availability; readonly price: string }

export function MachineScreen() {
  const { api, instance, ui } = useKayfa();
  const id = useId();
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [slots, setSlots] = useState<readonly AdminSlot[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [edits, setEdits] = useState<Readonly<Record<string, Edit>>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ readonly slot: string | null; readonly words: string } | null>(null);
  const [status, setStatus] = useState('');
  /* The button to focus once the grid is drawn again: a disabled button cannot keep focus, so a slot that reached an end passes it to its other arrow. */
  const refocus = useRef<{ readonly slot: string; readonly want: 'up' | 'down' } | null>(null);
  const table = useRef<HTMLTableElement>(null);

  const load = useCallback(async () => {
    try {
      setSlots(await api.adminMachine());
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
  useEffect(() => {
    const want = refocus.current;
    if (!want || !slots || !table.current) return;
    refocus.current = null;
    const i = slots.findIndex((s) => s.id === want.slot);
    const last = slots.length - 1;
    const dir = (want.want === 'up' && i === 0) ? 'down' : (want.want === 'down' && i === last) ? 'up' : want.want;
    table.current.querySelector<HTMLElement>(`[data-kb-slot="${want.slot}"][data-kb-move="${dir}"]`)?.focus();
  });

  if (admin === null) return <div className="kb-machine-admin" aria-busy="true" />;
  if (!admin) {
    return (
      <div className="kb-machine-admin">
        <PageHead title="The machine" />
        <CalmRegion as="p" className="kb-machine-lead">The machine&apos;s page is for admins.</CalmRegion>
      </div>
    );
  }

  const nameOf = (s: AdminSlot): { readonly name: string; readonly kind: string } => {
    if ('card' in s.item) {
      const key = s.item.card;
      return { name: instance.cards.find((c) => c.key === key)?.name ?? key, kind: s.rarity ?? 'card' };
    }
    const key = s.item.pack;
    const cards = instance.packs.find((p) => p.key === key)?.pulls.length;
    return { name: ui.packs[key]?.name ?? key, kind: cards === undefined ? 'pack' : `pack · ${cards} cards` };
  };

  /* The grid: the slots that are on a row of the machine's front, in order; a hidden slot has no place. */
  const places = new Map<string, string>();
  (slots ?? []).filter((s) => s.availability !== 'hidden').forEach((s, i) => places.set(s.id, codeOf(i)));

  const shown = (s: AdminSlot): Edit => edits[s.id] ?? { availability: s.availability, price: orbs(s.price) };
  const edit = (s: AdminSlot, change: Partial<Edit>) => {
    setProblem(null);
    setStatus('');
    setEdits({ ...edits, [s.id]: { ...shown(s), ...change } });
  };

  const move = async (s: AdminSlot, direction: 'up' | 'down') => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    setStatus('');
    try {
      let answer;
      try { answer = await api.moveSlot(s.id, direction); } catch { setProblem({ slot: null, words: 'No answer came back. Reload the page and look before you try again.' }); return; }
      if (!answer.ok) { setProblem({ slot: null, words: answer.error }); return; }
      refocus.current = { slot: s.id, want: direction };
      await load();
      const name = nameOf(s).name;
      setStatus(answer.value.moved ? `Moved ${name} ${direction}.` : `${name} is already ${direction === 'up' ? 'first' : 'last'}.`);
    } finally {
      setBusy(false);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !slots) return;
    const changed = slots.flatMap((s) => {
      const e1 = edits[s.id];
      if (!e1) return [];
      const price = hundredths(e1.price);
      return e1.availability === s.availability && price === s.price ? [] : [{ s, e: e1, price }];
    });
    const bad = changed.find((c) => c.price === null);
    if (bad) { setProblem({ slot: bad.s.id, words: `${nameOf(bad.s).name}: a price is an amount in orbs, like 1.50, of at least 0.01.` }); setStatus(''); return; }
    setBusy(true);
    setProblem(null);
    setStatus('');
    try {
      let ended = 0;
      let done = 0;
      for (const c of changed) {
        let answer;
        try { answer = await api.setSlot(c.s.id, c.e.availability, c.price!); } catch {
          setProblem({ slot: null, words: 'No answer came back. It may have been saved: reload the page and look before you save it again.' });
          return;
        }
        if (!answer.ok) {
          setProblem({ slot: c.s.id, words: `${nameOf(c.s).name}: ${answer.error}${done > 0 ? ` The ${done === 1 ? 'slot before it was' : `${done} slots before it were`} saved.` : ''}` });
          await load();
          return;
        }
        done += 1;
        ended += answer.value.ended;
        setEdits((now) => { const { [c.s.id]: _saved, ...rest } = now; return rest; });
      }
      await load();
      setStatus(changed.length === 0 ? 'Nothing was changed.' : `Saved. Players see it at once.${ended > 0 ? ` ${ended === 1 ? 'A Boss pull ended' : `${ended} Boss pulls ended`}, since no pack on sale can still give ${ended === 1 ? 'its card' : 'their cards'}.` : ''}`);
    } finally {
      setBusy(false);
    }
  };

  const last = (slots?.length ?? 0) - 1;
  return (
    <div className="kb-machine-admin">
      <PageHead title="The machine" />
      <CalmRegion as="p" className="kb-machine-lead">
        The slots in the order players see them. A hidden slot draws nothing; a sold-out slot shows greyed. What a pack can roll is set in the code, with the cards.
      </CalmRegion>
      <AdminPages current="machine" />
      {failed && <CalmRegion as="p" className="kb-machine-note" role="alert">The machine could not be read. Reload the page to try again.</CalmRegion>}
      {slots && (
        <CalmRegion as="section" aria-label="The slots" className="kb-machine-calm">
          <form className="kb-machine-form" aria-label="The machine" onSubmit={(e) => void save(e)} noValidate>
            <table ref={table} className="kb-machine-table">
              <thead>
                <tr><th scope="col">Slot</th><th scope="col">Order</th><th scope="col">Item</th><th scope="col">Availability</th><th scope="col">Price</th><th scope="col">The Boss</th></tr>
              </thead>
              <tbody>
                {slots.map((s, i) => {
                  const { name, kind } = nameOf(s);
                  const now = shown(s);
                  const mine = problem?.slot === s.id;
                  return (
                    <tr key={s.id} data-kb-slot={s.id}>
                      <td className="kb-machine-code">{places.get(s.id) ?? '–'}</td>
                      <td className="kb-machine-order">
                        <GlassButton size="s" aria-label={`${name}: move up`} disabled={i === 0 || busy} data-kb-slot={s.id} data-kb-move="up" onClick={() => void move(s, 'up')}>↑</GlassButton>
                        <GlassButton size="s" aria-label={`${name}: move down`} disabled={i === last || busy} data-kb-slot={s.id} data-kb-move="down" onClick={() => void move(s, 'down')}>↓</GlassButton>
                      </td>
                      <th scope="row" className="kb-machine-item">{name}<span className="kb-machine-kind">{kind}</span></th>
                      <td>
                        <select className="kb-machine-field" aria-label={`${name}: availability`} value={now.availability} onChange={(e) => edit(s, { availability: e.target.value as Availability })}>
                          {AVAILABILITY.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                        </select>
                      </td>
                      <td>
                        <input className="kb-machine-field kb-machine-price" inputMode="decimal" autoComplete="off" aria-label={`${name}: price`} value={now.price}
                          aria-invalid={mine || undefined} aria-describedby={mine ? `${id}-problem` : undefined} onChange={(e) => edit(s, { price: e.target.value })} />
                      </td>
                      <td className="kb-machine-boss"><BossMove slot={s} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <ButtonRow>
              <GlassButton type="submit" kind="primary" disabled={busy}>Save changes</GlassButton>
              <p className="kb-machine-note kb-machine-save-note">Players see a saved price at once. A Boss move in force reads the new price.</p>
            </ButtonRow>
            <div role="status" className="kb-machine-status">{busy ? 'Saving…' : status}</div>
            {problem && <p role="alert" id={`${id}-problem`} className="kb-machine-problem">{problem.words}</p>}
          </form>
        </CalmRegion>
      )}
    </div>
  );
}

/** The Boss's move in force on a slot, in plain words, and where to reverse it; a hidden slot says it may be flash-sold. */
function BossMove({ slot }: { readonly slot: AdminSlot }) {
  const m = slot.move;
  if (!m) return slot.availability === 'hidden' ? <span className="kb-machine-note">Only in packs. The Boss may flash-sale it.</span> : null;
  const to = m.ends ? ` · to ${shortDate(m.ends)}` : '';
  const words = m.kind === 'pullSlot' ? 'Pulled by the Boss'
    : m.kind === 'flashSale' ? 'Flash sale'
    : m.percent !== null && m.percent > 100 ? `Marked up ×${m.percent / 100} · ${orbs(Math.max(1, Math.round(slot.price * m.percent / 100)))}`
    : m.percent !== null ? `Marked down ×${m.percent / 100} · ${orbs(Math.max(1, Math.round(slot.price * m.percent / 100)))}`
    : 'Repriced by the Boss';
  return (
    <>
      <span className="kb-machine-tag kb-glass-skew-tag" data-kb-move-kind={m.kind}><span className="kb-glass-upright">{words}{to}</span></span>
      <Link to={GLASS_NAV.admin} className="kb-machine-reverse" aria-label={`In the queue: reverse ${words}`}>In the queue</Link>
    </>
  );
}

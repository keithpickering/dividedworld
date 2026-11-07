/**
 * The machine's admin page, a glass page at /admin/machine (the booster packs plan, Task 6; its design, section 7; board 05 of
 * docs/research/2026-11-07-booster-packs/ and the fourth screen of board 04), reached from the queue by the admin pages' strip (AdminPages.tsx). A plain
 * table of every slot in the order players see them, a hidden one too:
 *
 *   Slot          its place on the machine's front (A1, A2, B1 ... two to a row), or a dash for a slot that is hidden and so on no row.
 *   Order         Move up and Move down. They swap the slot with the row beside it in this table, on the page only: the order is saved with Save changes,
 *                 like the rest, and a reload before that drops it. The status says where the slot now stands in the list and on the machine's front (a hidden
 *                 slot stands on none). The first slot's Move up and the last slot's Move down are disabled and do nothing; focus stays on the moved row's button.
 *   Item          what the slot sells: a card (with its rarity) or a pack (with how many cards it gives).
 *   Availability  on sale, sold out or hidden. The admin's word: the Boss's moves lie over it and never change it.
 *   Price         in orbs, stored in hundredths.
 *   The Boss      a Boss move in force on the slot, in plain words, with a link to REVERSE it in the queue.
 *
 * One "Save changes" saves the order, every availability and every price in a single transaction (`saveMachine`, save_machine in 0119); nothing is sent until
 * then. A price that is not an amount (0.01 to 1,000,000.00, up to two decimals) refuses the whole save in words beside it and sends nothing; the server's
 * refusal saves nothing either, names the slot and why, and marks that slot's availability or price field invalid. Taking a pack off sale ends the Boss's
 * Pulls of cards that no pack on sale can still give; the status says how many.
 *
 * Plain, out-of-character text, like the queue ("The fiction may lie; the log never does"). An admin's alone: a player who opens it is told so and the machine
 * is not asked for.
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

const ordinal = (n: number): string => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const PRICE_WORDS = 'a price is an amount in orbs between 0.01 and 1,000,000.00, like 1.50.';

/** A slot's code on the machine's front: A1, A2, B1 ... two to a row. */
const codeOf = (i: number) => `${String.fromCharCode(65 + Math.floor(i / 2))}${(i % 2) + 1}`;

/** The most a price may be, in hundredths of an orb: 1,000,000.00, as the database holds it (set_slot, 0119). */
const MOST = 100000000;

/** What an admin typed in a price field as hundredths of an orb, or null where it is no amount: whole orbs or up to two decimals, from 0.01 to 1,000,000.00. */
export function hundredths(text: string): number | null {
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/u.exec(text.trim());
  if (!m) return null;
  const n = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return n >= 1 && n <= MOST ? n : null;
}

/** What an admin has changed on a slot and not saved: the availability and the price as typed. */
interface Edit { readonly availability: Availability; readonly price: string }

/** What went wrong with a save, in words, and where: the slot and which of its two fields, where the words are about one. */
interface Problem { readonly slot: string | null; readonly field: 'availability' | 'price' | null; readonly words: string }

export function MachineScreen() {
  const { api, instance, ui } = useKayfa();
  const id = useId();
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [slots, setSlots] = useState<readonly AdminSlot[] | null>(null);
  const [failed, setFailed] = useState(false);
  /* The order on the page: the slots' ids as the admin has moved them, or null while it is the saved one. Nothing is sent until Save changes. */
  const [order, setOrder] = useState<readonly string[] | null>(null);
  const [edits, setEdits] = useState<Readonly<Record<string, Edit>>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
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
    const i = (order ?? slots.map((s) => s.id)).indexOf(want.slot);
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

  /* The rows as the admin has them now: the saved slots in the order moved on the page. */
  const byId = new Map((slots ?? []).map((s) => [s.id, s]));
  const rows = (order ?? (slots ?? []).map((s) => s.id)).flatMap((k) => byId.get(k) ?? []);
  const shown = (s: AdminSlot): Edit => edits[s.id] ?? { availability: s.availability, price: orbs(s.price) };
  /* The machine's front: the rows that are not hidden, as the admin has them now, in order; a hidden slot has no place. */
  const places = new Map<string, number>();
  rows.filter((s) => shown(s).availability !== 'hidden').forEach((s, i) => places.set(s.id, i));
  const edit = (s: AdminSlot, change: Partial<Edit>) => {
    setProblem(null);
    setStatus('');
    setEdits({ ...edits, [s.id]: { ...shown(s), ...change } });
  };

  /* Swaps the row with the one beside it in this table, on the page only. */
  const move = (s: AdminSlot, direction: 'up' | 'down') => {
    const ids = rows.map((r) => r.id);
    const at = ids.indexOf(s.id);
    const to = direction === 'up' ? at - 1 : at + 1;
    if (to < 0 || to >= ids.length) return;
    [ids[at], ids[to]] = [ids[to]!, ids[at]!];
    refocus.current = { slot: s.id, want: direction };
    setProblem(null);
    setOrder(ids);
    /* Where the slot stands now, in the list and on the machine's front (the hidden rows stand on none). */
    const front = ids.map((k) => byId.get(k)!).filter((r) => shown(r).availability !== 'hidden').findIndex((r) => r.id === s.id);
    setStatus(`${nameOf(s).name} is now ${ordinal(to + 1)} in the list and ${front < 0 ? 'not on the machine, since it is hidden' : `${ordinal(front + 1)} on the machine`}. Save changes to keep it.`);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !slots) return;
    const moved = order !== null && order.some((k, i) => k !== slots[i]?.id);
    const changes = rows.map((s) => ({ s, now: shown(s), price: hundredths(shown(s).price) }));
    const bad = changes.find((c) => c.price === null);
    if (bad) { setProblem({ slot: bad.s.id, field: 'price', words: `${nameOf(bad.s).name}: ${PRICE_WORDS}` }); setStatus(''); return; }
    const changed = moved || changes.some((c) => c.now.availability !== c.s.availability || c.price !== c.s.price);
    if (!changed) { setProblem(null); setStatus('Nothing was changed.'); return; }
    setBusy(true);
    setProblem(null);
    setStatus('');
    try {
      let answer;
      try {
        answer = await api.saveMachine(changes.map((c) => ({ slot: c.s.id, availability: c.now.availability, price: c.price! })));
      } catch {
        setProblem({ slot: null, field: null, words: 'No answer came back. It may have been saved: reload the page and look before you save it again.' });
        return;
      }
      if (!answer.ok) {
        /* The server saved none of it: the refusal names the slot and which field, where it is about one. */
        const [slot, field] = (answer.field ?? '').split('/');
        const at = changes.find((c) => c.s.id === slot)?.s;
        const words = at ? `${nameOf(at).name}: ${answer.error}` : answer.error;
        setProblem({ slot: at?.id ?? null, field: at && (field === 'availability' || field === 'price') ? field : null, words: answer.uncertain ? words : `${words} Nothing was saved.` });
        return;
      }
      setEdits({});
      setOrder(null);
      await load();
      const ended = answer.value.ended;
      setStatus(`Saved. Players see it at once.${ended > 0 ? ` ${ended === 1 ? 'A Boss pull ended' : `${ended} Boss pulls ended`}, since no pack on sale can still give ${ended === 1 ? 'its card' : 'their cards'}.` : ''}`);
    } finally {
      setBusy(false);
    }
  };

  const last = rows.length - 1;
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
                {rows.map((s, i) => {
                  const { name, kind } = nameOf(s);
                  const now = shown(s);
                  const place = places.get(s.id);
                  const badAvailability = problem?.slot === s.id && problem.field === 'availability';
                  const badPrice = problem?.slot === s.id && problem.field === 'price';
                  return (
                    <tr key={s.id} data-kb-slot={s.id}>
                      <td className="kb-machine-code">{place === undefined ? '–' : codeOf(place)}</td>
                      <td className="kb-machine-order">
                        <GlassButton size="s" aria-label={`${name}: move up`} disabled={i === 0 || busy} data-kb-slot={s.id} data-kb-move="up" onClick={() => move(s, 'up')}>↑</GlassButton>
                        <GlassButton size="s" aria-label={`${name}: move down`} disabled={i === last || busy} data-kb-slot={s.id} data-kb-move="down" onClick={() => move(s, 'down')}>↓</GlassButton>
                      </td>
                      <th scope="row" className="kb-machine-item">{name}<span className="kb-machine-kind">{kind}</span></th>
                      <td>
                        <select className="kb-machine-field" aria-label={`${name}: availability`} value={now.availability} aria-invalid={badAvailability || undefined}
                          aria-describedby={badAvailability ? `${id}-problem` : undefined} onChange={(e) => edit(s, { availability: e.target.value as Availability })}>
                          {AVAILABILITY.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                        </select>
                      </td>
                      <td>
                        <input className="kb-machine-field kb-machine-price" inputMode="decimal" autoComplete="off" aria-label={`${name}: price`} value={now.price}
                          aria-invalid={badPrice || undefined} aria-describedby={badPrice ? `${id}-problem ${id}-hint` : `${id}-hint`} onChange={(e) => edit(s, { price: e.target.value })} />
                      </td>
                      <td className="kb-machine-boss"><BossMove slot={s} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <ButtonRow>
              <GlassButton type="submit" kind="primary" disabled={busy}>Save changes</GlassButton>
              <p id={`${id}-hint`} className="kb-machine-note kb-machine-save-note">
                A price is between 0.01 and 1,000,000.00. Players see a saved price at once.
              </p>
            </ButtonRow>
            <div role="status" className="kb-machine-status">{busy ? 'Saving…' : status}</div>
            {problem && <p role="alert" id={`${id}-problem`} className="kb-machine-problem">{problem.words}</p>}
          </form>
        </CalmRegion>
      )}
    </div>
  );
}

/** The Boss's move in force on a slot, in plain words, and a link to Reverse it (the link goes to the queue, where a move is reversed; its name says so); a hidden slot says it may be flash-sold. */
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
      <Link to={GLASS_NAV.admin} className="kb-machine-reverse" aria-label={`Reverse in the queue: ${words}`}>Reverse</Link>
    </>
  );
}

/**
 * The dress-up page (the cosmetics design, sections 1, 2 and 6; board 02 of docs/research/2026-11-04-cosmetics/), a glass page at /wardrobe: dressing
 * one of the player's masks from the account's wardrobe. It is a settings screen, so it meets the forum's standards in full, and every pointer
 * move has a key and a button (CLAUDE.md, "An accessible path costs what the obstacle costs").
 *
 *   The mask       a select of the player's own masks, opening on the HUD's, as profile edit does; no address names a character the player plays.
 *   The stage      the portrait at a large size with the outfit drawn over it by `Outfit`, the reach line dashed around it. A piece is dragged on the
 *                  stage; the selected one has four corner handles (size) and a round handle (turn).
 *   The panel      the same moves as buttons and keys: arrows move by 1% (Shift 5%), + and - size by 5% of the portrait, [ and ] turn by 5 degrees,
 *                  Bring forward, Send back, Take it off (Delete); "Worn now" lists the pieces by layer so one can be chosen without the pointer.
 *   The wardrobe   the carousel of the account's gear: art, rarity in words and a gem, name, copies held and where each is worn. A piece is placed
 *                  by dragging its card onto the stage, by Enter on it, or by the panel's button, at the center on the next layer, and only while a
 *                  copy is free (held, less those worn on the other masks and those already on this stage).
 *   Shown on posts the mask's awards, up to `Settings.cosmetics.trophies.shownMost` checked; the held belts show regardless and are not choices.
 *   Save           sends the whole outfit in layer order; a refusal shows the server's words and keeps the arrangement.
 *
 * Plain, out-of-character words throughout. Where its copies came from is not in the wardrobe's data, so the panel says what the gear is and what
 * it says of itself, and no more.
 */
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type PointerEvent } from 'react';
import type { Piece } from '../../rules/cosmetics.ts';
import { gemOf, rarityName } from '../cards/faces.ts';
import { useKayfa } from '../context.tsx';
import type { Character, Id, ShownTrophy, TrophyItem, WardrobeItem } from '../data/api.ts';
import { Outfit, slotShape } from '../gear/Outfit.tsx';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { CalmRegion } from '../glass/Calm.tsx';
import { Carousel } from '../glass/Carousel.tsx';
import { GlassLink } from '../glass/Link.tsx';
import { PageHead } from '../glass/PageHead.tsx';
import { SignInPrompt } from '../mini.tsx';
import { usePlayer } from '../player.tsx';
import { useLocation } from '../router.tsx';
import { dragged, dragSized, dragTurned, fit, hit, layered, nudge, renumber, resized, STEP, turned } from './moves.ts';
import '../vending/vending.css';
import './wardrobe.css';

/** A piece's width when it is first put on, a fraction of the portrait's. */
const FIRST_WIDTH = 0.4;
/** The tallness a portrait is drawn at until its own is known (1 to 2 of its width). */
const FALLBACK_TALLNESS = 1.5;
/** What is said when a nudge changes nothing: the piece is at an edge of the portrait. */
const STUCK = "It can't move further that way.";

type Drag = { readonly mode: 'move' | 'size' | 'turn'; readonly index: number; readonly start: Piece; readonly sx: number; readonly sy: number; readonly d0: number; readonly a0: number; readonly dirty: boolean };

export function Wardrobe() {
  const { api } = useKayfa();
  const player = usePlayer();
  const signedIn = player.session.signedIn;
  const acting = player.actingCharacters;
  const location = useLocation();
  /* The character a navigation carried in history.state (My characters' Dress up), if it is one the player plays; never the address. */
  const carried = typeof location.state === 'object' && location.state !== null ? (location.state as { character?: unknown }).character : undefined;
  /* The gear a Random Event's Wear it carried, to be put on this mask when the stage opens. */
  const wear = typeof location.state === 'object' && location.state !== null ? (location.state as { wear?: unknown }).wear : undefined;
  const [picked, setPicked] = useState<Id | null>(null);
  const [faces, setFaces] = useState<ReadonlyMap<Id, Character> | null>(null);
  const [items, setItems] = useState<readonly WardrobeItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [stale, setStale] = useState(false);
  /* Each mask's arrangement not yet saved, kept while another mask is on the stage. */
  const drafts = useRef(new Map<Id, Piece[]>());

  const own = (x: unknown): x is Id => typeof x === 'string' && acting.some((c) => c.id === x);
  const id: Id | null = [picked, carried, player.hudCharacter?.id].find(own) ?? acting[0]?.id ?? null;

  const ids = acting.map((c) => c.id).join(',');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const loadWardrobe = useCallback(async (live: () => boolean) => {
    const answer = await api.wardrobe();
    if (!live()) return;
    if (answer.ok) setItems(answer.value);
    else setFailed(true);
  }, [api]);
  /* After a save: fetch both again, and where that fails keep the page and say so. */
  const refresh = useCallback(async () => {
    try {
      const [answer, list] = await Promise.all([api.wardrobe(), api.characters(ids.split(','))]);
      if (!mounted.current) return;
      if (!answer.ok) { setStale(true); return; }
      setItems(answer.value);
      setFaces(new Map(list.map((c) => [c.id, c])));
      setStale(false);
    } catch {
      if (mounted.current) setStale(true);
    }
  }, [api, ids]);
  useEffect(() => {
    if (!signedIn || ids === '') return undefined;
    let live = true;
    void (async () => {
      try {
        const [list] = await Promise.all([api.characters(ids.split(',')), loadWardrobe(() => live)]);
        if (live) setFaces(new Map(list.map((c) => [c.id, c])));
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => { live = false; };
  }, [api, signedIn, ids, loadWardrobe]);

  if (player.sessionKnown && !signedIn) return <div className="kb-wardrobe"><SignInPrompt /></div>;
  const head = <PageHead size="roster" title="The wardrobe" lead="Yours alone. Anyone can see what a mask wears; only you see what you hold." leadUnder />;
  if (!player.loaded || (signedIn && acting.length === 0 && player.characters.length === 0)) {
    return <div className="kb-wardrobe">{head}{player.loaded && <CalmRegion as="p" className="kb-notice">You have no characters yet, so there is nothing to dress. <GlassLink to="/characters/new">Make a character</GlassLink> first.</CalmRegion>}</div>;
  }
  if (id === null) {
    return <div className="kb-wardrobe">{head}<CalmRegion as="p" className="kb-notice">None of your characters can be dressed yet: a character is dressed once it has debuted and until it is retired.</CalmRegion></div>;
  }
  if (failed) return <div className="kb-wardrobe">{head}<CalmRegion as="p" className="kb-notice" data-kb-tone="refusal">The wardrobe could not be loaded. Reload the page to try again.</CalmRegion></div>;
  const face = faces?.get(id) ?? null;
  if (faces === null || items === null) return <div className="kb-wardrobe" aria-busy="true">{head}<CalmRegion as="p" className="kb-notice">Loading the wardrobe.</CalmRegion></div>;
  return (
    <div className="kb-wardrobe">
      {head}
      <CalmRegion>
        <label className="kb-glass-field">
          <span>Character</span>
          <select className="kb-glass-select" value={id} onChange={(e) => setPicked(e.target.value)}>
            {acting.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </CalmRegion>
      {stale && <CalmRegion as="p" className="kb-notice">Your save went through, but the page could not be refreshed. Reload it to see everything as saved.</CalmRegion>}
      {/* Keyed by the mask; an arrangement not yet saved waits in `drafts` while another mask is chosen. */}
      <Dressing key={id} id={id} name={acting.find((c) => c.id === id)!.name} face={face} items={items} reload={refresh} drafts={drafts.current} wear={typeof wear === 'string' && id === carried ? wear : null} />
    </div>
  );
}

function Dressing({ id, name, face, items, reload, drafts, wear }: { readonly id: Id; readonly name: string; readonly face: Character | null; readonly items: readonly WardrobeItem[]; readonly reload: () => Promise<void>; readonly drafts: Map<Id, Piece[]>; readonly wear: string | null }) {
  const { api, instance, ui } = useKayfa();
  const { characters } = usePlayer();
  const most = instance.settings.cosmetics.gear.wornMost;
  const reach = instance.settings.cosmetics.gear.reach;
  const group = useId();
  const [pieces, setPieces] = useState<Piece[]>(() => drafts.get(id) ?? renumber(face?.outfit ?? []));
  const [at, setAt] = useState<number | null>(null);
  const [gear, setGear] = useState<string | null>(items.some((i) => i.gear === wear) ? wear : items[0]?.gear ?? null);
  const [say, setSay] = useState('');
  const [sayN, setSayN] = useState(0);
  /* A line for the live region; the counter re-keys it, so the same words said twice are announced twice. */
  const speak = (words: string) => { setSay(words); setSayN((n) => n + 1); };
  const help = useId();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(() => drafts.has(id));
  const latest = useRef({ pieces, dirty });
  latest.current = { pieces, dirty };
  useEffect(() => () => { if (latest.current.dirty) drafts.set(id, latest.current.pieces); else drafts.delete(id); }, [drafts, id]);
  const [tall, setTall] = useState<number | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const sel = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [focusSel, setFocusSel] = useState(false);

  const rules = (key: string) => instance.gear.find((g) => g.key === key);
  const nameOf = (key: string) => rules(key)?.name ?? key;
  const aspectOf = (key: string) => ui.gear[key]?.aspect ?? 1;
  const masks = new Map(characters.map((c) => [c.id, c.name]));

  /* Where each gear's copies stand: held, those on the other masks (by mask), and those on this stage. */
  const standing = (it: WardrobeItem) => {
    const elsewhere = new Map<string, number>();
    for (const who of it.wornBy) if (who !== id) elsewhere.set(who, (elsewhere.get(who) ?? 0) + 1);
    const elsewhereCount = [...elsewhere.values()].reduce((a, b) => a + b, 0);
    const here = pieces.filter((p) => p.gear === it.gear).length;
    const free = Math.max(0, it.held - elsewhereCount - here);
    const on = (n: number, who: string) => (it.held === 1 ? `on ${who}` : `${n} on ${who}`);
    const parts = [...elsewhere].map(([who, n]) => on(n, masks.get(who) ?? 'another character'));
    if (here > 0) parts.unshift(on(here, name));
    return { elsewhere, elsewhereCount, here, free, text: parts.length === 0 ? (it.held === 1 ? `${it.held} held · free` : `${it.held} held · ${free} free`) : `${it.held} held · ${parts.join(', ')}${free > 0 ? `, ${free} free` : ''}` };
  };

  /** Why a gear cannot be put on now, in words; null where it can. */
  const whyNot = (key: string): string | null => {
    const it = items.find((i) => i.gear === key);
    if (!it) return `There is no ${nameOf(key)} in your wardrobe.`;
    if (pieces.length >= most) return `${pieces.length} pieces are worn, the most there can be. Take one off first.`;
    const s = standing(it);
    if (s.free > 0) return null;
    const where = [...s.elsewhere].map(([who, n]) => `${n} on ${masks.get(who) ?? 'another character'}`);
    return `No copy of ${nameOf(key)} is free: ${it.held} held${where.length > 0 ? `, ${where.join(', ')}` : ''}${s.here > 0 ? `, ${s.here} here` : ''}. ${s.elsewhereCount > 0 ? 'Take one off the other character to wear it here.' : 'Take one off here to wear it again.'}`;
  };

  /* While a save is out the arrangement is not edited: the save's answer would overwrite what was done meanwhile. */
  const change = (next: Piece[], index: number | null, words?: string) => {
    if (busy) return;
    setPieces(next);
    setAt(index);
    setDirty(true);
    setRefusal(null);
    speak(words ?? '');
  };

  const put = (key: string, where?: { readonly x: number; readonly y: number }) => {
    if (busy) return;
    const why = whyNot(key);
    if (why !== null) { speak(why); return; }
    const piece = fit({ gear: key, x: where?.x ?? 0.5, y: where?.y ?? 0.5, w: FIRST_WIDTH, turn: 0, layer: pieces.length });
    change([...pieces, piece], pieces.length, `${nameOf(key)} put on, layer ${pieces.length + 1} of ${pieces.length + 1} worn. The buttons under Selected piece move it.`);
  };

  /* A Random Event's Wear it: the found piece is put on once as the stage opens, unless this mask already wears one or none is free (then the page says why). */
  const wore = useRef(false);
  useEffect(() => {
    if (wear === null || wore.current) return;
    wore.current = true;
    if (!pieces.some((p) => p.gear === wear)) put(wear);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, as the stage opens

  const current = at !== null ? pieces[at] ?? null : null;
  /** A change to the selected piece; where it changes nothing (a bound), says so in `none`. */
  const edit = (f: (p: Piece) => Piece, none: string, words?: (p: Piece) => string) => {
    if (at === null || !current || busy) return;
    const p = f(current);
    if (JSON.stringify(p) === JSON.stringify(current)) { speak(none); return; }
    change(pieces.map((x, i) => (i === at ? p : x)), at, words?.(p));
  };
  const takeOff = () => {
    if (at === null || !current || busy) return;
    change(renumber(pieces.filter((_, i) => i !== at)), null, `${nameOf(current.gear)} taken off.`);
    stage.current?.focus();
  };
  const reorder = (by: 1 | -1) => {
    if (at === null || !current || busy) return;
    const moved = layered(pieces, at, by);
    if (!moved) return;
    change(moved.pieces, moved.index, `${nameOf(current.gear)} is on layer ${moved.index + 1} of ${pieces.length}.`);
    /* The button that has just reached its end goes disabled; focus goes to the piece, not nowhere. */
    if (moved.index === 0 || moved.index === pieces.length - 1) setFocusSel(true);
  };

  const sizeWords = (p: Piece) => `${nameOf(p.gear)}: ${Math.round(p.w * 100)}% of the portrait's width.`;
  const turnWords = (p: Piece) => `${nameOf(p.gear)}: turned ${Math.round(p.turn)} degrees.`;
  const moves: Record<string, () => void> = {
    left: () => edit((p) => nudge(p, -STEP.move, 0), STUCK),
    right: () => edit((p) => nudge(p, STEP.move, 0), STUCK),
    up: () => edit((p) => nudge(p, 0, -STEP.move), STUCK),
    down: () => edit((p) => nudge(p, 0, STEP.move), STUCK),
    bigger: () => edit((p) => resized(p, STEP.size), "It's as big as it gets.", sizeWords),
    smaller: () => edit((p) => resized(p, -STEP.size), "It's as small as it gets.", sizeWords),
    turnRight: () => edit((p) => turned(p, STEP.turn), "It can't turn further that way.", turnWords),
    turnLeft: () => edit((p) => turned(p, -STEP.turn), "It can't turn further that way.", turnWords),
  };

  /** The keys of the selected piece, on its box and on the panel's buttons. */
  const keys = (e: KeyboardEvent<HTMLElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || current === null) return;
    const big = e.shiftKey ? STEP.moveBig : STEP.move;
    const arrow: Record<string, readonly [number, number]> = { ArrowLeft: [-big, 0], ArrowRight: [big, 0], ArrowUp: [0, -big], ArrowDown: [0, big] };
    const a = arrow[e.key];
    if (a) edit((p) => nudge(p, a[0], a[1]), STUCK);
    else if (e.key === '+' || e.key === '=') moves.bigger!();
    else if (e.key === '-' || e.key === '_') moves.smaller!();
    else if (e.key === ']') moves.turnRight!();
    else if (e.key === '[') moves.turnLeft!();
    else if (e.key === 'Delete') takeOff();
    else return;
    e.preventDefault();
  };

  /* The pointer: a drag on the stage moves the piece under it, a corner sizes the selected piece, the round handle turns it. */
  const point = (e: PointerEvent | DragEvent) => {
    const box = stage.current?.getBoundingClientRect();
    return box && box.width > 0 && box.height > 0 ? { x: e.clientX - box.left, y: e.clientY - box.top, w: box.width, h: box.height } : null;
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || busy) return;
    const p = point(e);
    if (!p) return;
    const handle = (e.target as HTMLElement).closest('[data-kb-handle]')?.getAttribute('data-kb-handle');
    let index = at;
    if (handle === undefined || handle === null) {
      index = hit(pieces, aspectOf, p.x, p.y, p.w, p.h);
      setAt(index);
      if (index === null) return;
      setFocusSel(true);
    }
    const start = index === null ? undefined : pieces[index];
    if (index === null || !start) return;
    const cx = start.x * p.w;
    const cy = start.y * p.h;
    drag.current = {
      mode: handle === 'size' ? 'size' : handle === 'turn' ? 'turn' : 'move', index, start, sx: p.x, sy: p.y,
      d0: Math.hypot(p.x - cx, p.y - cy), a0: (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI, dirty: latest.current.dirty,
    };
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const p = point(e);
    if (!d || !p || busy) return;
    const cx = d.start.x * p.w;
    const cy = d.start.y * p.h;
    const next = d.mode === 'move' ? dragged(d.start, p.x - d.sx, p.y - d.sy, p.w, p.h)
      : d.mode === 'size' ? dragSized(d.start, d.d0, Math.hypot(p.x - cx, p.y - cy))
        : dragTurned(d.start, d.a0, (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI);
    setPieces((was) => was.map((x, i) => (i === d.index ? next : x)));
    setDirty(true);
  };
  const up = () => { drag.current = null; };
  /* A drag the browser took away (a touch turned into a scroll, say) puts the piece back where the drag began. */
  const cancel = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    setPieces((was) => was.map((x, i) => (i === d.index ? d.start : x)));
    setDirty(d.dirty);
  };

  const dropped = (e: DragEvent<HTMLDivElement>) => {
    const key = e.dataTransfer.getData('text/plain');
    if (busy || !items.some((i) => i.gear === key)) return;
    e.preventDefault();
    const p = point(e);
    put(key, p ? { x: p.x / p.w, y: p.y / p.h } : undefined);
  };

  const chosen = items.find((i) => i.gear === gear) ?? items[0] ?? null;
  /* The carousel and the chosen panel read only which gear is worn here (not where), so a drag, which re-renders this page for every move, leaves them alone. */
  const putRef = useRef(put);
  putRef.current = put;
  const putGear = useCallback((key: string) => putRef.current(key), []);
  const wornKey = pieces.map((p) => p.gear).join(',');
  const whyChosen = chosen ? whyNot(chosen.gear) : null;
  const carousel = useMemo(() => (items.length === 0 ? null : (
    <Carousel
      role="radiogroup" label="Your gear" items={items.map((i) => ({ key: i.gear, i }))} value={chosen?.gear ?? null} onChange={setGear}
      renderItem={({ i }, { props, follow }) => {
        const s = standing(i);
        const ids = { name: `${group}-${i.gear}-name`, worn: `${group}-${i.gear}-worn` };
        return (
          <label
            key={i.gear} {...props} className="kb-wardrobe-card" data-kb-chosen={chosen?.gear === i.gear || undefined} data-kb-free={s.free > 0 || undefined}
            draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', i.gear); e.dataTransfer.effectAllowed = 'copy'; }}
          >
            <input
              type="radio" name={group} value={i.gear} className="kb-visually-hidden" checked={chosen?.gear === i.gear}
              aria-labelledby={ids.name} aria-describedby={ids.worn}
              onChange={() => { setGear(i.gear); follow(i.gear); }} onFocus={() => follow(i.gear)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); putGear(i.gear); } }}
            />
            <span className="kb-wardrobe-art" aria-hidden="true">{ui.gear[i.gear] && <img src={ui.gear[i.gear]!.art} alt="" draggable={false} />}</span>
            <span className="kb-wardrobe-rarity"><span className="kb-gem" aria-hidden="true" data-kb-rarity={i.rarity} data-kb-gem={gemOf(i.rarity)} /> <span>{rarityName(i.rarity)}</span></span>
            <b id={ids.name} className="kb-wardrobe-name">{nameOf(i.gear)}</b>
            <span id={ids.worn} className="kb-wardrobe-worn-line">{s.text}</span>
          </label>
        );
      }}
    />
  )),
  // eslint-disable-next-line react-hooks/exhaustive-deps -- standing() reads the pieces only for which gear is worn, which `wornKey` stands for
  [items, chosen?.gear, wornKey, id, name, group, ui, instance.gear, characters, putGear]);

  useEffect(() => {
    if (focusSel && current) { sel.current?.focus(); setFocusSel(false); }
  }, [focusSel, current]);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    speak('');
    try {
      const outfit = renumber(pieces);
      const answer = await api.setOutfit(id, outfit);
      if (!answer.ok) { setRefusal(answer.error); return; }
      setPieces(outfit);
      setDirty(false);
      speak('Outfit saved.');
      await reload();
    } catch {
      setRefusal('The outfit could not be saved. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const portrait = face?.avatarPortrait ?? null;
  if (face === null || portrait === null) {
    /* One region for the column, as the dressing's columns are one: the trophy choice's notes stand in the calm with the notice. */
    return (
      <CalmRegion>
        <p className="kb-notice">
          Gear is worn on a portrait. Upload one in <GlassLink to="/characters/edit" state={{ character: id }}>profile edit</GlassLink>.
        </p>
        <Trophies key={id} id={id} face={face} reload={reload} />
      </CalmRegion>
    );
  }
  const tallness = face.portraitTallness ?? tall ?? FALLBACK_TALLNESS;
  const gearName = (p: Piece) => nameOf(p.gear);
  const ctl = (name: string, label: string, key: string, glyph?: string) => (
    <button type="button" className="kb-wardrobe-ctl" aria-label={glyph ? name : undefined} onClick={moves[key]} disabled={current === null || busy}>
      {glyph ? <span aria-hidden="true">{glyph}</span> : label}
    </button>
  );
  const top = current !== null && at === pieces.length - 1;
  const bottom = current !== null && at === 0;

  return (
    <CalmRegion className="kb-wardrobe-columns" style={{ '--kb-reach': reach, '--kb-tallness': tallness } as CSSProperties}>
      <section className="kb-wardrobe-stage-col" aria-label="The portrait">
        <p className="kb-wardrobe-note">The dashed line is as far past the portrait as a piece may reach.</p>
        <div className="kb-wardrobe-room">
          <div
            ref={stage} className="kb-wardrobe-stage" role="group" tabIndex={-1} aria-label={`${name}'s portrait with its gear`}
            style={slotShape(face.portraitTallness ?? tall ?? null)}
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}
            onDragOver={(e) => { if (e.dataTransfer.types.includes('text/plain')) e.preventDefault(); }} onDrop={dropped}
          >
            <img src={portrait} alt="" draggable={false} onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth > 0) setTall(i.naturalHeight / i.naturalWidth); }} />
            <Outfit pieces={pieces} on="portrait" />
            <span className="kb-wardrobe-reach" aria-hidden="true" />
            {current && ui.gear[current.gear] && (
              <div
                ref={sel} className="kb-wardrobe-sel" tabIndex={0} role="group" onKeyDown={keys}
                aria-label={`${gearName(current)}, selected`} aria-describedby={help}
                style={{ left: `${Math.round(current.x * 1e6) / 1e4}%`, top: `${Math.round(current.y * 1e6) / 1e4}%`, width: `${Math.round(current.w * 1e6) / 1e4}%`, aspectRatio: `1 / ${aspectOf(current.gear)}`, transform: `translate(-50%, -50%) rotate(${current.turn}deg)` }}
              >
                <span id={help} className="kb-visually-hidden">Arrow keys move it, plus and minus size it, left and right brackets turn it, Delete takes it off.</span>
                {['nw', 'ne', 'sw', 'se'].map((c) => <span key={c} className="kb-wardrobe-handle" data-kb-handle="size" data-kb-corner={c} aria-hidden="true" />)}
                <span className="kb-wardrobe-handle kb-wardrobe-turn" data-kb-handle="turn" aria-hidden="true" />
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="kb-wardrobe-panels">
        <section className="kb-wardrobe-panel" aria-label="Selected piece" onKeyDown={(e: KeyboardEvent<HTMLElement>) => { const t = e.target as HTMLElement; if (t.tagName === 'BUTTON' && !t.closest('.kb-wardrobe-worn')) keys(e); }}>
          <h2 className="kb-wardrobe-label">{current ? `Selected · ${gearName(current)}` : 'Selected piece'}</h2>
          <div role="group" aria-label="Worn now"><ul className="kb-wardrobe-worn">
            {pieces.map((p, i) => (
              <li key={`${p.layer}-${i}`}>
                <button type="button" aria-pressed={i === at} onClick={() => { setAt(i); setFocusSel(true); }}>
                  <span className="kb-wardrobe-layer">Layer {i + 1}</span> {gearName(p)}
                </button>
              </li>
            ))}
          </ul></div>
          {pieces.length === 0 && <p className="kb-wardrobe-note">Nothing is worn. Drag a piece from the wardrobe onto the portrait, or press Enter on it.</p>}
          {current === null && pieces.length > 0 && <p className="kb-wardrobe-note">Choose a piece on the portrait, or in Worn now, to move it.</p>}
          <p className="kb-wardrobe-note">Drag it, pull a corner to size it, or turn it by the round handle. The same moves from the keyboard and the buttons:</p>
          <div className="kb-wardrobe-controls">
            {ctl('Move left', '', 'left', '←')}{ctl('Move up', '', 'up', '↑')}{ctl('Move down', '', 'down', '↓')}{ctl('Move right', '', 'right', '→')}
            {ctl('Bigger', 'Bigger', 'bigger')}{ctl('Smaller', 'Smaller', 'smaller')}
            <button type="button" className="kb-wardrobe-ctl" onClick={moves.turnLeft} disabled={current === null || busy}>Turn left <span aria-hidden="true">↺</span></button>
            <button type="button" className="kb-wardrobe-ctl" onClick={moves.turnRight} disabled={current === null || busy}>Turn right <span aria-hidden="true">↻</span></button>
            <button type="button" className="kb-wardrobe-ctl kb-wardrobe-wide" disabled={current === null || top || busy} onClick={() => reorder(1)}>Bring forward</button>
            <button type="button" className="kb-wardrobe-ctl kb-wardrobe-wide" disabled={current === null || bottom || busy} onClick={() => reorder(-1)}>Send back</button>
          </div>
          <ButtonRow><GlassButton onClick={takeOff} disabled={current === null || busy}>Take it off</GlassButton></ButtonRow>
        </section>

        <section className="kb-wardrobe-panel" aria-label="On the square">
          <h2 className="kb-wardrobe-label">On the square</h2>
          <div className="kb-wardrobe-square-row">
            <span className="kb-wardrobe-square" aria-hidden="true">
              {face.avatarSquare && <img src={face.avatarSquare} alt="" draggable={false} />}
              <Outfit pieces={pieces} on="square" frame={face.squareFrame} />
            </span>
            <p className="kb-wardrobe-note">The same outfit through the square&apos;s frame, cut at the square&apos;s edge. A piece below or beside the square shows only on the tall portrait.</p>
          </div>
        </section>

        <p className="kb-wardrobe-note">{pieces.length} of {most} pieces worn. A new portrait takes all of them off; recropping the square keeps them.{dirty ? ` You have changes not saved yet. Your changes to ${name} are kept until you save or leave this page.` : ''}</p>
        <ButtonRow><GlassButton kind="primary" busy={busy} onClick={() => void save()}>Save the outfit</GlassButton></ButtonRow>
        <div role="status" aria-label="Outfit messages" className="kb-wardrobe-say"><span key={sayN}>{say}</span></div>
        {refusal !== null && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}

        <Trophies key={id} id={id} face={face} reload={reload} />
      </div>

      <section className="kb-wardrobe-wardrobe" aria-label="The wardrobe">
        <div className="kb-wardrobe-wardrobe-head">
          <h2 className="kb-wardrobe-title kb-glass-display">The wardrobe</h2>
          <span className="kb-wardrobe-note">Drag a piece onto the portrait, or press Enter on it.</span>
        </div>
        {items.length === 0 ? (
          <CalmRegion as="p" className="kb-notice">You hold no gear yet. It turns up in Random Events, and an admin may grant it.</CalmRegion>
        ) : (
          <>
            {carousel}
            {chosen && <ChosenPanel item={chosen} name={nameOf(chosen.gear)} line={rules(chosen.gear)?.line ?? ''} mask={name} why={whyChosen} gear={chosen.gear} put={putGear} />}
          </>
        )}
      </section>
    </CalmRegion>
  );
}

const ChosenPanel = memo(function ChosenPanel({ item, name, line, mask, why, gear, put }: { readonly item: WardrobeItem; readonly name: string; readonly line: string; readonly mask: string; readonly why: string | null; readonly gear: string; readonly put: (gear: string) => void }) {
  const reason = useId();
  return (
    <section className="kb-wardrobe-panel" aria-label={`${name}, in detail`}>
      <h3 className="kb-wardrobe-label">{name} · {rarityName(item.rarity)}</h3>
      {line !== '' && <p className="kb-wardrobe-line">{line}</p>}
      {why !== null && <p id={reason} className="kb-wardrobe-note">{why}</p>}
      <ButtonRow>
        <GlassButton aria-disabled={why !== null} aria-describedby={why !== null ? reason : undefined} onClick={() => { if (why === null) put(gear); }}>Put it on {mask}</GlassButton>
      </ButtonRow>
    </section>
  );
});

/** The awards a mask can show on its posts: up to the most checked, saved with the awards' own button; a belt held shows without being chosen. */
const Trophies = memo(function Trophies({ id, face, reload }: { readonly id: Id; readonly face: Character | null; readonly reload: () => Promise<void> }) {
  const { api, instance } = useKayfa();
  const most = instance.settings.cosmetics.trophies.shownMost;
  const [page, setPage] = useState<{ readonly awards: readonly TrophyItem[]; readonly more: boolean } | null>(null);
  const [chosen, setChosen] = useState<readonly Id[]>(() => (face?.trophies ?? []).filter((t: ShownTrophy) => !(t.belt && t.held)).map((t) => t.award));
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saved, setSaved] = useState('');
  useEffect(() => {
    let live = true;
    void api.trophies(id).then((p) => { if (live) setPage(p); }, () => { if (live) setPage({ awards: [], more: false }); });
    return () => { live = false; };
  }, [api, id]);

  const toggle = (award: Id) => {
    setSaved('');
    setChosen((was) => (was.includes(award) ? was.filter((a) => a !== award) : was.length < most ? [...was, award] : was));
  };
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    setSaved('');
    try {
      const answer = await api.showTrophies(id, chosen);
      if (!answer.ok) setRefusal(answer.error);
      else { setSaved(`${answer.value.shown === 1 ? '1 trophy' : `${answer.value.shown} trophies`} shown on posts.`); await reload(); }
    } catch {
      setRefusal('The choice could not be saved. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const choices = (page?.awards ?? []).filter((a) => !(a.belt && a.held));
  const belts = (page?.awards ?? []).filter((a) => a.belt && a.held);
  return (
    <section className="kb-wardrobe-panel" aria-label="Trophies on posts">
      <h2 className="kb-wardrobe-label">Shown on posts</h2>
      {page === null ? <p className="kb-wardrobe-note" aria-busy="true">Loading the trophies.</p> : page.awards.length === 0 ? <p className="kb-wardrobe-note">No trophies yet.</p> : (
        <>
          <p className="kb-wardrobe-note">{chosen.length} of {most} checked. A belt held shows on its own, and is not a choice.</p>
          <fieldset className="kb-wardrobe-trophies" aria-label="Shown on posts">
            {choices.map((a) => (
              <label key={a.award} className="kb-wardrobe-trophy">
                <input type="checkbox" checked={chosen.includes(a.award)} disabled={!chosen.includes(a.award) && chosen.length >= most} onChange={() => toggle(a.award)} />
                <span>{a.name}</span>
              </label>
            ))}
          </fieldset>
          {belts.length > 0 && <p className="kb-wardrobe-note">Always shown: {belts.map((b) => b.name).join(', ')}.</p>}
          {page.more && <p className="kb-wardrobe-note">Only the newest awards are listed here.</p>}
          <ButtonRow><GlassButton busy={busy} onClick={() => void save()}>Save shown trophies</GlassButton></ButtonRow>
        </>
      )}
      <div role="status" aria-label="Trophy messages" className="kb-wardrobe-say">{saved}</div>
      {refusal !== null && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}
    </section>
  );
});

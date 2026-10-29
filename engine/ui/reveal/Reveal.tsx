/**
 * The two posts The System writes about the characters: the tally of each settlement (its night's
 * debuts and announced Turns) and the season's reveal (a post for each character). Both are
 * The System's own words and are in character; the rest of a thread's Act (reactions, Spin) is
 * drawn around them by the thread.
 *
 * The reveal shows each character's place, rank and standing, and only what its player made
 * public: a bar of the classes it stated (in the instance's class looks, a pattern as well as a
 * color), and every announced Turn. It never shows a class its player did not state, and no
 * timeline of the classes it was. The bar is one equal segment for each statement, so its width
 * says nothing; its accessible description lists each class and its dates in words.
 */
import type { CSSProperties } from 'react';
import { useKayfa } from '../context.tsx';
import type { Act } from '../data/api.ts';
import { rankIndex } from '../../rules/ranks.ts';
import { figure } from '../characters/format.ts';
import { Pips } from '../postbit/Postbit.tsx';
import { shortDate } from '../postbit/dates.ts';
import { Link } from '../router.tsx';
import { BbCode } from '../bbcode/render.tsx';
import { statements, wording } from './statements.ts';
import './reveal.css';

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const rows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null) : []);
const whole = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function useClassName() {
  const { instance } = useKayfa();
  return (key: string) => instance.classes.find((c) => c.key === key)?.name ?? key;
}

/** A character's name, linked to its public profile. */
function Who({ id, name }: { readonly id: unknown; readonly name: string }) {
  return typeof id === 'string' && id !== '' ? <Link to={`/c/${encodeURIComponent(id)}`}>{name}</Link> : <>{name}</>;
}

/** The lines of a tally: who debuted and who has Turned, in the order the Act names them (null when it names no one). */
export function Debuts({ payload }: { readonly payload: Act['payload'] }) {
  const className = useClassName();
  const debuts = rows(payload.debuts);
  const turns = rows(payload.turns);
  const cls = (k: unknown) => (typeof k === 'string' && k !== '' ? className(k) : null);
  if (debuts.length === 0 && turns.length === 0) return null;
  return (
    <ul className="kb-system-list">
      {debuts.map((d, i) => (
        <li key={`d${i}`}><Who id={d.character} name={text(d.name) || 'A character'} /> debuts{cls(d.class) ? ` as ${cls(d.class)}` : ''}</li>
      ))}
      {turns.map((t, i) => (
        <li key={`t${i}`}>
          <Who id={t.character} name={text(t.name) || 'A character'} /> has Turned{cls(t.was) ? ` from ${cls(t.was)}` : ''}{cls(t.class) ? ` to ${cls(t.class)}` : ''}
        </li>
      ))}
    </ul>
  );
}

/** A settlement's tally: The System's words, and who debuted tonight and who has Turned. */
export function TallyPost({ act }: { readonly act: Act }) {
  const payload = act.currentPayload;
  const body = text(payload.body);
  const part = whole(payload.part);
  const of = whole(payload.of);
  return (
    <section className="kb-tally-post kb-system-post" aria-label="The tally">
      {body && <BbCode text={body} />}
      {part !== null && of !== null && of > 1 && <p className="kb-small kb-muted">Part {part} of {of}</p>}
      <Debuts payload={payload} />
    </section>
  );
}

/** The bar of the classes a player stated: one segment each, in the instance's look for the class. */
function ClassBar({ shown }: { readonly shown: ReturnType<typeof statements> }) {
  const { ui } = useKayfa();
  const className = useClassName();
  const named = shown.filter((s) => s.class !== null);
  if (named.length === 0) return null;
  const description = `Classes its player made public: ${shown.map((s) => wording(s, className)).join('; ')}.`;
  return (
    <div className="kb-class-bar" role="img" aria-label={description}>
      {named.map((s, i) => {
        const look = ui.classLooks[s.class!];
        const style: CSSProperties = { backgroundColor: look?.color, backgroundImage: look?.pattern };
        return (
          <span key={i} className="kb-class-segment" data-kb-class={s.class} style={style}>
            <span className="kb-class-label" aria-hidden="true">{className(s.class!)}</span>
          </span>
        );
      })}
    </div>
  );
}

/** The season's reveal: its opening words, or one character's post. */
export function RevealPost({ act }: { readonly act: Act }) {
  const { instance, ui } = useKayfa();
  const className = useClassName();
  const payload = act.currentPayload;
  const body = text(payload.body);
  const id = typeof payload.character === 'string' ? payload.character : null;
  if (id === null) {
    return (
      <div className="kb-reveal-post kb-system-post">
        {body ? <BbCode text={body} /> : <p>The season’s reveal.</p>}
      </div>
    );
  }
  const name = text(payload.name) || 'A character';
  const place = whole(payload.place);
  const standing = whole(payload.standing);
  const index = rankIndex(instance.ranks, standing);
  const rank = instance.ranks[index]?.name ?? '';
  const pips = ui.pips?.default;
  const shown = statements(payload.shown);
  const turns = shown.filter((s) => s.kind === 'turn');
  return (
    <section className="kb-reveal-post kb-system-post" aria-label={`${name} in the season's reveal`}>
      <p className="kb-reveal-line">
        <b className="kb-reveal-name"><Who id={id} name={name} /></b>
        {place !== null && <>: finished #{place}</>}
        {rank && <>, <b>{rank}</b>{' '}<Pips ranks={instance.ranks.length} index={index} name={rank} style={pips} /></>}
        {standing !== null && <>, {figure(standing)}</>}.
      </p>
      <ClassBar shown={shown} />
      {shown.length === 0
        ? <p className="kb-small kb-muted">Its player made nothing about its class public.</p>
        : (
          <ul className="kb-reveal-stated kb-small">
            {shown.filter((s) => s.kind === 'reveal' || s.class !== null).map((s, i) => <li key={`s${i}`}>{wording(s, className).replace(/^./u, (c) => c.toUpperCase())}</li>)}
            {turns.map((s, i) => <li key={`t${i}`}>Announced a Turn on {shortDate(s.at)}</li>)}
          </ul>
        )}
    </section>
  );
}

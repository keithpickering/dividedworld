/**
 * The point picker of a rewind card's play form (Time Machine design, 4.1): a radio group of the points `rewindPoints` offers for the post, read from its History (`api.history`) and the plays the page holds,
 * each named for the post as first posted or for an edit, in the reader's time zone, with the first words of that version beneath. It sets `{ to }`. Where no point is offered it says so, and the form's play
 * stays off, since `{}` is no point (`rewindConfig`). The server decides again (`rewind_point_problem`); this offers what it will accept. Plain and true, out of character.
 */
import { useEffect, useMemo, useState } from 'react';
import { rewindPoints, type RewindPoint } from '../../rules/rewind.ts';
import { dayAndTime } from '../characters/format.ts';
import { useKayfa } from '../context.tsx';
import type { Act, Id } from '../data/api.ts';
import { REWIND_LEGEND, REWIND_NOTHING, pointWords } from './lens-words.ts';
import { playOver, shownPlays, usePlays, type Plays } from './plays.ts';

/** How much of a version's words is said beneath its point. */
export const PREVIEW_MOST = 80;

const preview = (version: Act | undefined): string => {
  if (version === undefined || version.payloadHidden === true || version.hidden === true || version.payloadConcealing === true) return '';
  const body = version.payload.body;
  return typeof body === 'string' ? Array.from(body.replace(/\s+/gu, ' ').trim()).slice(0, PREVIEW_MOST).join('') : '';
};

export function RewindPoints({ post, plays, config, onChange, id }: {
  readonly post: Act; readonly plays: Plays; readonly id: string;
  readonly config: Readonly<Record<string, unknown>> | undefined;
  readonly onChange: (config: Readonly<Record<string, unknown>>) => void;
}) {
  const { api, instance, settings } = useKayfa();
  const [versions, setVersions] = useState<readonly Act[] | null | 'failed'>(null);
  const home = usePlays(plays, post.id);
  /* The History is read once for the post, and again when the post is edited (its edited time changes) while the form is open. */
  useEffect(() => {
    let live = true;
    api.history(post.id).then((v) => { if (live) setVersions(v); }, () => { if (live) setVersions('failed'); });
    return () => { live = false; };
  }, [api, post.id, post.editedAt]);
  const points = useMemo((): readonly RewindPoint[] => {
    if (!Array.isArray(versions) || versions.length === 0) return [];
    const [first, ...edits] = versions as readonly Act[];
    const now = api.now();
    const keeps = new Set(instance.cards.filter((c) => c.keeps === true).map((c) => c.key));
    /* A play shows when it is a face-up play on the post (not beyond it) that is not over, as the server reads play_post. */
    const showing = new Set(shownPlays(home.plays, now).filter((p) => !p.faceDown && !p.reach && !playOver(p, now, keeps)).map((p) => p.id));
    const played = home.plays.map((p) => ({ id: p.id, at: p.playedAt }));
    return rewindPoints({ id: first!.id, at: first!.createdAt }, edits.map((e) => ({ id: e.id, at: e.createdAt })), played, settings.editGrace, new Date(now), (p) => showing.has(p.id));
  }, [versions, home.plays, api, instance.cards, settings.editGrace]);
  const chosen = typeof config?.to === 'string' ? config.to : null;
  /* A point that stopped being offered (a play ended meanwhile) is let go, so the play is never sent for a point the server would refuse. */
  useEffect(() => { if (chosen !== null && Array.isArray(versions) && !points.some((p) => p.version === chosen)) onChange({}); }, [chosen, points, versions, onChange]);
  if (versions === null) return <p className="kb-play-fine" aria-busy="true">Loading the History…</p>;
  if (versions === 'failed') return <p className="kb-play-fine" role="alert">The History could not be loaded, so no point can be offered. Close this and try again.</p>;
  if (points.length === 0) return <p className="kb-play-fine" role="status">{REWIND_NOTHING}</p>;
  const byId = new Map<Id, Act>(versions.map((v) => [v.id, v]));
  return (
    <fieldset role="radiogroup" className="kb-play-choice kb-play-points">
      <legend className="kb-play-label">{REWIND_LEGEND}</legend>
      <div className="kb-play-points-list">
        {points.map((p) => (
          <label key={p.version} className="kb-play-point">
            <input type="radio" name={`${id}-point`} checked={chosen === p.version} onChange={() => onChange({ to: p.version })} />
            <span className="kb-play-point-name">{pointWords(p.first, dayAndTime(p.at))}</span>
            {preview(byId.get(p.version)) !== '' && <span className="kb-play-fine kb-play-point-words">{preview(byId.get(p.version))}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

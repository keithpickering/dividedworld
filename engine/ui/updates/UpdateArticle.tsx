/**
 * An update as the Updates page draws it (the backfill boards plan, Task 12): the chamfered panel with the persona's mark, name and tagline, the
 * headline, the date, the prose and the plain "What changed" list, and under them whatever `children` the caller adds. The Updates page's open update
 * is this with its reactions and Spin a thread as children; Write an update's "What everyone will see" is this given the form's values and no
 * children, so what an admin sees there is the component the players will see, drawn from what is typed and never saved or sent.
 *
 * It reads nothing but the instance's avatars and sends nothing: the reactions, which read and write, are the page's children. An update with no
 * readable time shows none (a preview has none yet), and one with no title shows no headline.
 */
import { useId, type ReactNode } from 'react';
import { useKayfa } from '../context.tsx';
import type { Update } from '../data/api.ts';
import { PersonaMark } from './Persona.tsx';
import { utcStamp } from './time.ts';
import { ChangedList, Prose } from './UpdateWords.tsx';
import './updates.css';

/** What the article draws of an update: the persona, the words and the time. */
export type UpdateFace = Pick<Update, 'name' | 'tagline' | 'avatar' | 'title' | 'body' | 'changes' | 'at'>;

/** The headline's level: 2 on the Updates page; a preview under a heading of its own sets it one below that heading's. "What changed" is one below the headline. */
export type HeadingLevel = 2 | 3 | 4 | 5;

export function UpdateArticle({ update, children, level = 2 }: { readonly update: UpdateFace; readonly children?: ReactNode; readonly level?: HeadingLevel }) {
  const Headline = `h${level}` as 'h2' | 'h3' | 'h4' | 'h5';
  const Changed = `h${level + 1}` as 'h3' | 'h4' | 'h5' | 'h6';
  const { ui } = useKayfa();
  const headline = useId();
  const picture = update.avatar === null ? undefined : ui.avatars?.[update.avatar];
  const stamp = utcStamp(update.at);
  return (
    <article className="kb-glass-cut-dialog kb-updates-post" aria-labelledby={update.title === '' ? undefined : headline}>
      <div className="kb-updates-by">
        <PersonaMark name={update.name} picture={picture} />
        <div>
          <b className="kb-updates-name">{update.name}</b>
          {update.tagline !== '' && <span className="kb-updates-tagline">{update.tagline}</span>}
        </div>
      </div>
      {update.title !== '' && <Headline id={headline} className="kb-updates-headline kb-glass-display">{update.title}</Headline>}
      {stamp !== '' && <time className="kb-updates-time" dateTime={update.at}>{stamp}</time>}
      <Prose body={update.body} />
      {update.changes.length > 0 && (
        <>
          <Changed className="kb-updates-changed">What changed</Changed>
          <ChangedList changes={update.changes} />
        </>
      )}
      {children}
    </article>
  );
}

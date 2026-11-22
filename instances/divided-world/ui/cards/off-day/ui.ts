/** Off Day's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { ConfigForm as OffDayConfigForm } from '../../../cards/off-day/ConfigForm.tsx';
import { offDay } from '../../../cards/off-day.ts';
import { utcWhen } from '../../../../../engine/ui/log/lines.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import offDayCanvas from './art.webp?url';
import offDayMark from './mark.svg?url';
import offDayArt from './art.json';
import { classWords, setMoveWords } from '../words.ts';

export const ui: CardUi = {
  key: 'off-day',
  art: { color: '#ff3d7f', ink: '#14030a', canvas: offDayCanvas, mark: offDayMark, credit: offDayArt.credit, tagline: 'Give a character somebody else\'s day.' },
  summary: 'Cast on a character, naming a class. From the next settlement to the one after, that character scores as that class.',
  /* The window in force now, if one is; else the next one named. A play is checked with no record, so it never assumes a class or a time. */
  status: (plays) => {
    const now = Date.now();
    const open = plays.find((p) => p.starts !== undefined && Date.parse(p.starts) <= now);
    const named = open ?? plays.find((p) => p.starts !== undefined) ?? plays[0];
    const as = classWords(named?.config) ?? 'another class';
    return open !== undefined ? `Scoring as ${as} now` : `Scores as ${as} next window`;
  },
  hint: 'An Off Day makes a character score as another class for one settlement window.',
  ConfigForm: OffDayConfigForm,
  describe: (settings: Settings) =>
    `A Salty card, ${offDay.rarity}, cast from any post by the character it lands on. You name a class, and everyone can see which. From the next settlement until the one after it, that character is scored as that class, whatever its own. Its own class does not change, no Turn is used and its Turn cooldown is untouched. You are never told whether it made a difference; the character's player is told exactly what happened. A character takes one Off Day for each window. ${setMoveWords("the quoting post's character")} It costs nothing more to play.`,
  /* The window is the one the server recorded with the play, in UTC, as the log says its times. */
  logPlay: (config, { starts, ends }) => {
    const as = classWords(config);
    return as === undefined || starts === undefined || ends === undefined ? undefined
      : `From the settlement of ${utcWhen(starts)} UTC to the settlement of ${utcWhen(ends)} UTC, that character scores as ${as}. Its own class does not change, no Turn is used, and its Turn cooldown is untouched.`;
  },
};

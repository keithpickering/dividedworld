/**
 * The instance's compiled settings, as the screens read them: what a key the database does not hold
 * yet falls back to (an instance seeded before 0030_screens_reads.sql has no postsPerPage or
 * hotReplies until it is seeded again).
 */
import type { ScreenSettings } from '../../../engine/ui/data/api.ts';
import { defaults } from '../../../instances/divided-world/settings.ts';
import { system } from '../../../instances/divided-world/system/index.ts';
import { groups } from '../../../instances/divided-world/groups.ts';

export const fallbackSettings: ScreenSettings = Object.freeze({
  postsPerPage: defaults.postsPerPage,
  hotReplies: defaults.hotReplies,
  editGrace: defaults.editGrace,
  reactionCap: defaults.reactionCap,
  charactersPerPlayer: defaults.charactersPerPlayer,
  invitesPerPlayer: defaults.invitesPerPlayer,
  inviteLifetime: defaults.inviteLifetime,
  turnCooldown: defaults.turnCooldown,
  walletCap: defaults.walletCap,
  postMaxLength: defaults.postMaxLength,
  titleMaxLength: defaults.titleMaxLength,
  registrationMode: defaults.registrationMode,
  settlementLength: defaults.settlementLength,
  cardSettings: defaults.cardSettings,
  presencePollSeconds: defaults.presencePollSeconds,
  presenceWindow: defaults.presenceWindow,
  toastDefaults: defaults.toastDefaults,
  /* The groups' looks are the instance's too; the database holds them in group_kinds once seeded (0116 shows them to the screens). */
  groups: [...groups.ladder.map((g) => ({ key: g.key, name: g.name, color: g.color, stripe: g.stripe === true, staff: g.when.kind === 'staff' })), ...groups.conferred.map((g) => ({ key: g.key, name: g.name, color: g.color, stripe: g.stripe === true, staff: false }))],
  /* None held: every price is the compiled economy's until the view says otherwise. */
  cardEconomy: {},
  /* None held: every class's numbers are the compiled economy's until the view says otherwise. */
  economy: {},
});

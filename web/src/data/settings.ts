/**
 * The instance's compiled settings, as the screens read them: what a key the database does not hold
 * yet falls back to (an instance seeded before 0030_screens_reads.sql has no postsPerPage or
 * hotReplies until it is seeded again).
 */
import type { ScreenSettings } from '../../../engine/ui/data/api.ts';
import { ENGINE_DEFAULT_PRONOUNS } from '../../../engine/rules/pronouns.ts';
import { defaults } from '../../../instances/divided-world/settings.ts';
import { system } from '../../../instances/divided-world/system/index.ts';

export const fallbackSettings: ScreenSettings = Object.freeze({
  postsPerPage: defaults.postsPerPage,
  searchLanguage: defaults.searchLanguage,
  searchRankPool: defaults.searchRankPool,
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
  /* Until the view holds the setting pronouns, a new character starts on the engine's it/its. */
  pronouns: ENGINE_DEFAULT_PRONOUNS,
  /* The group's name is the instance's; the database holds it as the setting staffGroup once seeded (0084 shows it to the screens). */
  staffGroup: { name: system.staffGroup.name },
  /* None held: every price is the compiled economy's until the view says otherwise. */
  cardEconomy: {},
  /* None held: every class's numbers are the compiled economy's until the view says otherwise. */
  economy: {},
});

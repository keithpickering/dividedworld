/**
 * The words the old-voice scrubber refuses (engine/system/scrub.ts). A persona on the old voice writes with a 2019 to 2021
 * base model, whose raw output no one has tuned; this blocklist keeps a slur from reaching the forum. A hit is
 * answered once more, and a second hit is a rejected pick that files nothing.
 *
 * The build session compiled this starting list from common slur lists; the owner reviews it in the PR, and admins edit it
 * later as they edit `realWorld`. Lower case only (the scrubber folds case and letter-for-digit swaps on the text).
 * An entry matches whole words. Words with a common innocent meaning on a video-game forum are left out on purpose,
 * since a false positive costs a player a refund; a plural that would not match as a whole word is listed too.
 */
export const scrubWords: readonly string[] = Object.freeze([
  // Race and ethnicity
  'nigger', 'niggers', 'nigga', 'niggas', 'coon', 'coons', 'darkie', 'darkies',
  'chink', 'chinks', 'gook', 'gooks', 'jap', 'japs', 'slanteye', 'slant eye',
  'spic', 'spics', 'spick', 'wetback', 'wetbacks', 'beaner', 'beaners',
  'paki', 'pakis', 'raghead', 'ragheads', 'towelhead', 'towelheads', 'sandnigger', 'sand nigger',
  'kike', 'kikes', 'heeb', 'heebs', 'redskin', 'redskins', 'injun',
  'zipperhead', 'zipperheads', 'chinaman', 'jigaboo', 'porch monkey', 'white trash',
  // Religion
  'christ killer', 'christ killers', 'muzzie', 'muzzies',
  // Sexuality, gender identity
  'faggot', 'faggots', 'fag', 'fags', 'dyke', 'dykes', 'tranny', 'trannies', 'shemale', 'shemales',
  'sodomite', 'sodomites',
  // Disability
  'retard', 'retards', 'retarded', 'spastic', 'spastics', 'spaz', 'mongoloid', 'mongoloids',
]);

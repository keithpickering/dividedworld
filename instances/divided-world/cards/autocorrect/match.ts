/**
 * Autocorrect's phrase matcher, shared by its rules (the server prices and refuses by it) and its effect (the screens lay a strip
 * on each occurrence), so both agree on what an occurrence is. It reads a post's visible text (engine/bbcode/visible.ts), never
 * its BBCode, so a match may cross formatting and never reaches into a quote, code, a link or an image, and its offsets are the
 * ones the renderer's text layers take (the Autocorrect design, section 1).
 *
 * Whole words in any case: an occurrence is the phrase, case-folded, with no letter or digit (any script's) just before or just
 * after it, so "cats" covers "Cats." and "CATS" and never "concatenate". Occurrences are found left to right and never overlap. A
 * phrase with no letter or digit in it matches nothing; its rules refuse one anyway. The work is one regular-expression pass over
 * the text, linear in its length.
 */

// The finder itself lives in the engine (engine/bbcode/phrase.ts), unchanged, because the database asks the same question of a post
// (`phrase_in`, supabase/migrations/0142_face_down_moves.sql) and the two are held together by one list of fixtures. Autocorrect imports it
// through here so its rules, its screens and its effect keep one place to look.
export { occurrences, sameWords, type Occurrence } from '../../../../engine/bbcode/phrase.ts';

/**
 * The instance's vocabulary and numbers, in the shape seed_instance()
 * (supabase/migrations/0004_schedule.sql) writes: how an instance's classes, reactions, cards,
 * settings and boards arrive in a database whose SQL names none of them. Staff arrive as a roster of
 * characters only; their prompts are read from the instance in code and never travel in the seed.
 * The reactions list is the instance's whole set: seeding deletes a kind the instance dropped, or refuses when one is in
 * use (supabase/migrations/0091_seed_reaction_kinds.sql).
 */
import type { Instance } from '../../../engine/rules/types.ts';
import { DEFAULT_DEVELOPER } from '../../../engine/rules/instance.ts';
import { MOVE_KINDS } from '../../../engine/system/moves.ts';
import { BBCODE_TAGS } from '../../../engine/bbcode/parse.ts';
import { PREDICATES } from '../../../engine/rules/predicates.ts';
import { DEMAND_KINDS } from '../../../engine/system/demands.ts';

export function instanceSeed(instance: Instance) {
  const dev = instance.developer ?? DEFAULT_DEVELOPER;
  return {
    // The System's words travel as one setting, read by the SQL that posts them (0007).
    // The tick (0048) reads the stock lines and the moves' plain words from settings, so SQL names no instance and no kind.
    settings: {
      ...instance.settings, copy: instance.copy,
      systemLines: instance.system.stockLines,
      systemMoveWords: Object.fromEntries(MOVE_KINDS.map((m) => [m.key, m.plain])),
    } as Record<string, unknown>,
    classes: instance.classes.map((c) => ({ key: c.key, name: c.name })),
    reactions: instance.reactions.map((r) => ({ key: r.key, emoji: r.emoji, quadrant: r.quadrant })),
    // What each card's price reads beside its priceKey, by name, so screen_settings can hand the screens those numbers too (0039).
    cards: instance.cards.map((c) => ({
      key: c.key, name: c.name, alignment: c.alignment, priceSetting: c.priceKey, stack: c.stack ?? 1, seeded: c.seeded === true,
      reads: (c.reads ?? []).map((r) => (typeof r === 'string' ? r : r.key)),
      // How it is played and how rare it is, and a Set card's trap, a Use card's ward and time up (0054), which seed_instance
      // checks as instanceProblems does. A trap or a time up left out travels as none.
      rarity: c.rarity, play: c.play ?? 'cast', trap: c.trap, ward: c.ward === true, lasts: c.lasts,
      // Where it reaches and whether a thread play of it pins (0055), which seed_instance checks against reachRarity and reachLasts.
      reaches: c.reaches ?? ['post'], pins: c.pins === true,
    })),
    // The developer persona (0062): the instance's, else the engine's plain one. It is not in `system`, which a model reads, and its tagline is its
    // profile title. seed_instance makes the character and the updates thread from it; `avatar` is a key the UI turns into a picture.
    developer: { name: dev.name, title: dev.tagline, ...(dev.avatar !== undefined ? { avatar: dev.avatar } : {}) },
    boards: instance.boards.map((b) => ({ slug: b.slug, name: b.name, description: b.description, system: b.system === true })),
    pipStyles: instance.pipStyles.map((p) => ({ key: p.key, name: p.name, full: p.full, empty: p.empty })),
    // The roster as characters (0043): a Boss or a Mod Bot, once each, with the profile its title and signature give. The
    // prompts stay in the instance module; the meeting reads them in code (chooseInstance), so they are not seeded.
    system: {
      staff: [
        // Every persona alike; seed_instance (0082) debuts the first Boss and the first staff and leaves the rest waiting.
        // `beats` are the slugs of the kinds of board a persona likes to watch (0101): beat_of falls back to them for a board no Mod's order names.
        ...instance.system.roster.map((p) => ({ key: p.key, name: p.name, title: p.title, signature: p.signature, beats: [...p.beats] })),
      ],
      firstStaff: [...instance.system.firstStaff],
      // The member group every staff character is in, named by the instance.
      staffGroup: { name: instance.system.staffGroup.name },
      // The first season's Boss, set on an open season that has none (0047).
      firstBoss: instance.system.firstBoss,
      // The thread on The System's board where moves land and end, made once (0048).
      announcementsTitle: instance.system.announcementsTitle,
      // The engine's catalogs of moves and demands (0046), so SQL and TypeScript read one list. This file is the composition
      // root: the engine names no instance, and the SQL names no kind of its own.
      moves: MOVE_KINDS.map((m) => ({ key: m.key, structural: m.structural, shapesBoard: m.shapesBoard, offices: [...m.offices] })),
      // The rule predicates (0100): the keys `rule_breaks` has a branch for, the kind and bounds of each parameter, and the rule in plain
      // words with `{param}` where the parameter goes (`system_line` fills it).
      predicates: PREDICATES.map((p) => ({ key: p.key, param: p.param, least: p.bounds?.least ?? null, most: p.bounds?.most ?? null, plain: p.plain('{param}'), ...(p.param === 'tag' ? { tags: [...BBCODE_TAGS] } : {}) })),
      demands: DEMAND_KINDS.map((d) => ({ key: d.key })),
    },
  };
}

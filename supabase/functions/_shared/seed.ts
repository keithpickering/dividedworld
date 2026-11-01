/**
 * The instance's vocabulary and numbers, in the shape seed_instance()
 * (supabase/migrations/0004_schedule.sql) writes: how an instance's classes, reactions, cards,
 * settings and boards arrive in a database whose SQL names none of them. Staff arrive as a roster of
 * characters only; their prompts are read from the instance in code and never travel in the seed.
 */
import type { Instance } from '../../../engine/rules/types.ts';
import { MOVE_KINDS } from '../../../engine/system/moves.ts';
import { DEMAND_KINDS } from '../../../engine/system/demands.ts';

export function instanceSeed(instance: Instance) {
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
    })),
    boards: instance.boards.map((b) => ({ slug: b.slug, name: b.name, description: b.description, system: b.system === true })),
    pipStyles: instance.pipStyles.map((p) => ({ key: p.key, name: p.name, full: p.full, empty: p.empty })),
    // The roster as characters (0043): a Boss or a Mod Bot, once each, with the profile its title and signature give. The
    // prompts stay in the instance module; the meeting reads them in code (chooseInstance), so they are not seeded.
    system: {
      staff: [
        ...instance.system.bosses.map((b) => ({ key: b.key, name: b.name, title: b.title, signature: b.signature, kind: 'boss' as const })),
        ...instance.system.modBots.map((b) => ({ key: b.key, name: b.name, title: b.title, signature: b.signature, kind: 'bot' as const })),
      ],
      firstStaff: [...instance.system.firstStaff],
      // The first season's Boss, set on an open season that has none (0047).
      firstBoss: instance.system.firstBoss,
      // The thread on The System's board where moves land and end, made once (0048).
      announcementsTitle: instance.system.announcementsTitle,
      // The engine's catalogs of moves and demands (0046), so SQL and TypeScript read one list. This file is the composition
      // root: the engine names no instance, and the SQL names no kind of its own.
      moves: MOVE_KINDS.map((m) => ({ key: m.key, structural: m.structural, shapesBoard: m.shapesBoard })),
      demands: DEMAND_KINDS.map((d) => ({ key: d.key })),
    },
  };
}

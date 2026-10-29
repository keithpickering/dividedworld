/**
 * The instance's vocabulary and numbers, in the shape seed_instance()
 * (supabase/migrations/0004_schedule.sql) writes: how an instance's classes, reactions, cards,
 * settings and boards arrive in a database whose SQL names none of them.
 */
import type { Instance } from '../../../engine/rules/types.ts';

export function instanceSeed(instance: Instance) {
  return {
    // The System's words travel as one setting, read by the SQL that posts them (0007).
    settings: { ...instance.settings, copy: instance.copy } as Record<string, unknown>,
    classes: instance.classes.map((c) => ({ key: c.key, name: c.name })),
    reactions: instance.reactions.map((r) => ({ key: r.key, emoji: r.emoji, quadrant: r.quadrant })),
    cards: instance.cards.map((c) => ({ key: c.key, name: c.name, alignment: c.alignment, priceSetting: c.priceKey })),
    boards: instance.boards.map((b) => ({ slug: b.slug, name: b.name, description: b.description, system: b.system === true })),
  };
}

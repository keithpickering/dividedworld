/**
 * The instance's vocabulary and numbers, in the shape seed_instance()
 * (supabase/migrations/0004_schedule.sql) writes: how an instance's classes, reactions, cards,
 * settings and boards arrive in a database whose SQL names none of them. Staff arrive as a roster of
 * characters only; their prompts are read from the instance in code and never travel in the seed.
 * The reactions list is the instance's whole set: seeding deletes a kind the instance dropped, or refuses when one is in
 * use (supabase/migrations/0091_seed_reaction_kinds.sql).
 */
import type { Instance, Weakness } from '../../../engine/rules/types.ts';
import { DEFAULT_DEVELOPER } from '../../../engine/rules/instance.ts';
import { MOVE_KINDS } from '../../../engine/system/moves.ts';
import { BBCODE_TAGS } from '../../../engine/bbcode/parse.ts';
import { PREDICATES } from '../../../engine/rules/predicates.ts';
import { DEMAND_KINDS } from '../../../engine/system/demands.ts';

/** What a persona's visits can be talked down with, as the seed carries it in `challenge`: the kind and its number, never a quiz's questions or answers (those travel in `quiz`). */
function challengeOf(w: Weakness): { kind: string; questions?: number; price?: number } {
  if (w.kind === 'quiz') return { kind: 'quiz', questions: w.questions.length };
  if (w.kind === 'bribe') return { kind: 'bribe', price: w.price };
  return { kind: 'distraction' };
}

/** A quiz persona's questions with their choices and answers, as `seed_instance` keeps them (0108) in a table no client can read; no other persona has any. */
function quizOf(w: Weakness): { quiz: { question: string; choices: string[]; answer: string }[] } | Record<string, never> {
  return w.kind === 'quiz' ? { quiz: w.questions.map((q) => ({ question: q.question, choices: [...q.choices], answer: q.answer })) } : {};
}

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
    // What each card's rules read, by name, so screen_settings can hand the screens those numbers too (0039). A card's price is its slot's.
    cards: instance.cards.map((c) => ({
      key: c.key, name: c.name, alignment: c.alignment, stack: c.stack ?? 1, seeded: c.seeded === true,
      reads: (c.reads ?? []).map((r) => (typeof r === 'string' ? r : r.key)),
      // How it is played and how rare it is, and a Set card's trap, a Use card's gimmick and time up (0054, 0148), which seed_instance
      // checks as instanceProblems does. A trap (with its match), a gimmick or a time up left out travels as none.
      rarity: c.rarity, play: c.play ?? 'cast', trap: c.trap, gimmick: c.gimmick, lasts: c.lasts,
      // What a cast card's play pays its caster for votes on its post, and whether it names a class its target is scored as
      // for a window (0151); a trap's outcome travels inside the trap. One left out travels as none.
      skim: c.skim, scoresAs: c.scoresAs,
      // Where it reaches and whether a thread play of it pins (0055), which seed_instance checks against reachRarity and reachLasts.
      reaches: c.reaches ?? ['post'], pins: c.pins === true,
      // Whether its text is generated after it lands (0149): the SQL knows only this flag, never which card.
      writes: c.writes !== undefined,
      // What the server draws one of at each play and the drive its plays share (0153), and the words a blank message is refused with (0153): data the SQL holds, never which card.
      draws: c.draws, drive: c.drive, needsMessage: c.needsMessage,
      // Whether its play is a surface any character may add to (0317): the SQL knows only this flag, never which card.
      surface: c.surface !== undefined,
    })),
    // The packs the instance sells, replaced each seed (0139), and the machine's slots in grid order: seed_instance adds a slot whose item the
    // database does not hold yet and never changes one that is there, since a slot's place, availability and price are an admin's.
    packs: instance.packs.map((p) => ({ key: p.key, pulls: p.pulls.map((pull) => ({ weights: { ...pull.weights } })), leaves: [...(p.leaves ?? [])] })),
    machine: instance.machine.map((m) => ({ ...('card' in m.item ? { card: m.item.card } : { pack: m.item.pack }), availability: m.availability, price: m.price })),
    // The gear the instance offers (0205): keys and rarities only, which seed_instance adds and keeps current; names, lines and art stay in the instance.
    gear: instance.gear.map((g) => ({ key: g.key, rarity: g.rarity })),
    // The lines a Random Event says (0207), each with the outcome it belongs to: seed_instance replaces its event_lines with these.
    eventLines: instance.events.lines.map((l) => ({ key: l.key, outcome: l.outcome, text: l.text })),
    // The trophy catalog (0206): each kind's key, name, words and whether it is a belt, and where the lists point (the place for each of first, second and third, the kinds the Boss
    // may give, the one a met demand gives). seed_instance writes the kinds and sets the three as columns of the kinds they name; the badges stay in the instance's UI.
    trophies: {
      kinds: instance.trophies.kinds.map((k) => ({ key: k.key, name: k.name, ...(k.line !== undefined ? { line: k.line } : {}), belt: k.belt === true })),
      seasonPlaces: [...instance.trophies.seasonPlaces], boss: [...instance.trophies.boss], demandMet: instance.trophies.demandMet,
    },
    // The developer persona (0062): the instance's, else the engine's plain one. It is not in `system`, which a model reads, and its tagline is its
    // profile title. seed_instance makes the character and the updates thread from it; `avatar` is a key the UI turns into a picture.
    developer: { name: dev.name, title: dev.tagline, ...(dev.avatar !== undefined ? { avatar: dev.avatar } : {}), ...(dev.pronouns !== undefined ? { pronouns: dev.pronouns } : {}) },
    boards: instance.boards.map((b) => ({ slug: b.slug, name: b.name, description: b.description, system: b.system === true })),
    // The member groups (0128): the ladder, lowest first with each rung's index, then the groups a move confers with their tone. `condition` is the kind
    // (engine/rules/groups.ts CONDITION_KINDS), `atLeast` its count where it has one. seed_instance upserts them into group_kinds.
    groups: [
      ...instance.groups.ladder.map((r, i) => ({ key: r.key, name: r.name, ...(r.badge !== undefined ? { badge: r.badge } : {}), color: r.color, stripe: r.stripe === true, source: 'ladder' as const, rung: i,
        condition: r.when.kind, ...('atLeast' in r.when ? { atLeast: r.when.atLeast } : {}) })),
      ...instance.groups.conferred.map((g) => ({ key: g.key, name: g.name, ...(g.badge !== undefined ? { badge: g.badge } : {}), color: g.color, stripe: g.stripe === true, source: 'conferred' as const, tone: g.tone })),
    ],
    pipStyles: instance.pipStyles.map((p) => ({ key: p.key, name: p.name, full: p.full, empty: p.empty })),
    // The roster as characters (0043): a Boss or a Mod Bot, once each, with the profile its title and signature give. The
    // prompts stay in the instance module; the meeting reads them in code (chooseInstance), so they are not seeded.
    system: {
      staff: [
        // Every persona alike; seed_instance (0082) debuts the first Boss and the first staff and leaves the rest waiting.
        // `beats` are the slugs of the kinds of board a persona likes to watch (0103): beat_of falls back to them for a board no Mod's order names.
        // `visitHours` and `challenge` are what a persona's visits are like (0105): the hours it runs them and what talks it down. A quiz's challenge carries how many
        // questions it has and never one of them or its answer. The questions and answers travel beside it in `quiz` (0108), which seed_instance writes where no client can read it.
        ...instance.system.roster.map((p) => ({ key: p.key, name: p.name, title: p.title, signature: p.signature, beats: [...p.beats],
          visitHours: { least: p.strictness.visitHours.least, most: p.strictness.visitHours.most }, challenge: challengeOf(p.weakness), ...quizOf(p.weakness),
          // A persona's own pronouns (0124); left out, seed_instance gives it the instance's default.
          ...(p.pronouns !== undefined ? { pronouns: p.pronouns } : {}) })),
      ],
      firstStaff: [...instance.system.firstStaff],
      // The first season's Boss, set on an open season that has none (0047).
      firstBoss: instance.system.firstBoss,
      // The thread on The System's board where moves land and end, made once (0048).
      announcementsTitle: instance.system.announcementsTitle,
      // The engine's catalogs of moves and demands (0046), so SQL and TypeScript read one list. This file is the composition
      // root: the engine names no instance, and the SQL names no kind of its own.
      moves: MOVE_KINDS.map((m) => ({ key: m.key, structural: m.structural, shapesBoard: m.shapesBoard, offices: [...m.offices], derived: [...(m.derived ?? [])] })),
      // The rule predicates (0102): the keys `rule_breaks` has a branch for, the kind and bounds of each parameter, and the rule in plain
      // words with `{param}` where the parameter goes (`system_line` fills it).
      predicates: PREDICATES.map((p) => ({ key: p.key, param: p.param, least: p.bounds?.least ?? null, most: p.bounds?.most ?? null, plain: p.plain('{param}'), ...(p.param === 'tag' ? { tags: [...BBCODE_TAGS] } : {}) })),
      demands: DEMAND_KINDS.map((d) => ({ key: d.key })),
    },
  };
}

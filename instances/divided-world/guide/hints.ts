/**
 * Gabe's hint for each class in the Strategy Guide (instances/divided-world/guide/strategy-guide.md draws it beside the class card's own
 * description and marks). One line each, in the developer persona's voice, and surface only: it points a newcomer at the class's way of
 * playing and gives no arithmetic and no counter-play, which players are meant to find (docs/plans/2026-11-02-onboarding-design.md,
 * section 8). Every line is a DRAFT for the owner's review in the PR, and says nothing untrue.
 *
 * The keys are exactly the instance's classes (classes/index.ts); tools/check-guide.mjs refuses a hint map with one missing or one extra,
 * so the two lists are one.
 */
export const hints: Readonly<Record<string, string>> = Object.freeze({
  face: 'Get behind the posts you like.',
  heel: 'Being hated is a living.',
  jabroni: 'Commit to the bit. Especially when nobody laughs.',
  technician: 'Write the reply people come back to.',
  tweener: 'Say the thing half the room will hate.',
  lurker: 'Watch first. Say less.',
});

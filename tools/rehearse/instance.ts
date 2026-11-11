// The rehearsal's composition root: which instance it rehearses, and the content its filler is made of. The deployed functions never
// import this file, so they never bundle the corpus. The profile is picked the way KAYFABB_PROFILE is (supabase/functions/_shared/instance.ts).
import type { Instance } from "../../engine/rules/types.ts";
import type { RehearsalContent } from "../../engine/rehearsal/types.ts";
import { chooseInstance } from "../../supabase/functions/_shared/instance.ts";
import { rehearsal } from "../../instances/divided-world/rehearsal/index.ts";

export interface Rehearsed {
  readonly instance: Instance;
  readonly content: RehearsalContent;
  readonly profile: string | undefined;
}

/** The instance under `profile` (`playtest`, or none) and its rehearsal content; any other profile is refused as KAYFABB_PROFILE's is. */
export function rehearsedInstance(profile?: string): Rehearsed {
  return { instance: chooseInstance(profile), content: rehearsal, profile };
}

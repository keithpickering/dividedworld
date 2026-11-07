/**
 * A staged page: a made-up screen (the front door's sample thread) drawn with the game's own pieces, where nothing is sent to anyone
 * (docs/plans/2026-11-07-front-door-play-design.md, section 2). The pieces that would reach the server or another page read it: a
 * reaction is answered on the reader's screen alone, an effect saves nothing, and a play's Lens offers no Spin thread. False everywhere
 * but inside a staged page.
 */
import { createContext, useContext } from 'react';

export const StagedCtx = createContext(false);

/** Whether this is a staged page, where nothing is sent and a reload forgets what the reader did. */
export const useStaged = (): boolean => useContext(StagedCtx);

/**
 * DRAFT Mod Bots for Divided World, for the owner to read, cut and rewrite. Each takes one thing the MFGG and Minus World
 * community remembers (a board, a system, a prank, a fad, the Split) and makes a staff robot of it; each file's header says
 * what it was gleaned from. None is modeled on a member: a persona is a thing the forum did, never a person who was there,
 * and no prompt names anyone.
 *
 * They are not in the roster (../../index.ts) yet. The roster and `firstStaff` still hold the placeholders, which the seed
 * and the SQL tests are written against; putting these on staff is a change of its own, made once the owner has settled
 * who stays. ./drafts.test.ts holds each draft to what the engine asks of a roster member, so that change is a wiring one.
 */
import type { Persona } from '../../../../../engine/rules/types.ts';
import { floodControl } from './flood-control.ts';
import { qualityControl } from './quality-control.ts';
import { modOmega } from './mod-omega.ts';
import { theSplitter } from './the-splitter.ts';
import { premiumSupport } from './premium-support.ts';
import { trialOfficer } from './trial-officer.ts';
import { palaceKeeper } from './palace-keeper.ts';
import { soVeryHappy } from './so-very-happy.ts';

export const modBotDrafts: readonly Persona[] = Object.freeze([floodControl, qualityControl, modOmega, theSplitter, premiumSupport, trialOfficer, palaceKeeper, soVeryHappy]);

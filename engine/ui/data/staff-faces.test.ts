import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Character } from './api.ts';
import type { InstanceUi } from '../types.ts';
import { withStaffFace } from './staff-faces.ts';

const base: Character = {
  id: 'c1', name: 'Someone', title: '', signature: '', avatarSquare: null, avatarPortrait: null, squareFrame: null, portraitFrame: null, portraitTallness: null, outfit: [], trophies: [],
  pipStyle: 'default', pronouns: { subject: 'they', object: 'them', possessive: 'their', reflexive: 'themself', plural: true } as unknown as Character['pronouns'], joined: '2026-11-01', group: 'g',
};
const ui = {
  avatars: { gabe: '/gabe.png' },
  staffAvatars: { fangame: { square: '/fangame-square.webp', portrait: '/fangame-portrait.webp' }, squareOnly: { square: '/only.webp' } },
} as unknown as InstanceUi;

test('a staff character with a map entry gets its square and portrait', () => {
  const got = withStaffFace({ ...base, staff: 'fangame', office: 'boss' }, ui);
  assert.equal(got.avatarSquare, '/fangame-square.webp');
  assert.equal(got.avatarPortrait, '/fangame-portrait.webp');
  assert.equal(got.name, 'Someone');
});
test('a persona whose entry has no portrait keeps the portrait it had', () => {
  const got = withStaffFace({ ...base, staff: 'squareOnly', avatarPortrait: '/own.webp' }, ui);
  assert.equal(got.avatarSquare, '/only.webp');
  assert.equal(got.avatarPortrait, '/own.webp');
});
test('a staff character with no entry keeps its initial', () => {
  const got = withStaffFace({ ...base, staff: 'hall-monitor' }, ui);
  assert.equal(got.avatarSquare, null);
  assert.equal(got.avatarPortrait, null);
});
test('a player character is never touched, even one named like a persona', () => {
  const player = { ...base, name: 'fangame' };
  assert.equal(withStaffFace(player, ui), player);
});
test('an instance with no staff pictures changes nothing', () => {
  const staff = { ...base, staff: 'fangame' };
  assert.equal(withStaffFace(staff, { avatars: {} } as unknown as InstanceUi), staff);
});
test('the developer gets the picture its persona names, as its square', () => {
  const got = withStaffFace({ ...base, staff: 'developer', office: 'developer' }, ui, 'gabe');
  assert.equal(got.avatarSquare, '/gabe.png');
  assert.equal(got.avatarPortrait, null);
});
test('the developer with no avatar key, or a key the UI lacks, keeps its initial', () => {
  const dev = { ...base, staff: 'developer', office: 'developer' as const };
  assert.equal(withStaffFace(dev, ui), dev);
  assert.equal(withStaffFace(dev, ui, 'missing'), dev);
});

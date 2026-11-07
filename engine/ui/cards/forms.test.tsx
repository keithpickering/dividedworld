/**
 * The report form and the appeal form (the Mod Bots design, section 9; docs/research/2026-11-06-mod-bots/03-report.png): one tab of the Lens's panel, opened from "Report" in a post's
 * foot links and from "Appeal" in a filed visit's tab. Their words are the glass's plain voice; the Mod's own are quoted as its words.
 */
import { PRONOUN_PRESETS } from '../../rules/pronouns.ts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { axeViolations, describeViolations } from '../a11y.ts';
import { LoadedThread } from '../loaded.tsx';
import { buildWorld, renderIn } from '../test-world.tsx';

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function world() {
  const fake = buildWorld();
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
  const spritey = fake.seed.character(other, 'Spritey', 'face');
  const clerk = fake.seed.staff('clerk', 'The Clerk', 'mod', { pronouns: PRONOUN_PRESETS.he });
  const { thread } = fake.seed.thread('general', spritey, 'A thread', 'post 1');
  const second = fake.seed.post(thread, spritey, 'post 2');
  const mine = fake.seed.post(thread, pipe, 'post 3 is mine');
  const staffPost = fake.seed.staffPost(clerk, thread, 'post 4 is the Clerk\'s');
  fake.seed.wallet(me, 500);
  fake.signInAs(me);
  return { fake, me, other, pipe, spritey, clerk, thread, second, mine, staffPost };
}
type World = ReturnType<typeof world>;
const open = (w: World) => renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}`, copy: { modRole: 'A Moderator' } });
const article = (seq: number) => screen.findByRole('article', { name: new RegExp(`^Post ${seq} `, 'u') });
const reportLink = async (seq: number) => within(await article(seq)).queryByRole('button', { name: 'Report' });
const dialog = (name: string | RegExp) => screen.findByRole('dialog', { name });

describe('the Report link', () => {
  test('stands after History on another player\'s post', async () => {
    open(world());
    const foot = (await article(2)).querySelector('.kb-act-links')!;
    expect([...foot.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Quote', 'Spin thread', 'History', 'Report']);
  });

  test('is not on a staff post, and not on the current mask\'s own', async () => {
    open(world());
    await article(2);
    expect(await reportLink(3)).toBeNull();
    expect(await reportLink(4)).toBeNull();
    expect(await reportLink(2)).not.toBeNull();
    expect(await reportLink(1)).not.toBeNull();
  });

  test('is on the post of the reader\'s own other mask: a report across one\'s own masks is allowed', async () => {
    const w = world();
    const second = w.fake.seed.character(w.me, 'Second Mask', 'face');
    localStorage.setItem(`kb-hud:${w.me}`, second);
    open(w);
    expect(await within(await article(3)).findByRole('button', { name: 'Report' })).toBeInTheDocument();
  });

  test('is not offered to a visitor with no mask to report through', async () => {
    const w = world();
    w.fake.signInAs(null);
    open(w);
    await article(2);
    expect(await reportLink(2)).toBeNull();
  });
});

describe('the report form', () => {
  async function opened(w: World = world()) {
    open(w);
    await userEvent.click(await within(await article(2)).findByRole('button', { name: 'Report' }));
    const panel = await dialog('Report this post');
    return { w, panel };
  }

  test('opens the Lens\'s panel with one tab, "Report post #2", focused, and says who judges it and the verdicts in plain words', async () => {
    const { panel } = await opened();
    const tabs = within(panel).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Report post #2']);
    expect(tabs[0]).toHaveFocus();
    await waitFor(() => expect(panel).toHaveTextContent('Your report is public: it names Pipewrench, and anyone can react to it. The Clerk, on General\'s beat, judges it now: a visit, dismissed, or it backfires onto Pipewrench\'s latest post.'));
    expect(panel).toHaveTextContent('If the Mod cannot judge it, your Aura comes back.');
  });

  test('a judgment that failed says plainly that the Aura came back and the report can be made again, and keeps the reason', async () => {
    const { w, panel } = await opened();
    w.fake.seed.judging({ report: 'failed' });
    await userEvent.type(within(panel).getByRole('textbox'), 'it was rude');
    await userEvent.click(within(panel).getByRole('button', { name: /^Report ·/u }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent('The Mod could not hear this report. Your Aura has been refunded, and you can make it again.');
    expect(within(panel).getByRole('textbox')).toHaveValue('it was rude');
    expect(await w.fake.wallet()).toMatchObject({ balance: 500 });
    /* The refunded report does not use a slot: it can be made again. */
    await waitFor(() => expect(panel).toHaveTextContent('Pipewrench has 3 reports left today.'));
    w.fake.seed.judging({ report: 'dismissed' });
    await userEvent.click(within(panel).getByRole('button', { name: /^Report ·/u }));
    await waitFor(() => expect(within(panel).getByRole('status')).toHaveTextContent('heard and dismissed'));
  });

  test('has the reason field with its count, the price from the settings, and the reports the mask has left today', async () => {
    const { panel } = await opened();
    const reason = within(panel).getByRole('textbox', { name: 'Why (shown with your report)' });
    expect(reason).toHaveAccessibleDescription('0 of 280');
    await userEvent.type(reason, 'it was rude');
    expect(reason).toHaveAccessibleDescription('11 of 280');
    expect(within(panel).getByRole('button', { name: 'Report · 0.25 Aura' })).toBeInTheDocument();
    await waitFor(() => expect(panel).toHaveTextContent('Pipewrench has 3 reports left today.'));
  });

  test('sends the report through the HUD\'s mask and lands the verdict as a line in a status region, then counts the mask\'s reports down', async () => {
    const { w, panel } = await opened();
    w.fake.seed.judging({ report: 'dismissed' });
    await userEvent.type(within(panel).getByRole('textbox'), 'it was rude');
    await userEvent.click(within(panel).getByRole('button', { name: 'Report · 0.25 Aura' }));
    await waitFor(() => expect(within(panel).getByRole('status')).toHaveTextContent('Your report was heard and dismissed. Your 0.25 Aura is spent.'));
    expect(within(panel).getByRole('status')).toHaveTextContent('A Moderator said: “Dismissed.');
    await waitFor(() => expect(panel).toHaveTextContent('Pipewrench has 2 reports left today.'));
    expect(within(panel).getByRole('textbox')).toHaveValue('');
    const report = (await w.fake.log()).reports[0]!;
    expect(report).toMatchObject({ character: w.pipe, verdict: 'dismissed', postSeq: 2 });
    expect(await w.fake.wallet()).toMatchObject({ balance: 475 });
  });

  test('says a visit is on its way, and that a backfire went to the reporter\'s latest post', async () => {
    const a = await opened();
    a.w.fake.seed.judging({ report: 'visit' });
    await userEvent.type(within(a.panel).getByRole('textbox'), 'it is a repeat');
    await userEvent.click(within(a.panel).getByRole('button', { name: /^Report ·/u }));
    await waitFor(() => expect(within(a.panel).getByRole('status')).toHaveTextContent('Your report was heard: a visit is on its way to post #2. Your 0.25 Aura is spent.'));
    await userEvent.type(within(a.panel).getByRole('textbox'), 'again');
    a.w.fake.seed.judging({ report: 'backfire' });
    await userEvent.click(within(a.panel).getByRole('button', { name: /^Report ·/u }));
    await waitFor(() => expect(within(a.panel).getByRole('status')).toHaveTextContent('Your report backfired: a visit is on its way to Pipewrench\'s latest post, for wasting the staff\'s time.'));
  });

  test('a blank reason sends nothing, and one past 280 says so and keeps what was typed', async () => {
    const { w, panel } = await opened();
    await userEvent.click(within(panel).getByRole('button', { name: /^Report ·/u }));
    expect((await w.fake.log()).reports).toHaveLength(0);
    const reason = within(panel).getByRole('textbox');
    await userEvent.click(reason);
    await userEvent.paste('x'.repeat(281));
    expect(within(panel).getByRole('alert')).toHaveTextContent('A reason is at most 280 characters.');
    expect(reason).toHaveAttribute('aria-invalid', 'true');
    await userEvent.click(within(panel).getByRole('button', { name: /^Report ·/u }));
    expect((await w.fake.log()).reports).toHaveLength(0);
    expect(reason).toHaveValue('x'.repeat(281));
  });

  test('a refusal is shown in the server\'s words, and the reason stays', async () => {
    const w = world();
    const inf = w.fake.seed.infraction(w.fake.seed.visit(w.clerk, w.mine, { at: Date.now() }), { points: 10 });
    w.fake.seed.ban(w.pipe, Date.now() + 86_400_000, { infraction: inf });
    const { panel } = await opened(w);
    await userEvent.type(within(panel).getByRole('textbox'), 'it was rude');
    await userEvent.click(within(panel).getByRole('button', { name: /^Report ·/u }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent(/this character is banned until/u);
    expect(within(panel).getByRole('textbox')).toHaveValue('it was rude');
  });

  test('after the quota is spent it says so plainly, and sends no more', async () => {
    const w = world();
    for (const reason of ['one', 'two', 'three']) await w.fake.fileReport(w.pipe, w.second, reason);
    const { panel } = await opened(w);
    await waitFor(() => expect(panel).toHaveTextContent('Pipewrench has 0 reports left today. Reports open again after midnight UTC.'));
    await userEvent.type(within(panel).getByRole('textbox'), 'a fourth');
    await userEvent.click(within(panel).getByRole('button', { name: /^Report ·/u }));
    expect((await w.fake.log()).reports).toHaveLength(3);
  });

  test('says "1 report" in the singular, and closes by Esc with focus back on the Report link', async () => {
    const w = world();
    await w.fake.fileReport(w.pipe, w.second, 'one');
    await w.fake.fileReport(w.pipe, w.second, 'two');
    const { panel } = await opened(w);
    await waitFor(() => expect(panel).toHaveTextContent('Pipewrench has 1 report left today.'));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Report this post' })).toBeNull());
    expect(within(await article(2)).getByRole('button', { name: 'Report' })).toHaveFocus();
  });

  test('passes axe with its tab open, and reached by keyboard alone', async () => {
    const { panel } = await opened();
    const bad = await axeViolations(panel);
    expect(bad, describeViolations(bad)).toEqual([]);
    await userEvent.tab();
    await userEvent.tab();
    expect(within(panel).getByRole('textbox')).toHaveFocus();
  });
});

describe('the appeal form', () => {
  /** The Clerk's visit to Pipewrench's post 3, filed, with its infraction: the reader plays Pipewrench. */
  function filed(w: World = world()) {
    const visit = w.fake.seed.visit(w.clerk, w.mine, { at: Date.now() - 4 * 3_600_000, endsInMs: 3_600_000 });
    w.fake.seed.visitEnd(visit, { outcome: 'filed', line: 'Filed.' });
    const infraction = w.fake.seed.infraction(visit, { points: 2 });
    return { ...w, visit, infraction };
  }
  async function opened(w: ReturnType<typeof filed> = filed()) {
    open(w);
    await userEvent.click(await within(await article(3)).findByRole('button', { name: /Opens the visit\.$/u }));
    const visitPanel = await dialog(/^Visit/u);
    await waitFor(() => expect(visitPanel.querySelector('.kb-visit')).not.toHaveAttribute('aria-busy'));
    await userEvent.click(await within(visitPanel).findByRole('button', { name: 'Appeal · 0.50 Aura' }));
    const panel = await dialog('Appeal on this post');
    return { w, panel };
  }

  test('is the same panel, with one tab, "Appeal", focused, and says the punishment, the price and the terms', async () => {
    const { panel } = await opened();
    expect(within(panel).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Appeal']);
    expect(within(panel).getByRole('tab')).toHaveFocus();
    await waitFor(() => expect(panel).toHaveTextContent('The punishment: Rule 2: No double posting, a minor breach, 2 points on Pipewrench\'s warn bar, dropping off'));
    expect(panel).toHaveTextContent('The Clerk hears it, or whoever has taken his place. It is refunded if overturned. It may be upheld, reduced, or increased by up to 2 warn points. One appeal per filing, and your plea is public.');
    expect(within(panel).getByRole('button', { name: 'Appeal · 0.50 Aura' })).toBeInTheDocument();
    expect(within(panel).getByRole('textbox', { name: 'Your plea (public)' })).toHaveAccessibleDescription('0 of 1000');
  });

  test('sends the plea and lands the ruling in a status region; the Mod\'s line is quoted as its words', async () => {
    const { w, panel } = await opened();
    w.fake.seed.judging({ appeal: 'upheld' });
    await userEvent.type(within(panel).getByRole('textbox'), 'It was a different changelog.');
    await userEvent.click(within(panel).getByRole('button', { name: 'Appeal · 0.50 Aura' }));
    await waitFor(() => expect(within(panel).getByRole('status')).toHaveTextContent('The Clerk heard it and upheld it, so nothing changed.'));
    const appeal = (await w.fake.log()).appeals[0]!;
    expect(appeal).toMatchObject({ character: w.pipe, punishment: w.infraction, punishmentKind: 'infraction', verdict: 'upheld', postSeq: 3 });
    expect(await w.fake.wallet()).toMatchObject({ balance: 450 });
  });

  test('an overturned appeal gets its price back; a second appeal of the same punishment is refused in the server\'s words', async () => {
    const { w, panel } = await opened();
    w.fake.seed.judging({ appeal: 'overturned' });
    await userEvent.type(within(panel).getByRole('textbox'), 'Please.');
    await userEvent.click(within(panel).getByRole('button', { name: 'Appeal · 0.50 Aura' }));
    await waitFor(() => expect(within(panel).getByRole('status')).toHaveTextContent('The Clerk heard it and overturned it, so the points are gone.'));
    expect(await w.fake.wallet()).toMatchObject({ balance: 500 });
    await userEvent.type(within(panel).getByRole('textbox'), 'Again.');
    await userEvent.click(within(panel).getByRole('button', { name: 'Appeal · 0.50 Aura' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent('this punishment has already been appealed; each punishment is appealed once');
  });

  test('a plea past 1000 says so and sends nothing; a blank one sends nothing', async () => {
    const { w, panel } = await opened();
    await userEvent.click(within(panel).getByRole('button', { name: 'Appeal · 0.50 Aura' }));
    await userEvent.click(within(panel).getByRole('textbox'));
    await userEvent.paste('x'.repeat(1001));
    expect(within(panel).getByRole('alert')).toHaveTextContent('A plea is at most 1000 characters.');
    await userEvent.click(within(panel).getByRole('button', { name: 'Appeal · 0.50 Aura' }));
    expect((await w.fake.log()).appeals).toHaveLength(0);
  });

  test('passes axe with its tab open', async () => {
    const { panel } = await opened();
    await waitFor(() => expect(panel).toHaveTextContent('The punishment:'));
    const bad = await axeViolations(panel);
    expect(bad, describeViolations(bad)).toEqual([]);
  });
});



describe('the appeal to the Boss of a ban (the design, section 5: "No player is ever stuck")', () => {
  /** Pipewrench, the reader's mask, is banned for a day after a filed visit's infraction filled the bar. */
  function banned() {
    const w = world();
    const visit = w.fake.seed.visit(w.clerk, w.mine, { at: Date.now() - 4 * 3_600_000, endsInMs: 3_600_000 });
    w.fake.seed.visitEnd(visit, { outcome: 'filed', line: 'Filed.' });
    const inf = w.fake.seed.infraction(visit, { points: 10, band: 'severe' });
    const ban = w.fake.seed.ban(w.pipe, Date.now() + 86_400_000, { infraction: inf, days: 1 });
    return { ...w, ban };
  }

  test('the banned composer offers "Appeal to the Boss · 0.50 Aura", which opens the form with the ban\'s end and terms, and sends it with the ban\'s Act', async () => {
    const w = banned();
    open(w);
    const entry = await screen.findByRole('button', { name: 'Appeal to the Boss · 0.50 Aura' });
    await userEvent.click(entry);
    const form = await screen.findByRole('dialog', { name: 'Appeal the ban' });
    expect(await within(form).findByRole('form', { name: 'Appeal' })).toHaveTextContent(/The punishment: a ban of 1 day, after Rule 2: No double posting\. It ends by itself .+\./u);
    expect(form).toHaveTextContent('The Boss hears it. It is refunded if overturned. It may be upheld, cut to half of its 1 day, or lengthened by half. One appeal per ban, and your plea is public.');
    w.fake.seed.judging({ appeal: 'upheld' });
    await userEvent.type(within(form).getByRole('textbox', { name: 'Your plea (public)' }), 'I have learned.');
    await userEvent.click(within(form).getByRole('button', { name: 'Appeal · 0.50 Aura' }));
    await waitFor(() => expect(within(form).getByRole('status')).toHaveTextContent('The Boss heard it and upheld it, so nothing changed.'));
    expect((await w.fake.log()).appeals[0]).toMatchObject({ punishment: w.ban, punishmentKind: 'ban', verdict: 'upheld', character: w.pipe });
    expect(await w.fake.wallet()).toMatchObject({ balance: 450 });
  });

  test('an overturned appeal of the ban ends it: the ban is no longer the mask\'s, and the composer lets it post', async () => {
    const w = banned();
    expect(await w.fake.myBan(w.pipe)).toMatchObject({ ban: w.ban });
    w.fake.seed.judging({ appeal: 'overturned' });
    await w.fake.fileAppeal(w.pipe, w.ban, 'Please.');
    expect(await w.fake.myBan(w.pipe)).toBeNull();
    expect((await w.fake.myCharacters())[0]?.bannedUntil).toBeUndefined();
  });

  test('is not offered to a mask that is not banned, nor on another player\'s screen', async () => {
    const w = banned();
    w.fake.signInAs(w.other);
    open(w);
    await article(2);
    expect(screen.queryByRole('button', { name: /^Appeal to the Boss/u })).toBeNull();
    expect(await w.fake.myBan(w.pipe)).toBeNull();
  });

  test('at full motion its close plays the exit: the form stays, inert and hidden from a reader, until the exit ends (layer.tsx)', async () => {
    const root = document.documentElement;
    root.setAttribute('data-kb-motion', 'full');
    try {
      const w = banned();
      open(w);
      await userEvent.click(await screen.findByRole('button', { name: /^Appeal to the Boss/u }));
      const form = await screen.findByRole('dialog', { name: 'Appeal the ban' });
      await userEvent.keyboard('{Escape}');
      const layer = form.closest('[data-kb-exiting]');
      expect(layer, 'the closed form is still on the page, leaving').not.toBeNull();
      expect(layer).toHaveAttribute('inert');
      expect(layer).toHaveAttribute('aria-hidden', 'true');
      await waitFor(() => expect(form.isConnected).toBe(false));
    } finally {
      root.removeAttribute('data-kb-motion');
    }
  });

  test('passes axe', async () => {
    const w = banned();
    open(w);
    await userEvent.click(await screen.findByRole('button', { name: /^Appeal to the Boss/u }));
    const form = await screen.findByRole('dialog', { name: 'Appeal the ban' });
    await within(form).findByRole('form', { name: 'Appeal' });
    const bad = await axeViolations(form);
    expect(bad, describeViolations(bad)).toEqual([]);
  });
});

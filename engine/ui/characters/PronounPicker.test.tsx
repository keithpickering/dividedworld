import { useState } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { PRONOUN_PRESETS, type PronounSet } from '../../rules/pronouns.ts';
import { axeViolations, describeViolations } from '../a11y.ts';
import { PronounPicker, pronounFieldProblems } from './PronounPicker.tsx';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function Harness({ start = PRONOUN_PRESETS.it, name = 'Gloomba', seen }: { readonly start?: PronounSet; readonly name?: string; readonly seen?: (s: PronounSet) => void }) {
  const [v, setV] = useState(start);
  return <PronounPicker name={name} value={v} onChange={(s) => { setV(s); seen?.(s); }} />;
}
const group = () => screen.getByRole('group', { name: 'Pronouns' });

describe('the pronoun picker', () => {
  test('offers it/its, he/him, she/her, they/them and Custom…, on the value chosen', () => {
    render(<Harness />);
    const names = within(group()).getAllByRole('radio').map((r) => r.getAttribute('aria-label') ?? r.closest('label')?.textContent);
    expect(names.map((n) => n?.replace(/\s+/gu, ' ').trim())).toEqual(['it/its', 'he/him', 'she/her', 'they/them', 'Custom…']);
    expect(within(group()).getByRole('radio', { name: /^it\/its/u })).toBeChecked();
  });

  test('choosing she/her sends she/her', async () => {
    const seen = vi.fn();
    render(<Harness seen={seen} />);
    await userEvent.click(within(group()).getByRole('radio', { name: /^she\/her/u }));
    expect(seen).toHaveBeenLastCalledWith(PRONOUN_PRESETS.she);
  });

  test('the preview reads in the name: "She is", then "They are"; "Your character" without a name', async () => {
    const { rerender } = render(<Harness />);
    await userEvent.click(within(group()).getByRole('radio', { name: /^she\/her/u }));
    const preview = screen.getByText(/posted\./u);
    expect(preview.tagName).toBe('P');
    expect(preview).not.toHaveAttribute('aria-live');
    expect(preview).toHaveTextContent('Gloomba posted. She is a Face. The card is hers; she played it on her own post herself.');
    await userEvent.click(within(group()).getByRole('radio', { name: /^they\/them/u }));
    expect(preview).toHaveTextContent('They are a Face. The card is theirs; they played it on their own post themself.');
    rerender(<Harness name="  " />);
    expect(screen.getByText(/posted\./u)).toHaveTextContent(/^Your character posted\./u);
  });

  test('only a choice is announced: typing the name changes the polite status line never, choosing she/her does; the visible sentence is not live', async () => {
    render(<Harness name="" />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('');
    expect(screen.getByText(/posted\./u)).not.toHaveAttribute('aria-live');
    await userEvent.click(within(group()).getByRole('radio', { name: /^she\/her/u }));
    expect(status).toHaveTextContent('Pronouns she/her. She is a Face.');
    await userEvent.click(within(group()).getByRole('radio', { name: /^Custom/u }));
    const before = status.textContent;
    await userEvent.clear(screen.getByLabelText('Subject'));
    await userEvent.type(screen.getByLabelText('Subject'), 'x');
    expect(status.textContent).toBe(before);
  });

  test('Custom… starts on the current set, and previews it as stored', async () => {
    const seen = vi.fn();
    render(<Harness start={PRONOUN_PRESETS.he} seen={seen} />);
    await userEvent.click(within(group()).getByRole('radio', { name: /^Custom/u }));
    expect(seen).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Subject')).toHaveValue('he');
    expect(screen.getByLabelText('Object')).toHaveValue('him');
    expect(screen.getByLabelText('Possessive adjective')).toHaveValue('his');
    expect(screen.getByLabelText('Possessive')).toHaveValue('his');
    expect(screen.getByLabelText('Reflexive')).toHaveValue('himself');
    expect(screen.getByRole('radio', { name: 'Verbs like it is' })).toBeChecked();
    expect(screen.queryByText(/is empty/u)).toBeNull();
    await userEvent.clear(screen.getByLabelText('Subject'));
    await userEvent.clear(screen.getByLabelText('Subject'));
    await userEvent.type(screen.getByLabelText('Subject'), 'XE');
    expect(screen.getByText(/posted\./u)).toHaveTextContent('Xe is a Face.');
    expect(screen.getByText(/posted\./u)).toHaveTextContent('xe played it');
  });

  test('a problem on the possessive adjective speaks in that field\'s words and marks the field', async () => {
    render(<Harness start={{ ...PRONOUN_PRESETS.he, determiner: 'abcdefghijklm' }} />);
    await userEvent.click(within(group()).getByRole('radio', { name: /^Custom/u }));
    expect(screen.getByText('the possessive adjective has 13 characters; at most 12')).toBeInTheDocument();
    expect(screen.getByLabelText('Possessive adjective')).toHaveAttribute('aria-invalid', 'true');
    expect(pronounFieldProblems({ ...PRONOUN_PRESETS.he, determiner: '' }).determiner).toEqual(['the possessive adjective is empty']);
  });

  test('Custom… shows five labeled fields with they-set placeholders, and the verbs pair', async () => {
    const seen = vi.fn();
    render(<Harness seen={seen} />);
    expect(screen.queryByLabelText('Subject')).toBeNull();
    await userEvent.click(within(group()).getByRole('radio', { name: /^Custom/u }));
    for (const [label, ph] of [['Subject', 'they'], ['Object', 'them'], ['Possessive adjective', 'their'], ['Possessive', 'theirs'], ['Reflexive', 'themself']] as const) {
      expect(screen.getByLabelText(label)).toHaveAttribute('placeholder', ph);
    }
    await userEvent.clear(screen.getByLabelText('Subject'));
    await userEvent.type(screen.getByLabelText('Subject'), 'Xe');
    await userEvent.clear(screen.getByLabelText('Object'));
    await userEvent.type(screen.getByLabelText('Object'), 'xem');
    await userEvent.clear(screen.getByLabelText('Possessive adjective'));
    await userEvent.type(screen.getByLabelText('Possessive adjective'), 'xyr');
    await userEvent.clear(screen.getByLabelText('Possessive'));
    await userEvent.type(screen.getByLabelText('Possessive'), 'xyrs');
    await userEvent.clear(screen.getByLabelText('Reflexive'));
    await userEvent.type(screen.getByLabelText('Reflexive'), 'xemself');
    expect(screen.getByRole('radio', { name: 'Verbs like they are' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Verbs like it is' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'Verbs like they are' }));
    expect(seen).toHaveBeenLastCalledWith({ subject: 'Xe', object: 'xem', determiner: 'xyr', possessive: 'xyrs', reflexive: 'xemself', plural: true });
    expect(screen.getByText(/posted\./u)).toHaveTextContent('Xe are a Face.');
    await userEvent.click(screen.getByRole('radio', { name: 'Verbs like it is' }));
    expect(screen.getByText(/posted\./u)).toHaveTextContent('Xe is a Face.');
  });

  test('a 13-letter custom subject shows its problem under it', async () => {
    render(<Harness start={{ subject: 'xe', object: 'xem', determiner: 'xyr', possessive: 'xyrs', reflexive: 'xemself', plural: false }} />);
    const subject = screen.getByLabelText('Subject');
    expect(subject).toHaveValue('xe');
    await userEvent.type(subject, 'abcdefghijkl');
    expect(subject).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('the subject has 14 characters; at most 12')).toBeInTheDocument();
    expect(subject).toHaveAccessibleDescription('the subject has 14 characters; at most 12');
    expect(pronounFieldProblems({ ...PRONOUN_PRESETS.it, subject: 'abcdefghijklm' }).subject).toEqual(['the subject has 13 characters; at most 12']);
  });

  test('is keyboard-operable: arrow keys move the choice, and the group passes the axe check', async () => {
    const { container } = render(<Harness start={PRONOUN_PRESETS.he} />);
    const he = within(group()).getByRole('radio', { name: /^he\/him/u });
    he.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(within(group()).getByRole('radio', { name: /^she\/her/u })).toBeChecked();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(within(group()).getByRole('radio', { name: /^Custom/u })).toBeChecked();
    expect(await axeViolations(container)).toEqual([]);
    const found = await axeViolations(container);
    expect(describeViolations(found)).toBe('');
  });
});

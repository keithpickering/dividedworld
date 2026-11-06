import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { axeViolations, describeViolations } from '../a11y.ts';
import { buildWorld, renderIn } from '../test-world.tsx';
import { CannotDisplay, CannotFind } from './Unavailable.tsx';

const ADDRESS = 'dw.gripe/t/3f2a9c1e';

/* The page draws inside <main>, as a screen does; the test world's site name is "Test". */
function displayed(onRetry: () => void = () => {}) {
  return renderIn(buildWorld(), <main><CannotDisplay address={ADDRESS} onRetry={onRetry} /></main>, { path: '/' });
}

/* The list's items as their whole text, since an item holds a button or a link. */
const items = () => screen.getAllByRole('listitem').map((li) => li.textContent);

function notFound() {
  return renderIn(buildWorld(), <main><CannotFind address={ADDRESS} /></main>, { path: '/' });
}

describe('CannotDisplay', () => {
  test('the heading is the page\'s h1 and reads exactly', () => {
    displayed();
    expect(screen.getByRole('heading', { level: 1, name: 'The page cannot be displayed' })).toBeTruthy();
  });

  test('its paragraphs, list and footer read exactly, with the site name and the address', () => {
    displayed();
    expect(screen.getByText('The page you are looking for is currently unavailable. Test did not answer in time, or the connection dropped on the way.')).toBeTruthy();
    expect(screen.getByText('Please try the following:')).toBeTruthy();
    expect(items()).toEqual([
      'Click Try again, or try again in a moment.',
      'Check that your connection is working.',
      'Go back to the index.',
      "Click your browser's Back button to return to the page you were on.",
    ]);
    expect(screen.getByText(`Cannot load ${ADDRESS}`)).toBeTruthy();
  });

  test('"back to the index" is a link to /', () => {
    displayed();
    expect(screen.getByRole('link', { name: 'back to the index' }).getAttribute('href')).toBe('/');
  });

  test('Try again is a button that calls onRetry', async () => {
    const onRetry = vi.fn();
    displayed(onRetry);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test('axe finds no violation', async () => {
    const { container } = displayed();
    const found = await axeViolations(container);
    expect(found, describeViolations(found)).toEqual([]);
  });
});

describe('CannotFind', () => {
  test('the heading is the page\'s h1 and reads exactly', () => {
    notFound();
    expect(screen.getByRole('heading', { level: 1, name: 'The page cannot be found' })).toBeTruthy();
  });

  test('its paragraphs, list and footer read exactly, with the address', () => {
    notFound();
    expect(screen.getByText('The page you are looking for might have been removed, had its name changed, or never existed.')).toBeTruthy();
    expect(screen.getByText('Please try the following:')).toBeTruthy();
    expect(items()).toEqual([
      'If you typed the page address, make sure that it is spelled correctly.',
      'Open the index, and then look for links to the page you want.',
      "Click your browser's Back button to try another link.",
    ]);
    expect(screen.getByText(`Page not found: ${ADDRESS}`)).toBeTruthy();
  });

  test('"index" is a link to /', () => {
    notFound();
    expect(screen.getByRole('link', { name: 'index' }).getAttribute('href')).toBe('/');
  });

  test('axe finds no violation', async () => {
    const { container } = notFound();
    const found = await axeViolations(container);
    expect(found, describeViolations(found)).toEqual([]);
  });
});

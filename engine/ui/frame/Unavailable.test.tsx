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

function notFound(address = '/t/3f2a9c1e') {
  return renderIn(buildWorld(), <main><CannotFind address={address} /></main>, { path: '/' });
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

  test('the page is a sheet in its own colors, with the way out named', () => {
    const { container } = displayed();
    expect(container.querySelector('.kb-unavailable-sheet h1')?.textContent).toBe('The page cannot be displayed');
    expect(screen.getByRole('group', { name: 'The page cannot be displayed' })).toBeTruthy();
  });

  test('axe finds no violation', async () => {
    const { container } = displayed();
    const found = await axeViolations(container);
    expect(found, describeViolations(found)).toEqual([]);
  });
});

describe('CannotFind', () => {
  test.each([
    ['/t/x', 'The thread you requested does not exist.'],
    ['/b/nowhere', 'The board you requested does not exist.'],
    ['/c/nobody', 'The character you requested does not exist.'],
    ['/c/nobody/record?page=2', 'The character you requested does not exist.'],
    ['/nope', 'There is no page at this address.'],
    ['/', 'There is no page at this address.'],
  ])('%s names what was asked for, as the page\'s h1', (address, message) => {
    notFound(address);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(message);
  });

  test('the box is the forum\'s Information box: a band, the message, the way out and the address in a foot cell', () => {
    const { container } = notFound('/t/x');
    const table = screen.getByRole('table', { name: 'Information' });
    expect(table.querySelector('td.kb-bar')?.textContent).toBe('Information');
    expect(screen.getByText('If you followed a link here, it may be mistyped or out of date.')).toBeTruthy();
    const foot = container.querySelector('td.kb-unavailable-address');
    expect(foot?.textContent).toBe('Address: /t/x');
  });

  test('the whole sentence is the link to the index', () => {
    notFound('/t/x');
    const link = screen.getByRole('link', { name: 'Click here to return to the index' });
    expect(link.getAttribute('href')).toBe('/');
  });

  test('axe finds no violation', async () => {
    const { container } = notFound();
    const found = await axeViolations(container);
    expect(found, describeViolations(found)).toEqual([]);
  });
});

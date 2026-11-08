/** Avatar: a character's picture beside its name, or the name's first letter where it has none. Decoration only. */
import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { Avatar } from './Avatar.tsx';

const root = (c: HTMLElement) => c.firstElementChild as HTMLElement;

describe('Avatar', () => {
  test('with a src it draws the picture with empty alt and no letter', () => {
    const { container } = render(<Avatar src="data:image/webp;base64,x" name="Toad" />);
    const img = container.querySelector('img')!;
    expect(img).toHaveAttribute('src', 'data:image/webp;base64,x');
    expect(img).toHaveAttribute('alt', '');
    expect(container.querySelector('.kb-avatar-none')).toBeNull();
    expect(container).not.toHaveTextContent('T');
  });
  test('with null it draws the name\'s first letter', () => {
    const { container } = render(<Avatar src={null} name="Toad" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.kb-avatar-none')).toHaveTextContent('T');
  });
  test('the first letter is the first code point, so an emoji is not split', () => {
    const { container } = render(<Avatar src={null} name="🍄Toad" />);
    expect(container.querySelector('.kb-avatar-none')!.textContent).toBe('🍄');
  });
  test('the root is aria-hidden and wears the caller\'s class', () => {
    const { container } = render(<Avatar src={null} name="Toad" className="mine" />);
    expect(root(container)).toHaveAttribute('aria-hidden', 'true');
    expect(root(container)).toHaveClass('kb-avatar', 'mine');
  });
});

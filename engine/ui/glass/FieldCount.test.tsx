/** FieldCount: a field's hint at the left of a line of its own and its count at the right, which the field is described by. */
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { FieldCount } from './FieldCount.tsx';

describe('FieldCount', () => {
  test('is one line: the hint, then the count as "N of MAX", counted in characters', () => {
    render(<FieldCount id="c" hint="Under the name on every post." text="Magenta 🎨" max={40} />);
    const line = document.getElementById('c')!;
    expect(line.children).toHaveLength(2);
    expect(line.children[0]).toHaveTextContent('Under the name on every post.');
    expect(line.children[1]).toHaveTextContent('9 of 40');
    expect(line.children[1]).toHaveClass('kb-glass-field-tally');
  });

  test('describes the field that names it, hint and count together', () => {
    render(<><label>Title<input aria-describedby="c" /></label><FieldCount id="c" hint="Plain text." text="" max={200} /></>);
    expect(screen.getByLabelText('Title')).toHaveAccessibleDescription('Plain text. 0 of 200');
  });

  test('has no hint to draw when it has none, and still keeps the count at the right', () => {
    render(<FieldCount id="c" text="abc" max={500} />);
    expect(document.getElementById('c')!.children[0]).toBeEmptyDOMElement();
    expect(document.getElementById('c')).toHaveTextContent('3 of 500');
  });

  test('says when the count is over the most, so a color is never the only sign', () => {
    render(<FieldCount id="c" text="abcd" max={3} />);
    expect(document.getElementById('c')!.children[1]).toHaveAttribute('data-kb-over');
    expect(document.getElementById('c')).toHaveTextContent('4 of 3');
  });
});

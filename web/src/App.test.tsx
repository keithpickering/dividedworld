import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { App } from './App.tsx';

test('the app renders', () => {
  render(<App />);
  expect(screen.getByRole('main')).toBeInTheDocument();
});

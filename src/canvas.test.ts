import { expect, it } from 'vitest';
import { newStep } from './domain';
import { visiblePosition } from './canvas';
it('keeps unobstructed drop coordinates', () => {
  expect(visiblePosition({ x: 700, y: 100 }, [newStep('start', 100, 100)])).toEqual({
    x: 700,
    y: 100,
  });
});
it('places repeated insertions without covering earlier cards', () => {
  const steps = [newStep('start', 100, 100)];
  for (let i = 0; i < 20; i++) {
    const position = visiblePosition({ x: 100, y: 100 }, steps);
    expect(
      steps.every(
        (s) =>
          Math.abs(s.position.x - position.x) >= 214 || Math.abs(s.position.y - position.y) >= 134,
      ),
    ).toBe(true);
    steps.push(newStep('timer', position.x, position.y));
  }
});

import type { Step } from './domain';
export function visiblePosition(proposed: { x: number; y: number }, steps: Step[]) {
  const free = (position: { x: number; y: number }) =>
    steps.every(
      (step) =>
        Math.abs(step.position.x - position.x) >= 214 ||
        Math.abs(step.position.y - position.y) >= 134,
    );
  if (free(proposed)) return proposed;
  for (let distance = 1; distance <= steps.length + 1; distance++) {
    for (const [dx, dy] of [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
      [1, 1],
      [-1, 1],
    ]) {
      const position = { x: proposed.x + dx * distance * 230, y: proposed.y + dy * distance * 150 };
      if (free(position)) return position;
    }
  }
  return { x: proposed.x + (steps.length + 2) * 230, y: proposed.y };
}

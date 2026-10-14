import { describe, expect, it } from 'vitest';
import { classifySwipe, keyToAction, SWIPE_THRESHOLD } from './input';

describe('classifySwipe', () => {
  it('ignores small movements', () => {
    expect(classifySwipe(5, -5)).toBeNull();
    expect(classifySwipe(SWIPE_THRESHOLD - 1, 0)).toBeNull();
  });
  it('maps directions to actions', () => {
    expect(classifySwipe(-60, 10)).toBe('left');
    expect(classifySwipe(60, -10)).toBe('right');
    expect(classifySwipe(5, -60)).toBe('jump');
    expect(classifySwipe(-5, 60)).toBe('slide');
  });
  it('uses the dominant axis for diagonals', () => {
    expect(classifySwipe(50, 40)).toBe('right');
    expect(classifySwipe(40, -50)).toBe('jump');
  });
});

describe('keyToAction', () => {
  it('supports arrows, WASD and space', () => {
    expect(keyToAction('ArrowLeft')).toBe('left');
    expect(keyToAction('d')).toBe('right');
    expect(keyToAction(' ')).toBe('jump');
    expect(keyToAction('W')).toBe('jump');
    expect(keyToAction('ArrowDown')).toBe('slide');
    expect(keyToAction('x')).toBeNull();
  });
});

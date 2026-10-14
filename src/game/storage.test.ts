import { beforeEach, describe, expect, it } from 'vitest';
import { loadBest, loadMuted, saveBest, saveMuted } from './storage';

describe('personal best storage', () => {
  beforeEach(() => localStorage.clear());

  it('starts at zero', () => {
    expect(loadBest()).toBe(0);
  });

  it('only saves improvements', () => {
    expect(saveBest(500)).toBe(true);
    expect(saveBest(300)).toBe(false);
    expect(loadBest()).toBe(500);
    expect(saveBest(800.7)).toBe(true);
    expect(loadBest()).toBe(800);
  });

  it('ignores corrupt values', () => {
    localStorage.setItem('danfo-dash:best', 'banana');
    expect(loadBest()).toBe(0);
  });

  it('remembers mute', () => {
    saveMuted(true);
    expect(loadMuted()).toBe(true);
    saveMuted(false);
    expect(loadMuted()).toBe(false);
  });
});

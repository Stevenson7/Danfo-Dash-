/** Personal best + settings persistence. Never throws (private mode, etc.). */

const BEST_KEY = 'danfo-dash:best';
const MUTED_KEY = 'danfo-dash:muted';

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable – ignore */
  }
}

export function loadBest(): number {
  const n = Number(safeGet(BEST_KEY));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Saves the score if it beats the stored best. Returns true for a new best. */
export function saveBest(score: number): boolean {
  const s = Math.floor(score);
  if (s > loadBest()) {
    safeSet(BEST_KEY, String(s));
    return true;
  }
  return false;
}

export function loadMuted(): boolean {
  return safeGet(MUTED_KEY) === '1';
}

export function saveMuted(muted: boolean): void {
  safeSet(MUTED_KEY, muted ? '1' : '0');
}

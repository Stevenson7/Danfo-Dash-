import type { Action } from './types';

/** Minimum finger travel (CSS px) before a touch counts as a swipe. */
export const SWIPE_THRESHOLD = 28;
/** A touch shorter than this (ms) that barely moved counts as a tap. */
const TAP_MAX_MS = 300;

/** Turns a finger movement into an action, or null if it is too small. */
export function classifySwipe(dx: number, dy: number, threshold = SWIPE_THRESHOLD): Action | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < threshold) return null;
  if (ax > ay) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'jump' : 'slide';
}

export function keyToAction(key: string): Action | null {
  switch (key) {
    case 'ArrowLeft':
    case 'a':
    case 'A':
      return 'left';
    case 'ArrowRight':
    case 'd':
    case 'D':
      return 'right';
    case 'ArrowUp':
    case 'w':
    case 'W':
    case ' ':
      return 'jump';
    case 'ArrowDown':
    case 's':
    case 'S':
      return 'slide';
    default:
      return null;
  }
}

export interface InputHandlers {
  onAction: (action: Action) => void;
  onTap: () => void;
  onPauseKey: () => void;
  onConfirmKey: () => void;
}

/**
 * Listens for swipes on `surface` and keys on the window. Swipes fire as soon
 * as the finger passes the threshold (not on release) so controls feel snappy.
 */
export function attachInput(surface: HTMLElement, handlers: InputHandlers): () => void {
  let startX = 0;
  let startY = 0;
  let startT = 0;
  let activeId: number | null = null;
  let fired = false;

  const onDown = (e: PointerEvent) => {
    if (activeId !== null) return;
    // Let on-screen buttons handle their own taps.
    if ((e.target as Element | null)?.closest?.('button')) return;
    activeId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    startT = performance.now();
    fired = false;
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== activeId || fired) return;
    const action = classifySwipe(e.clientX - startX, e.clientY - startY);
    if (action) {
      fired = true;
      handlers.onAction(action);
    }
  };

  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== activeId) return;
    activeId = null;
    if (!fired) {
      const action = classifySwipe(e.clientX - startX, e.clientY - startY);
      if (action) handlers.onAction(action);
      else if (performance.now() - startT < TAP_MAX_MS) handlers.onTap();
    }
  };

  const onCancel = (e: PointerEvent) => {
    if (e.pointerId === activeId) activeId = null;
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.repeat) return;
    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
      handlers.onPauseKey();
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter') {
      handlers.onConfirmKey();
      e.preventDefault();
      return;
    }
    const action = keyToAction(e.key);
    if (action) {
      e.preventDefault();
      handlers.onAction(action);
    }
  };

  surface.addEventListener('pointerdown', onDown);
  surface.addEventListener('pointermove', onMove);
  surface.addEventListener('pointerup', onUp);
  surface.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey);

  return () => {
    surface.removeEventListener('pointerdown', onDown);
    surface.removeEventListener('pointermove', onMove);
    surface.removeEventListener('pointerup', onUp);
    surface.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey);
  };
}

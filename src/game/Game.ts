import { Sfx } from './audio';
import { attachInput } from './input';
import { createGame, pause, resume, startGame, step } from './engine';
import { Renderer } from './renderer';
import { loadBest, loadMuted, saveBest, saveMuted } from './storage';
import type { Action, GameState, Phase } from './types';

export interface GameSnapshot {
  phase: Phase;
  score: number;
  coins: number;
  best: number;
  newBest: boolean;
  crashedBy: GameState['crashedBy'];
  muted: boolean;
}

/** Ignore restart taps briefly after a crash so a swipe in progress can't skip the results. */
const RESTART_LOCKOUT_MS = 450;

/**
 * Owns the canvas, the animation loop, input and audio. React only renders
 * menus/overlays from the snapshots this class emits on phase changes.
 */
export class Game {
  private state: GameState;
  private readonly renderer = new Renderer();
  private readonly sfx: Sfx;
  private readonly ctx: CanvasRenderingContext2D;
  private queue: Action[] = [];
  private raf = 0;
  private last = 0;
  private overAt = 0;
  private newBest = false;
  private detachInput: () => void;
  private readonly onVisibility = () => {
    if (document.hidden) this.pause();
  };
  private readonly onResize = () => this.resize();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    surface: HTMLElement,
    private readonly onChange: (snap: GameSnapshot) => void,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not supported on this device.');
    this.ctx = ctx;
    this.state = createGame(Date.now(), loadBest());
    this.sfx = new Sfx(loadMuted());

    this.detachInput = attachInput(surface, {
      onAction: (a) => this.handleAction(a),
      onTap: () => this.handleTap(),
      onPauseKey: () => this.togglePause(),
      onConfirmKey: () => this.handleTap(),
    });
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('blur', this.onVisibility);
    this.resize();
    this.raf = requestAnimationFrame(this.loop);
    this.emit();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.detachInput();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('blur', this.onVisibility);
  }

  // -------------------------------------------------------------------------
  // Public controls (used by React buttons)
  // -------------------------------------------------------------------------

  start(): void {
    this.sfx.unlock();
    this.state = startGame(this.state);
    this.queue = [];
    this.newBest = false;
    this.emit();
  }

  pause(): void {
    if (this.state.phase !== 'playing') return;
    pause(this.state);
    this.emit();
  }

  resume(): void {
    if (this.state.phase !== 'paused') return;
    this.sfx.unlock();
    this.queue = [];
    resume(this.state);
    this.last = performance.now();
    this.emit();
  }

  togglePause(): void {
    if (this.state.phase === 'playing') this.pause();
    else if (this.state.phase === 'paused') this.resume();
  }

  toggleMute(): void {
    this.sfx.muted = !this.sfx.muted;
    saveMuted(this.sfx.muted);
    this.sfx.unlock();
    this.emit();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private handleAction(a: Action): void {
    const phase = this.state.phase;
    if (phase === 'playing') {
      this.queue.push(a);
    } else if (phase === 'over' && a === 'jump') {
      // Space / swipe-up on the results screen = instant restart.
      this.handleTap();
    } else if (phase === 'ready') {
      this.start();
    }
  }

  private handleTap(): void {
    const phase = this.state.phase;
    if (phase === 'ready') this.start();
    else if (phase === 'paused') this.resume();
    else if (phase === 'over' && performance.now() - this.overAt > RESTART_LOCKOUT_MS) this.start();
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sat = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sat')) || 0;
    this.renderer.safeTop = sat;
    this.renderer.resize(w, h);
  }

  private loop = (now: number): void => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = this.last ? Math.min((now - this.last) / 1000, 0.1) : 0;
    this.last = now;

    const before = this.state.phase;
    if (before === 'playing') {
      step(this.state, dt, this.queue);
      this.queue = [];
    }

    const events = this.state.events;
    if (events.length) {
      for (const e of events) {
        switch (e.type) {
          case 'coin':
            this.sfx.coin();
            break;
          case 'jump':
            this.sfx.jump();
            break;
          case 'slide':
            this.sfx.slide();
            break;
          case 'lane':
            this.sfx.lane();
            break;
          case 'bump':
            this.sfx.bump();
            break;
          case 'powerup':
            this.sfx.powerup();
            break;
          case 'shieldBreak':
            this.sfx.shieldBreak();
            vibrate(40);
            break;
          case 'whistle':
            this.sfx.whistle();
            break;
          case 'agbero':
            this.sfx.agbero();
            break;
          case 'milestone':
            this.sfx.milestone();
            break;
          case 'crash':
            this.sfx.crash();
            vibrate([80, 40, 120]);
            break;
        }
      }
      this.renderer.handleEvents(events, this.state);
      this.state.events = [];
    }

    if (before === 'playing' && this.state.phase === 'over') {
      this.overAt = performance.now();
      this.newBest = saveBest(this.state.score);
      this.emit();
    }

    this.renderer.draw(this.ctx, this.state, this.state.phase === 'paused' ? 0 : dt);
  };

  private emit(): void {
    const s = this.state;
    this.onChange({
      phase: s.phase,
      score: Math.floor(s.score),
      coins: s.coins,
      best: Math.max(s.best, loadBest()),
      newBest: this.newBest,
      crashedBy: s.crashedBy,
      muted: this.sfx.muted,
    });
  }
}

function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}

import type { Rng } from './rng';

export type Lane = -1 | 0 | 1;
export type ObstacleKind = 'danfo' | 'pothole' | 'barrier' | 'police' | 'agbero';
export type PowerKind = 'magnet' | 'shield' | 'double';
export type Phase = 'ready' | 'playing' | 'paused' | 'over';
export type Action = 'left' | 'right' | 'jump' | 'slide';

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  lane: Lane; // lane it spawned in
  /** Current lane position (police slide sideways between lanes). */
  x: number;
  /** Police only: the lane they will step into as you approach. */
  targetLane: Lane | null;
  /** Police has started stepping / agbero has started charging. */
  triggered: boolean;
  z: number;
  depth: number;
  /** Cosmetic variant (livery colour, sign text, …). */
  variant: number;
  /** Set once the obstacle has been absorbed by a shield. */
  spent: boolean;
}

export interface Coin {
  id: number;
  x: number; // lane coordinate, may be fractional while magnetised
  y: number; // height above the road
  z: number;
  taken: boolean;
}

export interface PowerUp {
  id: number;
  kind: PowerKind;
  lane: Lane;
  z: number;
  taken: boolean;
}

export interface Player {
  lane: Lane; // target lane
  x: number; // current (animated) lane position
  y: number; // height above road
  vy: number;
  slideTime: number; // > 0 while sliding
  fastFall: boolean;
  slideQueued: boolean;
  jumpBuffer: number;
  invulnerable: number;
  runPhase: number; // drives the running animation
}

export interface Effects {
  magnet: number; // seconds left
  double: number; // seconds left
  shield: boolean;
}

export type GameEvent =
  | { type: 'coin' }
  | { type: 'powerup'; kind: PowerKind }
  | { type: 'jump' }
  | { type: 'slide' }
  | { type: 'lane' }
  | { type: 'bump' }
  | { type: 'shieldBreak' }
  | { type: 'whistle' }
  | { type: 'agbero' }
  | { type: 'crash'; kind: ObstacleKind }
  | { type: 'milestone'; score: number };

export interface GameState {
  phase: Phase;
  time: number;
  distance: number;
  speed: number;
  score: number;
  coins: number;
  best: number;
  player: Player;
  obstacles: Obstacle[];
  coinItems: Coin[];
  powerups: PowerUp[];
  effects: Effects;
  /** World z at which the next obstacle row will be placed. */
  rowFrontier: number;
  rowsSpawned: number;
  nextPowerupIn: number; // seconds
  nextMilestone: number;
  crashedBy: ObstacleKind | null;
  events: GameEvent[];
  rng: Rng;
  nextId: number;
}

import { describe, expect, it } from 'vitest';
import {
  AGBERO_CHARGE,
  BASE_SPEED,
  COIN_SCORE,
  MAX_SPEED,
  OBSTACLE_DEPTH,
  SLIDE_DURATION,
  SPEED_RAMP,
} from './constants';
import { applyAction, collides, jumpTimeScale, createGame, createPlayer, difficulty, spawnRow, startGame, step } from './engine';
import type { Action, GameState, Lane, Obstacle, ObstacleKind } from './types';

/** A started game with an empty road, so tests control exactly what is placed. */
function emptyGame(seed = 1): GameState {
  const g = startGame(createGame(seed), seed);
  g.obstacles = [];
  g.coinItems = [];
  g.powerups = [];
  g.rowFrontier = 1e9; // stop procedural spawning
  g.nextPowerupIn = 1e9;
  g.events = [];
  return g;
}

/** Advance the simulation in 60 fps frames (step() clamps single frames to 0.1 s). */
function run(g: GameState, seconds: number, actions: Action[] = []): void {
  step(g, Math.min(seconds, 1 / 60), actions);
  for (let t = 1 / 60; t < seconds - 1e-9; t += 1 / 60) step(g, Math.min(1 / 60, seconds - t));
}

function obstacle(kind: ObstacleKind, lane: Lane, z: number): Obstacle {
  return {
    id: 999,
    kind,
    lane,
    x: lane,
    targetLane: null,
    triggered: false,
    z,
    depth: OBSTACLE_DEPTH[kind],
    variant: 0,
    spent: false,
  };
}

describe('game lifecycle', () => {
  it('starts in the ready phase and begins playing on start', () => {
    const g = createGame(42);
    expect(g.phase).toBe('ready');
    const s = startGame(g, 42);
    expect(s.phase).toBe('playing');
    expect(s.obstacles.length).toBeGreaterThan(0);
    expect(s.score).toBe(0);
  });

  it('does not advance while paused or over', () => {
    const g = emptyGame();
    g.phase = 'paused';
    run(g, 1);
    expect(g.distance).toBe(0);
  });

  it('restart carries the best score forward', () => {
    const g = emptyGame();
    g.score = 1234;
    g.phase = 'over';
    const next = startGame(g);
    expect(next.best).toBe(1234);
    expect(next.score).toBe(0);
  });
});

describe('movement', () => {
  it('changes lane and clamps at the edges', () => {
    const g = emptyGame();
    applyAction(g, 'left');
    expect(g.player.lane).toBe(-1);
    applyAction(g, 'left');
    expect(g.player.lane).toBe(-1);
    expect(g.events.some((e) => e.type === 'bump')).toBe(true);
    run(g, 0.3);
    expect(g.player.x).toBeCloseTo(-1);
    applyAction(g, 'right');
    applyAction(g, 'right');
    applyAction(g, 'right');
    expect(g.player.lane).toBe(1);
  });

  it('jumps and lands back on the road', () => {
    const g = emptyGame();
    run(g, 0.01, ['jump']);
    expect(g.player.y).toBeGreaterThan(0);
    let peak = 0;
    for (let t = 0; t < 1.2; t += 0.01) {
      run(g, 0.01);
      peak = Math.max(peak, g.player.y);
    }
    expect(peak).toBeGreaterThan(1.5);
    expect(g.player.y).toBe(0);
  });

  it('jumps get quicker (not lower) at high speed', () => {
    expect(jumpTimeScale(BASE_SPEED)).toBe(1);
    expect(jumpTimeScale(MAX_SPEED)).toBeLessThan(0.7);
    const airtime = (speed: number) => {
      const g = emptyGame();
      g.time = (speed - BASE_SPEED) / SPEED_RAMP; // keep speed fixed via the ramp
      g.speed = speed;
      run(g, 1 / 60, ['jump']);
      let t = 1 / 60;
      while (g.player.y > 0 && t < 3) {
        run(g, 1 / 60);
        t += 1 / 60;
      }
      return t;
    };
    expect(airtime(MAX_SPEED)).toBeLessThan(airtime(BASE_SPEED));
  });

  it('slides for a limited time', () => {
    const g = emptyGame();
    run(g, 0.01, ['slide']);
    expect(g.player.slideTime).toBeGreaterThan(0);
    run(g, SLIDE_DURATION + 0.05);
    expect(g.player.slideTime).toBe(0);
  });

  it('swiping down mid-air fast-falls into a slide', () => {
    const g = emptyGame();
    run(g, 0.1, ['jump']);
    run(g, 0.01, ['slide']);
    let t = 0;
    while (g.player.y > 0 && t < 2) {
      run(g, 0.01);
      t += 0.01;
    }
    expect(t).toBeLessThan(0.3);
    expect(g.player.slideTime).toBeGreaterThan(0);
  });
});

describe('collisions', () => {
  it('crashes into a danfo in the same lane', () => {
    const g = emptyGame();
    g.obstacles.push(obstacle('danfo', 0, 6));
    run(g, 1);
    expect(g.phase).toBe('over');
    expect(g.crashedBy).toBe('danfo');
  });

  it('passes a danfo in another lane', () => {
    const g = emptyGame();
    g.obstacles.push(obstacle('danfo', 1, 6));
    run(g, 1);
    expect(g.phase).toBe('playing');
  });

  it('can dodge by changing lane in time', () => {
    const g = emptyGame();
    g.obstacles.push(obstacle('danfo', 0, 12));
    run(g, 0.01, ['left']);
    run(g, 1.5);
    expect(g.phase).toBe('playing');
  });

  it('jumping clears a pothole, running into one does not', () => {
    const p = createPlayer();
    const hole = obstacle('pothole', 0, 0);
    expect(collides(p, hole)).toBe(true);
    p.y = 1;
    expect(collides(p, hole)).toBe(false);
  });

  it('sliding clears a barrier, standing or jumping does not', () => {
    const p = createPlayer();
    const bar = obstacle('barrier', 0, 0);
    expect(collides(p, bar)).toBe(true);
    p.slideTime = 0.3;
    expect(collides(p, bar)).toBe(false);
    p.slideTime = 0;
    p.y = 1.5;
    expect(collides(p, bar)).toBe(true);
  });

  it('danfos cannot be jumped', () => {
    const p = createPlayer();
    p.y = 1.8;
    expect(collides(p, obstacle('danfo', 0, 0))).toBe(true);
  });

  it('a well-timed jump survives a pothole in a real run', () => {
    const g = emptyGame();
    g.obstacles.push(obstacle('pothole', 0, 5));
    // Jump just before reaching it (~0.25 s away at base speed).
    run(g, 0.2);
    run(g, 0.01, ['jump']);
    run(g, 1);
    expect(g.phase).toBe('playing');
  });

  it('a shield absorbs one hit then is consumed', () => {
    const g = emptyGame();
    g.effects.shield = true;
    g.obstacles.push(obstacle('danfo', 0, 4));
    run(g, 0.6);
    expect(g.phase).toBe('playing');
    expect(g.effects.shield).toBe(false);
    expect(g.events.some((e) => e.type === 'shieldBreak')).toBe(true);
    g.player.invulnerable = 0;
    g.obstacles.push(obstacle('pothole', 0, 3));
    run(g, 0.5);
    expect(g.phase).toBe('over');
  });
});

describe('police & agbero', () => {
  it('police step into their target lane as you approach', () => {
    const g = emptyGame();
    const cop = { ...obstacle('police', 0, 40), targetLane: 1 as Lane };
    g.obstacles.push(cop);
    run(g, 0.3);
    expect(cop.x).toBe(0); // still far away: standing still
    run(g, 1.3);
    expect(cop.triggered).toBe(true);
    expect(cop.x).toBe(1);
    expect(g.events.some((e) => e.type === 'whistle')).toBe(true);
  });

  it('police catch you in the lane they step into', () => {
    const g = emptyGame();
    applyAction(g, 'right'); // dodge to lane 1 early… right where the officer goes
    g.obstacles.push({ ...obstacle('police', 0, 30), targetLane: 1 });
    run(g, 3);
    expect(g.phase).toBe('over');
    expect(g.crashedBy).toBe('police');
  });

  it('police cannot be jumped or slid under', () => {
    const p = createPlayer();
    const cop = obstacle('police', 0, 0);
    p.y = 1.8;
    expect(collides(p, cop)).toBe(true);
    p.y = 0;
    p.slideTime = 0.3;
    expect(collides(p, cop)).toBe(true);
  });

  it('agbero charge at you when close', () => {
    const g = emptyGame();
    const tout = obstacle('agbero', 1, 30);
    g.obstacles.push(tout);
    const roadTravel = () => g.speed / 60;
    let extra = 0;
    for (let i = 0; i < 90; i++) {
      const before = tout.z;
      const travel = roadTravel();
      run(g, 1 / 60);
      extra += before - tout.z - travel;
    }
    expect(tout.triggered).toBe(true);
    expect(extra).toBeGreaterThan(1);
    expect(g.events.some((e) => e.type === 'agbero')).toBe(true);
  });

  it('agbero must be jumped', () => {
    const p = createPlayer();
    const tout = obstacle('agbero', 0, 0);
    expect(collides(p, tout)).toBe(true);
    p.slideTime = 0.3;
    expect(collides(p, tout)).toBe(true);
    p.slideTime = 0;
    p.y = 1;
    expect(collides(p, tout)).toBe(false);
  });

  it('police and agbero appear once the run gets going', () => {
    const g = emptyGame(3);
    g.speed = MAX_SPEED;
    g.rowsSpawned = 10;
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      g.obstacles = [];
      spawnRow(g, 50);
      g.obstacles.forEach((o) => seen.add(o.kind));
    }
    expect(seen.has('police')).toBe(true);
    expect(seen.has('agbero')).toBe(true);
  });

  it('the first rows have no police or agbero', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const g = startGame(createGame(seed), seed);
      const early = g.obstacles.filter((o) => o.kind === 'police' || o.kind === 'agbero');
      expect(early).toEqual([]);
    }
  });
});

describe('pickups & scoring', () => {
  it('collects coins in the player lane', () => {
    const g = emptyGame();
    g.coinItems.push({ id: 1, x: 0, y: 0.5, z: 3, taken: false });
    g.coinItems.push({ id: 2, x: 1, y: 0.5, z: 3, taken: false });
    const before = g.score;
    run(g, 0.5);
    expect(g.coins).toBe(1);
    expect(g.score - before).toBeGreaterThanOrEqual(COIN_SCORE);
  });

  it('magnet pulls coins from other lanes', () => {
    const g = emptyGame();
    g.effects.magnet = 5;
    g.coinItems.push({ id: 1, x: 1, y: 0.5, z: 8, taken: false });
    run(g, 1);
    expect(g.coins).toBe(1);
  });

  it('double naira doubles coin value', () => {
    const g = emptyGame();
    g.effects.double = 5;
    g.coinItems.push({ id: 1, x: 0, y: 0.5, z: 0.1, taken: false });
    const before = g.score;
    run(g, 0.001);
    expect(g.score - before).toBeGreaterThanOrEqual(COIN_SCORE * 2);
  });

  it('power-ups activate their effect', () => {
    const g = emptyGame();
    g.powerups.push({ id: 1, kind: 'magnet', lane: 0, z: 2, taken: false });
    run(g, 0.5);
    expect(g.effects.magnet).toBeGreaterThan(0);
  });

  it('score grows with distance', () => {
    const g = emptyGame();
    run(g, 2);
    expect(g.score).toBeGreaterThan(10);
    expect(g.distance).toBeGreaterThan(BASE_SPEED * 2 - 1);
  });
});

describe('difficulty & generation', () => {
  it('speeds up over time and caps at max speed', () => {
    const g = emptyGame();
    g.effects.shield = false;
    const s0 = g.speed;
    for (let i = 0; i < 60; i++) run(g, 0.1);
    expect(g.speed).toBeGreaterThan(s0);
    for (let i = 0; i < 3000; i++) run(g, 0.1);
    expect(g.speed).toBe(MAX_SPEED);
    expect(difficulty(g)).toBe(1);
  });

  it('every row leaves at least one lane free of danfos and police', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const g = emptyGame(seed);
      g.speed = MAX_SPEED; // hardest setting
      g.rowsSpawned = 10; // past warm-up, so police & agbero can appear
      for (let row = 0; row < 200; row++) {
        g.obstacles = [];
        spawnRow(g, 50);
        // Lanes you cannot pass through: danfos, plus police start AND target lanes.
        const hardLanes = new Set<number>();
        for (const o of g.obstacles) {
          if (o.kind === 'danfo' || o.kind === 'police') hardLanes.add(o.lane);
          if (o.targetLane !== null) hardLanes.add(o.targetLane);
        }
        expect(hardLanes.size).toBeLessThanOrEqual(2);
        expect(g.obstacles.length).toBeGreaterThan(0);
        const lanes = new Set(g.obstacles.map((o) => o.lane));
        expect(lanes.size).toBe(g.obstacles.length); // one obstacle per lane
      }
    }
  });

  it('is deterministic for a given seed', () => {
    const a = startGame(createGame(7), 7);
    const b = startGame(createGame(7), 7);
    expect(a.obstacles.map((o) => [o.kind, o.lane, o.z])).toEqual(b.obstacles.map((o) => [o.kind, o.lane, o.z]));
  });

  it('a simple autopilot survives the first minute (road is fair)', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const g = startGame(createGame(seed), seed);
      for (let i = 0; i < 60 * 60 && g.phase === 'playing'; i++) {
        autopilot(g);
        run(g, 1 / 60);
      }
      expect(g.phase, `seed ${seed} crashed at t=${g.time.toFixed(1)} by ${g.crashedBy}`).toBe('playing');
    }
  });
});

/** Greedy bot: head for the safest lane, jump potholes/agbero, slide barriers. */
function autopilot(g: GameState): void {
  const p = g.player;
  // Police block both the lane they stand in and the lane they will step into.
  const lanesOf = (o: Obstacle) =>
    o.kind === 'police' && o.targetLane !== null ? [Math.round(o.x), o.targetLane] : [Math.round(o.x)];
  const hard = (o: Obstacle) => o.kind === 'danfo' || o.kind === 'police';
  const ahead = (lane: number, maxZ: number) =>
    g.obstacles.filter((o) => lanesOf(o).includes(lane) && o.z + o.depth / 2 > -0.5 && o.z - o.depth / 2 < maxZ);
  const look = g.speed * 0.9;
  const cost = (lane: number) => {
    let c = Math.abs(lane - p.lane) * 0.1;
    // Never step sideways into something we are already level with.
    if (lane !== p.lane && ahead(lane, g.speed * 0.2 + 1).some((o) => o.z > -0.5)) c += 500;
    for (const o of ahead(lane, look)) c += hard(o) ? 100 / Math.max(1, o.z) : 1;
    // Must be able to pass through intermediate lanes.
    if (Math.abs(lane - p.lane) === 2) {
      for (const o of ahead(0, g.speed * 0.25 + 2)) if (hard(o)) c += 1000;
    }
    return c;
  };
  const best = ([-1, 0, 1] as const).reduce((a, b) => (cost(b) < cost(a) ? b : a));
  if (best < p.lane) applyAction(g, 'left');
  else if (best > p.lane) applyAction(g, 'right');

  for (const o of ahead(Math.round(p.x), g.speed * 0.6)) {
    const closing = g.speed * (o.kind === 'agbero' && o.triggered ? 1 + AGBERO_CHARGE : 1);
    const eta = (o.z - o.depth / 2 - 0.45) / closing;
    if ((o.kind === 'pothole' || o.kind === 'agbero') && eta < 0.12 && p.y === 0 && p.vy === 0) {
      applyAction(g, 'jump');
    }
    if (o.kind === 'barrier' && eta < 0.15 && p.slideTime <= 0.05) applyAction(g, 'slide');
  }
}

import {
  AGBERO_CHARGE,
  AGBERO_CLEAR_HEIGHT,
  AGBERO_TRIGGER_TIME,
  BASE_SPEED,
  COIN_SCORE,
  COIN_SPACING,
  DESPAWN_Z,
  DOUBLE_DURATION,
  FAST_FALL_MULTIPLIER,
  GRAVITY,
  JUMP_BUFFER_TIME,
  JUMP_VELOCITY,
  LANE_CHANGE_RATE,
  LANE_HIT_TOLERANCE,
  MAGNET_DURATION,
  MAGNET_RANGE_Z,
  MAX_LANE,
  MAX_SPEED,
  MIN_LANE,
  OBSTACLE_DEPTH,
  PLAYER_HALF_DEPTH,
  POLICE_STEP_RATE,
  POLICE_TRIGGER_TIME,
  POTHOLE_CLEAR_HEIGHT,
  POWERUP_INTERVAL_MAX,
  POWERUP_INTERVAL_MIN,
  ROW_GAP_EASY,
  ROW_GAP_HARD,
  SHIELD_GRACE,
  SLIDE_DURATION,
  SPAWN_Z,
  SPECIALS_AFTER_ROWS,
  SPEED_RAMP,
} from './constants';
import { createRng, pick, shuffle } from './rng';
import type {
  Action,
  GameState,
  Lane,
  Obstacle,
  ObstacleKind,
  Player,
  PowerKind,
} from './types';

const LANES: readonly Lane[] = [-1, 0, 1];
const MAX_SUBSTEP = 1 / 120;
const FIRST_ROW_Z = 34;
const MILESTONE_EVERY = 1000;

export function createPlayer(): Player {
  return {
    lane: 0,
    x: 0,
    y: 0,
    vy: 0,
    slideTime: 0,
    fastFall: false,
    slideQueued: false,
    jumpBuffer: 0,
    invulnerable: 0,
    runPhase: 0,
  };
}

export function createGame(seed: number = Date.now(), best = 0): GameState {
  const rng = createRng(seed);
  return {
    phase: 'ready',
    time: 0,
    distance: 0,
    speed: BASE_SPEED,
    score: 0,
    coins: 0,
    best,
    player: createPlayer(),
    obstacles: [],
    coinItems: [],
    powerups: [],
    effects: { magnet: 0, double: 0, shield: false },
    rowFrontier: FIRST_ROW_Z,
    rowsSpawned: 0,
    nextPowerupIn: randRange(rng(), POWERUP_INTERVAL_MIN * 0.6, POWERUP_INTERVAL_MAX * 0.6),
    nextMilestone: MILESTONE_EVERY,
    crashedBy: null,
    events: [],
    rng,
    nextId: 1,
  };
}

/** Begin (or restart) a run. A fresh seed gives a new road every time. */
export function startGame(prev: GameState, seed: number = Date.now()): GameState {
  const next = createGame(seed, Math.max(prev.best, Math.floor(prev.score)));
  next.phase = 'playing';
  fillRoad(next);
  return next;
}

export function difficulty(state: Pick<GameState, 'speed'>): number {
  return clamp((state.speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED), 0, 1);
}

export function scoreMultiplier(state: GameState): number {
  return state.effects.double > 0 ? 2 : 1;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export function applyAction(state: GameState, action: Action): void {
  const p = state.player;
  switch (action) {
    case 'left':
    case 'right': {
      const dir = action === 'left' ? -1 : 1;
      const target = p.lane + dir;
      if (target < MIN_LANE || target > MAX_LANE) {
        state.events.push({ type: 'bump' });
        return;
      }
      p.lane = target as Lane;
      state.events.push({ type: 'lane' });
      return;
    }
    case 'jump': {
      if (isGrounded(p)) {
        doJump(state);
      } else {
        // Remember the press so a slightly early tap still jumps on landing.
        p.jumpBuffer = JUMP_BUFFER_TIME;
      }
      return;
    }
    case 'slide': {
      if (isGrounded(p)) {
        if (p.slideTime <= 0) state.events.push({ type: 'slide' });
        p.slideTime = SLIDE_DURATION;
      } else {
        // Slam down quickly and slide on landing.
        p.fastFall = true;
        p.slideQueued = true;
        if (p.vy > 0) p.vy = 0;
      }
      return;
    }
  }
}

/**
 * Jumps keep the same height but get quicker as the road speeds up, so a jump
 * always covers a similar stretch of road and never overlaps the next row.
 */
export function jumpTimeScale(speed: number): number {
  return Math.sqrt(BASE_SPEED / Math.max(BASE_SPEED, speed));
}

function doJump(state: GameState): void {
  const p = state.player;
  p.vy = JUMP_VELOCITY / jumpTimeScale(state.speed);
  p.y = Math.max(p.y, 0.0001);
  p.slideTime = 0;
  p.slideQueued = false;
  p.fastFall = false;
  p.jumpBuffer = 0;
  state.events.push({ type: 'jump' });
}

export function isGrounded(p: Player): boolean {
  return p.y <= 0 && p.vy <= 0;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

export function step(state: GameState, dt: number, actions: readonly Action[] = []): void {
  if (state.phase !== 'playing') return;
  for (const a of actions) applyAction(state, a);

  // Clamp huge frame gaps (tab switches) and sub-step so fast objects never
  // tunnel through the player.
  let remaining = Math.min(dt, 0.1);
  while (remaining > 0 && state.phase === 'playing') {
    const h = Math.min(remaining, MAX_SUBSTEP);
    tick(state, h);
    remaining -= h;
  }
}

function tick(state: GameState, dt: number): void {
  state.time += dt;
  state.speed = Math.min(MAX_SPEED, BASE_SPEED + state.time * SPEED_RAMP);
  const travel = state.speed * dt;
  state.distance += travel;
  state.score += travel * 0.5 * scoreMultiplier(state);

  if (state.score >= state.nextMilestone) {
    state.events.push({ type: 'milestone', score: state.nextMilestone });
    state.nextMilestone += MILESTONE_EVERY;
  }

  updatePlayer(state, dt);
  updateEffects(state, dt);

  updateObstacles(state, dt, travel);
  for (const c of state.coinItems) c.z -= travel;
  for (const u of state.powerups) u.z -= travel;
  state.rowFrontier -= travel;

  state.nextPowerupIn -= dt;
  fillRoad(state);

  if (state.effects.magnet > 0) attractCoins(state, dt);
  collectCoins(state);
  collectPowerups(state);
  checkObstacles(state);
  cleanup(state);
}

function updatePlayer(state: GameState, dt: number): void {
  const p = state.player;

  // Smooth lane change.
  const dx = p.lane - p.x;
  const maxMove = LANE_CHANGE_RATE * dt;
  p.x = Math.abs(dx) <= maxMove ? p.lane : p.x + Math.sign(dx) * maxMove;

  // Vertical motion.
  if (p.y > 0 || p.vy > 0) {
    const k = jumpTimeScale(state.speed);
    const g = (GRAVITY / (k * k)) * (p.fastFall ? FAST_FALL_MULTIPLIER : 1);
    p.vy -= g * dt;
    p.y += p.vy * dt;
    if (p.y <= 0) {
      p.y = 0;
      p.vy = 0;
      p.fastFall = false;
      if (p.jumpBuffer > 0) {
        doJump(state);
      } else if (p.slideQueued) {
        p.slideQueued = false;
        p.slideTime = SLIDE_DURATION;
        state.events.push({ type: 'slide' });
      }
    }
  }

  if (p.jumpBuffer > 0) p.jumpBuffer = Math.max(0, p.jumpBuffer - dt);
  if (p.slideTime > 0) p.slideTime = Math.max(0, p.slideTime - dt);
  if (p.invulnerable > 0) p.invulnerable = Math.max(0, p.invulnerable - dt);
  p.runPhase += dt * (6 + state.speed * 0.35);
}

function updateEffects(state: GameState, dt: number): void {
  const e = state.effects;
  if (e.magnet > 0) e.magnet = Math.max(0, e.magnet - dt);
  if (e.double > 0) e.double = Math.max(0, e.double - dt);
}

/** Moves obstacles toward the player and runs police / agbero behaviour. */
function updateObstacles(state: GameState, dt: number, travel: number): void {
  for (const o of state.obstacles) {
    o.z -= travel;
    if (o.kind === 'agbero') {
      if (!o.triggered && o.z < state.speed * AGBERO_TRIGGER_TIME) {
        o.triggered = true;
        state.events.push({ type: 'agbero' });
      }
      if (o.triggered) o.z -= state.speed * AGBERO_CHARGE * dt;
    } else if (o.kind === 'police' && o.targetLane !== null) {
      if (!o.triggered && o.z < state.speed * POLICE_TRIGGER_TIME) {
        o.triggered = true;
        state.events.push({ type: 'whistle' });
      }
      if (o.triggered) {
        const dx = o.targetLane - o.x;
        const step = POLICE_STEP_RATE * dt;
        o.x = Math.abs(dx) <= step ? o.targetLane : o.x + Math.sign(dx) * step;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Road generation
// ---------------------------------------------------------------------------

/** Spawn obstacle rows until the road ahead is populated up to SPAWN_Z. */
export function fillRoad(state: GameState): void {
  while (state.rowFrontier < SPAWN_Z) {
    spawnRow(state, state.rowFrontier);
    const gapTime = lerp(ROW_GAP_EASY, ROW_GAP_HARD, difficulty(state));
    state.rowFrontier += gapTime * state.speed;
  }
}

export function spawnRow(state: GameState, z: number): void {
  const rng = state.rng;
  const d = difficulty(state);
  const kinds: (ObstacleKind | null)[] = [null, null, null];
  const order = shuffle(rng, [0, 1, 2]);
  let policeTarget: Lane | null = null;

  // The first couple of rows are gentle so a new player can get their bearings.
  const warmup = state.rowsSpawned < 2;
  const specials = state.rowsSpawned >= SPECIALS_AFTER_ROWS;
  const pPolice = specials ? 0.1 + 0.14 * d : 0;

  if (rng() < pPolice) {
    // Police row: the officer steps from one lane into a neighbouring one, so
    // both lanes count as blocked. The third lane is always passable.
    const start = order[0];
    const target = start === 1 ? pick(rng, [0, 2]) : 1;
    const free = 3 - start - target;
    kinds[start] = 'police';
    policeTarget = LANES[target];
    if (rng() < 0.3 + 0.3 * d) kinds[free] = pickHazard(rng, d, specials);
  } else {
    const pTwoDanfos = warmup ? 0 : 0.2 + 0.45 * d;
    const pOneDanfo = warmup ? 0.5 : 0.45;
    const roll = rng();
    const danfos = roll < pTwoDanfos ? 2 : roll < pTwoDanfos + pOneDanfo ? 1 : 0;
    for (let i = 0; i < danfos; i++) kinds[order[i]] = 'danfo';

    const pHazard = warmup ? 0.2 : 0.25 + 0.45 * d;
    for (let i = danfos; i < 3; i++) {
      if (rng() < pHazard) kinds[order[i]] = pickHazard(rng, d, specials);
    }
    // Never waste a row: an empty one gets at least one hazard.
    if (!kinds.some(Boolean)) kinds[order[0]] = pickHazard(rng, d, specials);
  }

  // An agbero's charge makes him arrive early. Start him further back so he
  // reaches you on the row's beat and never squeezes into the gap in front.
  const triggerDist = state.speed * AGBERO_TRIGGER_TIME;
  const agberoOffset = triggerDist * (1 - 1 / (1 + AGBERO_CHARGE));

  kinds.forEach((kind, i) => {
    if (!kind) return;
    const o: Obstacle = {
      id: state.nextId++,
      kind,
      lane: LANES[i],
      x: LANES[i],
      targetLane: kind === 'police' ? policeTarget : null,
      triggered: false,
      z: kind === 'agbero' ? z + agberoOffset : z,
      depth: OBSTACLE_DEPTH[kind],
      variant: Math.floor(rng() * 1000),
      spent: false,
    };
    state.obstacles.push(o);
  });

  // Lanes nothing will occupy (the police officer's destination counts as taken).
  const blocked = (i: number) => kinds[i] !== null || (policeTarget !== null && LANES[i] === policeTarget);
  const freeLanes = LANES.filter((_, i) => !blocked(i));

  // Power-up: placed in an empty lane just after the row.
  if (state.nextPowerupIn <= 0 && freeLanes.length > 0) {
    const kind = pick<PowerKind>(rng, ['magnet', 'shield', 'double']);
    state.powerups.push({ id: state.nextId++, kind, lane: pick(rng, freeLanes), z: z + 1, taken: false });
    state.nextPowerupIn = randRange(rng(), POWERUP_INTERVAL_MIN, POWERUP_INTERVAL_MAX);
  } else if (rng() < 0.7) {
    // Coins go in safe lanes or over hazards you can clear in place.
    const coinLanes = LANES.filter(
      (_, i) => !blocked(i) || kinds[i] === 'pothole' || kinds[i] === 'barrier',
    );
    const lane = pick(rng, coinLanes);
    const kind = kinds[LANES.indexOf(lane)];
    if (kind === 'pothole') {
      // Arc of coins that rewards a well-timed jump.
      const arc = [0.9, 1.6, 2.0, 1.6, 0.9];
      arc.forEach((y, i) => addCoin(state, lane, y, z + (i - 2) * 1.6));
    } else if (kind === 'barrier') {
      // Low coins collected while sliding underneath.
      for (let i = -1; i <= 1; i++) addCoin(state, lane, 0.35, z + i * 1.4);
    } else {
      for (let i = 0; i < 4; i++) addCoin(state, lane, 0.5, z - 1 + i * COIN_SPACING);
    }
  }

  state.rowsSpawned++;
}

/** A hazard you can clear without changing lane. Agbero appear as difficulty rises. */
function pickHazard(rng: () => number, d: number, specials: boolean): ObstacleKind {
  const pAgbero = specials ? 0.18 + 0.22 * d : 0;
  const r = rng();
  if (r < pAgbero) return 'agbero';
  return rng() < 0.55 ? 'pothole' : 'barrier';
}

function addCoin(state: GameState, lane: Lane, y: number, z: number): void {
  state.coinItems.push({ id: state.nextId++, x: lane, y, z, taken: false });
}

// ---------------------------------------------------------------------------
// Collisions & pickups
// ---------------------------------------------------------------------------

function playerCenterY(p: Player): number {
  return p.y + (p.slideTime > 0 ? 0.3 : 0.6);
}

function attractCoins(state: GameState, dt: number): void {
  const p = state.player;
  const pull = 1 - Math.exp(-12 * dt);
  for (const c of state.coinItems) {
    if (c.taken || c.z > MAGNET_RANGE_Z || c.z < -1) continue;
    c.x += (p.x - c.x) * pull;
    c.y += (playerCenterY(p) - c.y) * pull;
    c.z += (0 - c.z) * pull * 0.5;
  }
}

function collectCoins(state: GameState): void {
  const p = state.player;
  const py = playerCenterY(p);
  for (const c of state.coinItems) {
    if (c.taken) continue;
    if (Math.abs(c.z) < 0.9 && Math.abs(c.x - p.x) < 0.6 && Math.abs(c.y - py) < 1.0) {
      c.taken = true;
      state.coins += 1;
      state.score += COIN_SCORE * scoreMultiplier(state);
      state.events.push({ type: 'coin' });
    }
  }
}

function collectPowerups(state: GameState): void {
  const p = state.player;
  for (const u of state.powerups) {
    if (u.taken) continue;
    if (Math.abs(u.z) < 0.9 && Math.abs(u.lane - p.x) < 0.6 && p.y < 2.2) {
      u.taken = true;
      if (u.kind === 'magnet') state.effects.magnet = MAGNET_DURATION;
      if (u.kind === 'double') state.effects.double = DOUBLE_DURATION;
      if (u.kind === 'shield') state.effects.shield = true;
      state.events.push({ type: 'powerup', kind: u.kind });
    }
  }
}

/** Would this obstacle hurt the player in their current pose? */
export function collides(p: Player, o: Obstacle): boolean {
  if (o.spent) return false;
  if (Math.abs(o.z) >= o.depth / 2 + PLAYER_HALF_DEPTH) return false;
  if (Math.abs(o.x - p.x) >= LANE_HIT_TOLERANCE) return false;
  switch (o.kind) {
    case 'pothole':
      return p.y < POTHOLE_CLEAR_HEIGHT;
    case 'barrier':
      return p.slideTime <= 0;
    case 'agbero':
      return p.y < AGBERO_CLEAR_HEIGHT;
    case 'danfo':
    case 'police':
      return true;
  }
}

function checkObstacles(state: GameState): void {
  const p = state.player;
  for (const o of state.obstacles) {
    if (!collides(p, o)) continue;
    if (p.invulnerable > 0) continue;
    if (state.effects.shield) {
      state.effects.shield = false;
      o.spent = true;
      p.invulnerable = SHIELD_GRACE;
      state.events.push({ type: 'shieldBreak' });
      continue;
    }
    crash(state, o.kind);
    return;
  }
}

function crash(state: GameState, kind: ObstacleKind): void {
  state.phase = 'over';
  state.crashedBy = kind;
  state.score = Math.floor(state.score);
  state.best = Math.max(state.best, state.score);
  state.events.push({ type: 'crash', kind });
}

function cleanup(state: GameState): void {
  state.obstacles = state.obstacles.filter((o) => o.z > DESPAWN_Z);
  state.coinItems = state.coinItems.filter((c) => !c.taken && c.z > DESPAWN_Z);
  state.powerups = state.powerups.filter((u) => !u.taken && u.z > DESPAWN_Z);
}

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function randRange(r: number, lo: number, hi: number): number {
  return lo + r * (hi - lo);
}

export function pause(state: GameState): void {
  if (state.phase === 'playing') state.phase = 'paused';
}

export function resume(state: GameState): void {
  if (state.phase === 'paused') state.phase = 'playing';
}

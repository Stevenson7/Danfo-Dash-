/** World tuning. Distances are in "road units"; one lane is 1 unit wide. */

export const LANE_COUNT = 3;
export const MIN_LANE = -1;
export const MAX_LANE = 1;

/** Objects are spawned this far ahead of the player and removed once behind. */
export const SPAWN_Z = 80;
export const DESPAWN_Z = -8;

export const BASE_SPEED = 17; // units / second at the start of a run
export const MAX_SPEED = 42;
export const SPEED_RAMP = 0.28; // units / second gained every second

/** Time between obstacle rows, interpolated by difficulty (seconds). */
export const ROW_GAP_EASY = 1.1;
export const ROW_GAP_HARD = 0.66;

export const LANE_CHANGE_RATE = 9; // lanes / second (≈0.11 s per lane)

export const JUMP_VELOCITY = 11;
export const GRAVITY = 32;
export const FAST_FALL_MULTIPLIER = 3.5;
export const JUMP_BUFFER_TIME = 0.15;
export const SLIDE_DURATION = 0.62;

export const PLAYER_HALF_DEPTH = 0.45;
export const LANE_HIT_TOLERANCE = 0.55;
/** Height the player must be above the road to clear a pothole. */
export const POTHOLE_CLEAR_HEIGHT = 0.3;

export const OBSTACLE_DEPTH = {
  danfo: 4.2,
  pothole: 1.3,
  barrier: 0.5,
  police: 0.7,
  agbero: 0.9,
} as const;

/** Agbero crouch low to grab you: you must be this high to clear one. */
export const AGBERO_CLEAR_HEIGHT = 0.55;
/** Agbero start charging when they are this many seconds away… */
export const AGBERO_TRIGGER_TIME = 0.95;
/** …and then close in this much faster than the road (fraction of speed). */
export const AGBERO_CHARGE = 0.55;

/** Police step into the neighbouring lane when this many seconds away. */
export const POLICE_TRIGGER_TIME = 1.15;
export const POLICE_STEP_RATE = 2.8; // lanes / second (~0.36 s step)

/** Rows spawned before police / agbero can appear. */
export const SPECIALS_AFTER_ROWS = 4;

export const COIN_SCORE = 10;
export const COIN_SPACING = 2.2;

export const MAGNET_DURATION = 9;
export const DOUBLE_DURATION = 10;
export const MAGNET_RANGE_Z = 16;
export const SHIELD_GRACE = 1.1; // invulnerability after a shield absorbs a hit

export const POWERUP_INTERVAL_MIN = 11;
export const POWERUP_INTERVAL_MAX = 20;

import { DOUBLE_DURATION, MAGNET_DURATION, SPAWN_Z } from './constants';
import { createRng } from './rng';
import { difficulty } from './engine';
import type { Coin, GameEvent, GameState, Obstacle, PowerKind, PowerUp } from './types';

/**
 * Pseudo-3D canvas renderer. Everything is drawn with primitives – no image
 * assets – so the game stays tiny and loads instantly on mobile data.
 */

const D = 6; // perspective focal distance (world units)

const PALETTE = {
  skyTop: '#1b1033',
  skyMid: '#5b2a6e',
  skyLow: '#ff7a3d',
  skyHorizon: '#ffc56b',
  sun: '#ffe08a',
  skylineFar: '#3d2052',
  skylineNear: '#251338',
  window: '#ffd66b',
  ground: '#3a2d38',
  groundNear: '#4d3a3a',
  road: '#3b3a45',
  roadNear: '#4a4955',
  laneLine: '#f4efe6',
  kerbA: '#151515',
  kerbB: '#ffcc1a',
  danfo: '#ffc917',
  danfoSide: '#d9a300',
  danfoRoof: '#ffdb55',
  stripe: '#151515',
  glass: '#26394d',
  coin: '#ffcf33',
  coinRim: '#c98400',
  skin: '#6b3e26',
  shirt: '#0a8f3c',
  shirtStripe: '#f4f4f4',
  trousers: '#24324a',
  cap: '#e23b3b',
};

const DANFO_SLOGANS = [
  'NO WAHALA',
  'GOD DEY',
  'NO CONDITION IS PERMANENT',
  'OSHOFREE',
  'EKO O NI BAJE',
  'SHINE YOUR EYE',
  'CHECK YOUR CHANGE',
];

const BILLBOARDS = ['SUYA SPOT', 'OWAMBE 2NITE', 'JOLLOF KING', 'EKO ATLANTIC', 'NO WAHALA FM'];

const POWER_COLORS: Record<PowerKind, string> = {
  magnet: '#ff4d6d',
  shield: '#3fc5ff',
  double: '#47e07d',
};

const POWER_LABELS: Record<PowerKind, string> = {
  magnet: 'MAGNET!',
  shield: 'SHIELD!',
  double: 'DOUBLE NAIRA!',
};

interface View {
  w: number;
  h: number;
  cx: number;
  horizonY: number;
  baseY: number;
  laneW: number;
  camX: number;
  nearZ: number; // z where the road meets the bottom of the screen
}

interface Projected {
  x: number;
  y: number;
  s: number; // scale: pixels per world unit = laneW * s
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

interface FloatText {
  text: string;
  x: number;
  y: number;
  life: number;
  color: string;
  size: number;
}

interface Building {
  x: number;
  w: number;
  h: number;
  windows: number[]; // packed lit window indices
  billboard: string | null;
}

type Renderable =
  | { z: number; kind: 'obstacle'; o: Obstacle }
  | { z: number; kind: 'coin'; c: Coin }
  | { z: number; kind: 'power'; u: PowerUp }
  | { z: number; kind: 'prop'; side: -1 | 1; prop: 'lamp' | 'palm' | 'stall'; seed: number }
  | { z: number; kind: 'player' };

export class Renderer {
  private view: View = { w: 1, h: 1, cx: 0, horizonY: 0, baseY: 0, laneW: 1, camX: 0, nearZ: 0 };
  private particles: Particle[] = [];
  private texts: FloatText[] = [];
  private shake = 0;
  private clock = 0;
  private skylineFar: Building[] = [];
  private skylineNear: Building[] = [];
  private skylineWidth = 0;
  safeTop = 0;

  resize(w: number, h: number): void {
    const laneW = Math.min(w * 0.29, h * 0.17);
    this.view = {
      ...this.view,
      w,
      h,
      cx: w / 2,
      horizonY: h * 0.36,
      baseY: h * 0.84,
      laneW,
    };
    const v = this.view;
    const sBottom = (h - v.horizonY) / (v.baseY - v.horizonY);
    v.nearZ = D / sBottom - D;
    this.buildSkyline();
  }

  private buildSkyline(): void {
    const { w, h } = this.view;
    const rng = createRng(2024);
    this.skylineWidth = w * 1.4;
    const make = (minH: number, maxH: number, boards: boolean): Building[] => {
      const out: Building[] = [];
      let x = -w * 0.2;
      let lastBoard = -Infinity;
      while (x < this.skylineWidth) {
        const bw = (0.05 + rng() * 0.09) * Math.max(w, 400);
        const bh = (minH + rng() * (maxH - minH)) * h;
        const windows: number[] = [];
        for (let i = 0; i < 40; i++) if (rng() < 0.35) windows.push(i);
        // Space billboards out so they never overlap.
        const board = boards && x - lastBoard > 150 && rng() < 0.35;
        if (board) lastBoard = x;
        out.push({
          x,
          w: bw,
          h: bh,
          windows,
          billboard: board ? BILLBOARDS[Math.floor(rng() * BILLBOARDS.length)] : null,
        });
        x += bw + rng() * 6;
      }
      return out;
    };
    this.skylineFar = make(0.06, 0.2, false);
    this.skylineNear = make(0.03, 0.12, true);
  }

  // -------------------------------------------------------------------------
  // Projection helpers
  // -------------------------------------------------------------------------

  private project(x: number, y: number, z: number): Projected {
    const v = this.view;
    const zz = Math.max(z, -D + 0.35);
    const s = D / (D + zz);
    return {
      x: v.cx + (x - v.camX) * v.laneW * s,
      y: v.horizonY + (v.baseY - v.horizonY) * s - y * v.laneW * s,
      s: v.laneW * s,
    };
  }

  // -------------------------------------------------------------------------
  // Events → juice
  // -------------------------------------------------------------------------

  handleEvents(events: readonly GameEvent[], state: GameState): void {
    const p = this.project(state.player.x, state.player.y + 0.6, 0);
    for (const e of events) {
      switch (e.type) {
        case 'coin':
          this.burst(p.x, p.y - p.s * 0.2, 6, PALETTE.coin, 0.4, p.s * 0.03);
          break;
        case 'powerup':
          this.burst(p.x, p.y, 18, POWER_COLORS[e.kind], 0.7, p.s * 0.05);
          this.floatText(POWER_LABELS[e.kind], POWER_COLORS[e.kind], 1);
          break;
        case 'shieldBreak':
          this.burst(p.x, p.y, 24, POWER_COLORS.shield, 0.7, p.s * 0.06);
          this.shake = Math.max(this.shake, 0.25);
          this.floatText('SHIELD SAVED YOU!', POWER_COLORS.shield, 0.9);
          break;
        case 'crash':
          this.burst(p.x, p.y, 30, '#d8c3a5', 0.9, p.s * 0.07);
          this.burst(p.x, p.y, 12, '#ffcf33', 0.8, p.s * 0.06);
          this.shake = 0.5;
          break;
        case 'bump':
          this.shake = Math.max(this.shake, 0.12);
          break;
        case 'slide':
          this.burst(p.x, p.y + p.s * 0.5, 8, '#b9a58f', 0.4, p.s * 0.03);
          break;
        case 'milestone':
          this.floatText(`${e.score}!`, '#ffe08a', 1.3);
          break;
        default:
          break;
      }
    }
  }

  private burst(x: number, y: number, n: number, color: string, life: number, speed: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random()) * 60;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - speed * 40,
        life,
        maxLife: life,
        size: 2 + Math.random() * 4,
        color,
      });
    }
    if (this.particles.length > 300) this.particles.splice(0, this.particles.length - 300);
  }

  private floatText(text: string, color: string, size: number): void {
    this.texts.push({ text, x: this.view.cx, y: this.view.h * 0.3, life: 1.3, color, size });
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, state: GameState, dt: number): void {
    const v = this.view;
    this.clock += dt;
    v.camX += (state.player.x * 0.35 - v.camX) * Math.min(1, dt * 8);

    ctx.save();
    if (this.shake > 0) {
      const m = this.shake * v.laneW * 0.12;
      ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
      this.shake = Math.max(0, this.shake - dt);
    }

    this.drawSky(ctx);
    this.drawGround(ctx, state);
    this.drawWorld(ctx, state);
    if (state.phase === 'playing') this.drawSpeedLines(ctx, state);
    this.drawParticles(ctx, dt);
    ctx.restore();

    if (state.phase !== 'ready') this.drawHud(ctx, state);
    this.drawFloatTexts(ctx, dt);
  }

  private drawSky(ctx: CanvasRenderingContext2D): void {
    const { w, h, horizonY, camX } = this.view;
    const g = ctx.createLinearGradient(0, 0, 0, horizonY);
    g.addColorStop(0, PALETTE.skyTop);
    g.addColorStop(0.45, PALETTE.skyMid);
    g.addColorStop(0.8, PALETTE.skyLow);
    g.addColorStop(1, PALETTE.skyHorizon);
    ctx.fillStyle = g;
    ctx.fillRect(-20, -20, w + 40, horizonY + 21);

    // Sun with retro bands.
    const sunR = Math.min(w, h) * 0.13;
    const sx = w * 0.68 - camX * 6;
    const sy = horizonY - sunR * 0.55;
    const glow = ctx.createRadialGradient(sx, sy, sunR * 0.3, sx, sy, sunR * 2.4);
    glow.addColorStop(0, 'rgba(255,214,120,0.55)');
    glow.addColorStop(1, 'rgba(255,214,120,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(sx - sunR * 2.5, sy - sunR * 2.5, sunR * 5, sunR * 5);
    ctx.fillStyle = PALETTE.sun;
    ctx.beginPath();
    ctx.arc(sx, sy, sunR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.skyLow;
    for (let i = 0; i < 4; i++) {
      const by = sy + sunR * (0.15 + i * 0.22);
      ctx.fillRect(sx - sunR, by, sunR * 2, sunR * (0.04 + i * 0.025));
    }

    // Drifting birds.
    ctx.strokeStyle = 'rgba(30,10,40,0.7)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      const bx = ((this.clock * (12 + i * 3) + i * 170) % (w + 80)) - 40;
      const by = horizonY * (0.25 + 0.12 * i) + Math.sin(this.clock * 2 + i) * 4;
      const flap = Math.sin(this.clock * 8 + i) * 3;
      ctx.beginPath();
      ctx.moveTo(bx - 6, by - flap);
      ctx.quadraticCurveTo(bx - 3, by - 3, bx, by);
      ctx.quadraticCurveTo(bx + 3, by - 3, bx + 6, by - flap);
      ctx.stroke();
    }

    this.drawSkyline(ctx, this.skylineFar, PALETTE.skylineFar, camX * 10, false);
    this.drawSkyline(ctx, this.skylineNear, PALETTE.skylineNear, camX * 22, true);
  }

  private drawSkyline(
    ctx: CanvasRenderingContext2D,
    buildings: Building[],
    color: string,
    offset: number,
    near: boolean,
  ): void {
    const { horizonY } = this.view;
    for (const b of buildings) {
      const x = b.x - offset;
      const top = horizonY - b.h;
      ctx.fillStyle = color;
      ctx.fillRect(x, top, b.w, b.h + 1);
      if (near) {
        // Lit windows.
        ctx.fillStyle = PALETTE.window;
        const cols = Math.max(1, Math.floor(b.w / 9));
        const rows = Math.max(1, Math.floor(b.h / 11));
        for (const idx of b.windows) {
          const c = idx % cols;
          const r = Math.floor(idx / cols);
          if (r >= rows - 1) continue;
          ctx.fillRect(x + 4 + c * 9, top + 5 + r * 11, 3, 4);
        }
        if (b.billboard) {
          const bw = Math.max(b.w * 1.4, 70);
          const bh = 18;
          const bx = x + b.w / 2 - bw / 2;
          const by = top - bh - 6;
          ctx.fillStyle = '#111';
          ctx.fillRect(bx + bw * 0.3, by + bh, 2, 6);
          ctx.fillRect(bx + bw * 0.7, by + bh, 2, 6);
          ctx.fillStyle = '#f4f1e8';
          ctx.fillRect(bx, by, bw, bh);
          ctx.fillStyle = '#0a8f3c';
          ctx.fillRect(bx, by, 5, bh);
          ctx.fillStyle = '#1b1033';
          ctx.font = 'bold 10px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(b.billboard, bx + bw / 2 + 2, by + bh / 2 + 1, bw - 10);
        }
      }
    }
  }

  private drawGround(ctx: CanvasRenderingContext2D, state: GameState): void {
    const v = this.view;
    const g = ctx.createLinearGradient(0, v.horizonY, 0, v.h);
    g.addColorStop(0, PALETTE.ground);
    g.addColorStop(1, PALETTE.groundNear);
    ctx.fillStyle = g;
    ctx.fillRect(-20, v.horizonY, v.w + 40, v.h - v.horizonY + 20);

    const zNear = v.nearZ - 0.5;
    const zFar = SPAWN_Z + 20;

    // Sidewalks.
    ctx.fillStyle = '#6e5f5a';
    this.quad(ctx, -3.6, -1.62, zNear, zFar);
    this.quad(ctx, 1.62, 3.6, zNear, zFar);

    // Road.
    const rn = this.project(0, 0, zNear);
    const rf = this.project(0, 0, zFar);
    const rg = ctx.createLinearGradient(0, rf.y, 0, rn.y);
    rg.addColorStop(0, PALETTE.road);
    rg.addColorStop(1, PALETTE.roadNear);
    ctx.fillStyle = rg;
    this.quad(ctx, -1.5, 1.5, zNear, zFar);

    // Black-and-yellow kerbs, Lagos style.
    const seg = 2;
    const offset = state.distance % (seg * 2);
    for (let z = zNear - offset - seg * 2; z < 70; z += seg) {
      const idx = Math.round((z + offset) / seg);
      ctx.fillStyle = idx % 2 === 0 ? PALETTE.kerbA : PALETTE.kerbB;
      this.quad(ctx, -1.62, -1.5, z, z + seg);
      this.quad(ctx, 1.5, 1.62, z, z + seg);
    }

    // Dashed lane dividers.
    const dash = 3;
    const gap = 4;
    const period = dash + gap;
    const off = state.distance % period;
    ctx.fillStyle = PALETTE.laneLine;
    for (let z = zNear - off; z < 70; z += period) {
      for (const lx of [-0.5, 0.5]) this.quad(ctx, lx - 0.03, lx + 0.03, z, z + dash);
    }

    // Haze at the horizon to blend the road into the skyline.
    const haze = ctx.createLinearGradient(0, v.horizonY, 0, v.horizonY + (v.baseY - v.horizonY) * 0.2);
    haze.addColorStop(0, 'rgba(255,170,110,0.55)');
    haze.addColorStop(1, 'rgba(255,170,110,0)');
    ctx.fillStyle = haze;
    ctx.fillRect(-20, v.horizonY, v.w + 40, (v.baseY - v.horizonY) * 0.2);
  }

  /** Fills a flat road-level quad between lane coords x0..x1 and depths z0..z1. */
  private quad(ctx: CanvasRenderingContext2D, x0: number, x1: number, z0: number, z1: number): void {
    const a = this.project(x0, 0, z0);
    const b = this.project(x1, 0, z0);
    const c = this.project(x1, 0, z1);
    const d = this.project(x0, 0, z1);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
    ctx.fill();
  }

  private drawWorld(ctx: CanvasRenderingContext2D, state: GameState): void {
    const items: Renderable[] = [];
    const minZ = this.view.nearZ - 3;
    for (const o of state.obstacles) if (o.z + o.depth / 2 > minZ) items.push({ z: o.z, kind: 'obstacle', o });
    for (const c of state.coinItems) if (c.z > minZ) items.push({ z: c.z, kind: 'coin', c });
    for (const u of state.powerups) if (u.z > minZ) items.push({ z: u.z, kind: 'power', u });

    // Roadside props, scrolling with distance.
    const spacing = 9;
    const off = state.distance % spacing;
    const base = Math.floor(state.distance / spacing);
    for (let i = 0; i * spacing - off < SPAWN_Z; i++) {
      const z = i * spacing - off;
      if (z < minZ) continue;
      const n = base + i;
      const props = ['lamp', 'palm', 'stall'] as const;
      items.push({ z, kind: 'prop', side: -1, prop: props[n % 3], seed: n });
      items.push({ z: z + 4, kind: 'prop', side: 1, prop: props[(n + 1) % 3], seed: n + 7 });
    }
    items.push({ z: 0, kind: 'player' });

    // Painter's algorithm: far → near. Ties: the player draws on top.
    items.sort((a, b) => b.z - a.z || (a.kind === 'player' ? 1 : b.kind === 'player' ? -1 : 0));

    for (const it of items) {
      switch (it.kind) {
        case 'obstacle':
          if (it.o.kind === 'danfo') this.drawDanfo(ctx, it.o);
          else if (it.o.kind === 'pothole') this.drawPothole(ctx, it.o);
          else if (it.o.kind === 'police') this.drawPolice(ctx, it.o);
          else if (it.o.kind === 'agbero') this.drawAgbero(ctx, it.o);
          else this.drawBarrier(ctx, it.o);
          break;
        case 'coin':
          this.drawCoin(ctx, it.c);
          break;
        case 'power':
          this.drawPowerUp(ctx, it.u);
          break;
        case 'prop':
          this.drawProp(ctx, it.side, it.prop, it.z, it.seed);
          break;
        case 'player':
          this.drawPlayer(ctx, state);
          break;
      }
    }
  }

  private fog(ctx: CanvasRenderingContext2D, z: number): void {
    // Distant objects fade in instead of popping.
    ctx.globalAlpha = Math.max(0, Math.min(1, (SPAWN_Z - z) / 14));
  }

  private drawDanfo(ctx: CanvasRenderingContext2D, o: Obstacle): void {
    const halfW = 0.43;
    const height = 1.3;
    const zn = o.z - o.depth / 2;
    const zf = o.z + o.depth / 2;
    const nl = this.project(o.lane - halfW, 0, zn);
    const nr = this.project(o.lane + halfW, 0, zn);
    const nt = this.project(o.lane, height, zn);
    const fl = this.project(o.lane - halfW, 0, zf);
    const fr = this.project(o.lane + halfW, 0, zf);
    const ft = this.project(o.lane, height, zf);
    const u = nr.s; // px per unit at the rear face

    ctx.save();
    this.fog(ctx, zn);
    if (o.spent) ctx.globalAlpha *= 0.35;

    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse((nl.x + nr.x) / 2, nl.y, (nr.x - nl.x) * 0.58, u * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();

    // Visible side panel (whichever side faces the camera).
    const showRight = (nl.x + nr.x) / 2 < this.view.cx;
    const sNear = showRight ? nr : nl;
    const sFar = showRight ? fr : fl;
    ctx.fillStyle = PALETTE.danfoSide;
    ctx.beginPath();
    ctx.moveTo(sNear.x, sNear.y);
    ctx.lineTo(sFar.x, sFar.y);
    ctx.lineTo(sFar.x, ft.y);
    ctx.lineTo(sNear.x, nt.y);
    ctx.closePath();
    ctx.fill();
    // Side stripes + windows.
    const lerpY = (a: number, b: number, t: number) => a + (b - a) * t;
    ctx.fillStyle = PALETTE.stripe;
    for (const t of [0.42, 0.52]) {
      ctx.beginPath();
      ctx.moveTo(sNear.x, lerpY(sNear.y, nt.y, t));
      ctx.lineTo(sFar.x, lerpY(sFar.y, ft.y, t));
      ctx.lineTo(sFar.x, lerpY(sFar.y, ft.y, t + 0.05));
      ctx.lineTo(sNear.x, lerpY(sNear.y, nt.y, t + 0.05));
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = PALETTE.glass;
    ctx.beginPath();
    ctx.moveTo(sNear.x, lerpY(sNear.y, nt.y, 0.62));
    ctx.lineTo(sFar.x, lerpY(sFar.y, ft.y, 0.62));
    ctx.lineTo(sFar.x, lerpY(sFar.y, ft.y, 0.9));
    ctx.lineTo(sNear.x, lerpY(sNear.y, nt.y, 0.9));
    ctx.closePath();
    ctx.fill();

    // Roof.
    ctx.fillStyle = PALETTE.danfoRoof;
    ctx.beginPath();
    ctx.moveTo(nl.x, nt.y);
    ctx.lineTo(nr.x, nt.y);
    ctx.lineTo(fr.x, ft.y);
    ctx.lineTo(fl.x, ft.y);
    ctx.closePath();
    ctx.fill();
    if (o.variant % 3 === 0) {
      // Luggage on the roof rack.
      const lw = (nr.x - nl.x) * 0.5;
      ctx.fillStyle = '#7a4a2a';
      ctx.fillRect((nl.x + nr.x) / 2 - lw / 2, nt.y - u * 0.18, lw, u * 0.18);
      ctx.fillStyle = '#2f6fb3';
      ctx.fillRect((nl.x + nr.x) / 2 - lw * 0.1, nt.y - u * 0.3, lw * 0.45, u * 0.13);
    }

    // Rear face.
    const rx = nl.x;
    const rw = nr.x - nl.x;
    const ry = nt.y;
    const rh = nl.y - nt.y;
    ctx.fillStyle = PALETTE.danfo;
    roundRect(ctx, rx, ry, rw, rh * 0.92, u * 0.08);
    ctx.fill();
    // Rear window.
    ctx.fillStyle = PALETTE.glass;
    roundRect(ctx, rx + rw * 0.1, ry + rh * 0.08, rw * 0.8, rh * 0.3, u * 0.04);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.moveTo(rx + rw * 0.18, ry + rh * 0.38);
    ctx.lineTo(rx + rw * 0.35, ry + rh * 0.08);
    ctx.lineTo(rx + rw * 0.45, ry + rh * 0.08);
    ctx.lineTo(rx + rw * 0.28, ry + rh * 0.38);
    ctx.fill();
    // Black stripes.
    ctx.fillStyle = PALETTE.stripe;
    ctx.fillRect(rx, ry + rh * 0.45, rw, rh * 0.11);
    ctx.fillRect(rx, ry + rh * 0.6, rw, rh * 0.04);
    // Slogan on the stripe.
    if (rw > 46) {
      const slogan = DANFO_SLOGANS[o.variant % DANFO_SLOGANS.length];
      ctx.fillStyle = PALETTE.danfo;
      ctx.font = `bold ${Math.max(6, rh * 0.075)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(slogan, rx + rw / 2, ry + rh * 0.506, rw * 0.92);
    }
    // Tail lights & plate.
    ctx.fillStyle = '#ff3b30';
    ctx.fillRect(rx + rw * 0.05, ry + rh * 0.7, rw * 0.12, rh * 0.08);
    ctx.fillRect(rx + rw * 0.83, ry + rh * 0.7, rw * 0.12, rh * 0.08);
    ctx.fillStyle = '#f4f1e8';
    ctx.fillRect(rx + rw * 0.36, ry + rh * 0.7, rw * 0.28, rh * 0.09);
    if (rw > 70) {
      ctx.fillStyle = '#0a8f3c';
      ctx.font = `bold ${rh * 0.06}px system-ui, sans-serif`;
      ctx.fillText('LAGOS', rx + rw / 2, ry + rh * 0.747, rw * 0.26);
    }
    // Bumper & wheels.
    ctx.fillStyle = '#222';
    ctx.fillRect(rx - rw * 0.02, ry + rh * 0.84, rw * 1.04, rh * 0.07);
    ctx.fillRect(rx + rw * 0.04, ry + rh * 0.9, rw * 0.16, rh * 0.1);
    ctx.fillRect(rx + rw * 0.8, ry + rh * 0.9, rw * 0.16, rh * 0.1);
    ctx.restore();
  }

  private drawPothole(ctx: CanvasRenderingContext2D, o: Obstacle): void {
    const near = this.project(o.lane, 0, o.z - o.depth / 2);
    const far = this.project(o.lane, 0, o.z + o.depth / 2);
    const c = this.project(o.lane, 0, o.z);
    const rx = c.s * 0.4;
    const ry = Math.max(1, (near.y - far.y) / 2);
    const cy = (near.y + far.y) / 2;
    ctx.save();
    this.fog(ctx, o.z);
    // Cracked rim.
    ctx.fillStyle = '#5c5a63';
    ctx.beginPath();
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const jag = 1.12 + ((o.variant >> i) & 1) * 0.1;
      const px = c.x + Math.cos(a) * rx * jag;
      const py = cy + Math.sin(a) * ry * jag;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.fill();
    ctx.fillStyle = '#16141a';
    ctx.beginPath();
    ctx.ellipse(c.x, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    // Muddy water.
    ctx.fillStyle = '#4b4334';
    ctx.beginPath();
    ctx.ellipse(c.x, cy + ry * 0.2, rx * 0.75, ry * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,200,140,0.35)';
    ctx.beginPath();
    ctx.ellipse(c.x - rx * 0.2, cy + ry * 0.1, rx * 0.25, ry * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    // Warning cone beside some potholes.
    if (o.variant % 2 === 0) {
      const cone = this.project(o.lane + 0.38, 0, o.z + 0.3);
      const ch = cone.s * 0.35;
      ctx.fillStyle = '#ff7b1a';
      ctx.beginPath();
      ctx.moveTo(cone.x - ch * 0.3, cone.y);
      ctx.lineTo(cone.x + ch * 0.3, cone.y);
      ctx.lineTo(cone.x, cone.y - ch);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(cone.x - ch * 0.14, cone.y - ch * 0.55, ch * 0.28, ch * 0.12);
    }
    ctx.restore();
  }

  private drawBarrier(ctx: CanvasRenderingContext2D, o: Obstacle): void {
    const bottom = 0.72;
    const top = 1.02;
    const l = this.project(o.lane - 0.47, 0, o.z);
    const r = this.project(o.lane + 0.47, 0, o.z);
    const u = l.s;
    ctx.save();
    this.fog(ctx, o.z);
    if (o.spent) ctx.globalAlpha *= 0.35;
    // Posts.
    ctx.fillStyle = '#9aa0a6';
    const postW = Math.max(2, u * 0.05);
    ctx.fillRect(l.x - postW / 2, l.y - top * u - u * 0.15, postW, top * u + u * 0.15);
    ctx.fillRect(r.x - postW / 2, r.y - top * u - u * 0.15, postW, top * u + u * 0.15);
    // Striped bar.
    const by = l.y - top * u;
    const bh = (top - bottom) * u;
    const bw = r.x - l.x;
    const segs = 6;
    for (let i = 0; i < segs; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#e23b3b' : '#f4f1e8';
      ctx.fillRect(l.x + (bw / segs) * i, by, bw / segs + 0.5, bh);
    }
    ctx.strokeStyle = '#151515';
    ctx.lineWidth = Math.max(1, u * 0.015);
    ctx.strokeRect(l.x, by, bw, bh);
    // Hanging sign with a duck hint.
    if (bw > 50) {
      ctx.fillStyle = '#ffcc1a';
      const sw = bw * 0.36;
      const sh = bh * 0.9;
      ctx.fillRect(l.x + bw / 2 - sw / 2, by - sh - u * 0.02, sw, sh);
      ctx.fillStyle = '#151515';
      ctx.font = `bold ${sh * 0.6}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('DUCK', l.x + bw / 2, by - sh / 2 - u * 0.02, sw * 0.9);
    }
    // Blinking light.
    if (Math.floor(this.clock * 3 + o.variant) % 2 === 0) {
      ctx.fillStyle = '#ffdd33';
      ctx.beginPath();
      ctx.arc(l.x, by - u * 0.17, Math.max(1.5, u * 0.04), 0, Math.PI * 2);
      ctx.arc(r.x, by - u * 0.17, Math.max(1.5, u * 0.04), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Front-facing traffic officer with a STOP paddle; steps into `targetLane`. */
  private drawPolice(ctx: CanvasRenderingContext2D, o: Obstacle): void {
    const base = this.project(o.x, 0, o.z);
    const u = base.s;
    if (u < 2) return;
    const moving = o.targetLane !== null && o.x !== o.targetLane;
    const dir = o.targetLane === null ? 0 : Math.sign(o.targetLane - o.lane);
    ctx.save();
    this.fog(ctx, o.z);
    if (o.spent) ctx.globalAlpha *= 0.35;

    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(base.x, base.y, u * 0.24, u * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.translate(base.x, base.y);
    ctx.scale(u, u);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const stride = o.triggered && moving ? Math.sin(this.clock * 22) * 0.06 : 0;

    // Legs & boots.
    ctx.strokeStyle = '#15171c';
    ctx.lineWidth = 0.12;
    ctx.beginPath();
    ctx.moveTo(-0.08, -0.58);
    ctx.lineTo(-0.1 - stride, -0.04);
    ctx.moveTo(0.08, -0.58);
    ctx.lineTo(0.1 + stride, -0.04);
    ctx.stroke();
    ctx.fillStyle = '#050505';
    ctx.fillRect(-0.17 - stride, -0.06, 0.13, 0.06);
    ctx.fillRect(0.04 + stride, -0.06, 0.13, 0.06);

    // Black uniform with a hi-vis vest so officers read at a glance.
    ctx.fillStyle = '#1b1f27';
    roundRect(ctx, -0.2, -1.04, 0.4, 0.5, 0.08);
    ctx.fill();
    ctx.fillStyle = '#c8ff3d';
    ctx.fillRect(-0.2, -0.82, 0.4, 0.06);
    ctx.fillRect(-0.2, -0.68, 0.4, 0.06);
    ctx.fillRect(-0.13, -1.03, 0.06, 0.47);
    ctx.fillRect(0.07, -1.03, 0.06, 0.47);
    ctx.fillStyle = '#f4f1e8';
    ctx.fillRect(-0.2, -0.6, 0.4, 0.05); // belt

    // Arms: one holds the STOP paddle up, the other points where they'll step.
    const paddleSide = dir === 0 ? 1 : -dir;
    ctx.strokeStyle = '#1b1f27';
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    ctx.moveTo(paddleSide * 0.18, -0.98);
    ctx.lineTo(paddleSide * 0.3, -1.22);
    ctx.moveTo(-paddleSide * 0.18, -0.98);
    ctx.lineTo(-paddleSide * 0.42, -0.9);
    ctx.stroke();
    ctx.fillStyle = '#f4f4f4'; // white gloves
    ctx.beginPath();
    ctx.arc(-paddleSide * 0.44, -0.9, 0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#777';
    ctx.lineWidth = 0.03;
    ctx.beginPath();
    ctx.moveTo(paddleSide * 0.3, -1.22);
    ctx.lineTo(paddleSide * 0.3, -1.32);
    ctx.stroke();
    ctx.fillStyle = '#e23b3b';
    ctx.beginPath();
    ctx.arc(paddleSide * 0.3, -1.42, 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 0.02;
    ctx.stroke();
    if (u > 40) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 0.07px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('STOP', paddleSide * 0.3, -1.415);
    }

    // Head with peaked cap.
    ctx.fillStyle = PALETTE.skin;
    ctx.beginPath();
    ctx.arc(0, -1.15, 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0d0f14';
    ctx.fillRect(-0.15, -1.3, 0.3, 0.08);
    ctx.fillRect(-0.12, -1.24, 0.24, 0.04);
    ctx.fillStyle = '#e23b3b';
    ctx.fillRect(-0.15, -1.25, 0.3, 0.025);
    ctx.fillStyle = '#ffcc1a';
    ctx.beginPath();
    ctx.arc(0, -1.27, 0.025, 0, Math.PI * 2);
    ctx.fill();

    // Telegraph: chevrons showing which lane the officer will step into.
    if (dir !== 0 && moving) {
      const pulse = 0.6 + 0.4 * Math.abs(Math.sin(this.clock * (o.triggered ? 14 : 5)));
      ctx.globalAlpha *= pulse;
      ctx.fillStyle = o.triggered ? '#ff4d4d' : '#ffcc1a';
      for (let i = 0; i < 2; i++) {
        const cx = dir * (0.05 + i * 0.16);
        ctx.beginPath();
        ctx.moveTo(cx - dir * 0.05, -1.78);
        ctx.lineTo(cx + dir * 0.07, -1.68);
        ctx.lineTo(cx - dir * 0.05, -1.58);
        ctx.lineTo(cx - dir * 0.0, -1.68);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** Crouching tout reaching for your money. Charges when close: jump him. */
  private drawAgbero(ctx: CanvasRenderingContext2D, o: Obstacle): void {
    const base = this.project(o.x, 0, o.z);
    const u = base.s;
    if (u < 2) return;
    ctx.save();
    this.fog(ctx, o.z);
    if (o.spent) ctx.globalAlpha *= 0.35;

    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(base.x, base.y, u * 0.3, u * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.translate(base.x, base.y);
    ctx.scale(u, u);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const bob = o.triggered ? Math.abs(Math.sin(this.clock * 18)) * 0.05 : Math.sin(this.clock * 3 + o.variant) * 0.015;
    ctx.translate(0, -bob);

    // Wide crouched legs (jeans) and slippers.
    ctx.strokeStyle = '#2f5d8a';
    ctx.lineWidth = 0.12;
    ctx.beginPath();
    ctx.moveTo(-0.08, -0.36);
    ctx.lineTo(-0.24, -0.2);
    ctx.lineTo(-0.22, -0.03);
    ctx.moveTo(0.08, -0.36);
    ctx.lineTo(0.24, -0.2);
    ctx.lineTo(0.22, -0.03);
    ctx.stroke();
    ctx.fillStyle = '#e23b3b';
    ctx.fillRect(-0.3, -0.04, 0.14, 0.04);
    ctx.fillRect(0.16, -0.04, 0.14, 0.04);

    // Singlet torso, leaning in.
    ctx.fillStyle = '#f4f1e8';
    roundRect(ctx, -0.17, -0.7, 0.34, 0.38, 0.07);
    ctx.fill();
    ctx.fillStyle = '#e23b3b';
    ctx.fillRect(-0.17, -0.52, 0.34, 0.05);

    // Arms spread wide; one hand waves a wad of naira.
    ctx.strokeStyle = PALETTE.skin;
    ctx.lineWidth = 0.08;
    const wave = Math.sin(this.clock * (o.triggered ? 16 : 4)) * 0.05;
    ctx.beginPath();
    ctx.moveTo(-0.15, -0.64);
    ctx.lineTo(-0.36, -0.58 + wave);
    ctx.lineTo(-0.46, -0.7 + wave);
    ctx.moveTo(0.15, -0.64);
    ctx.lineTo(0.36, -0.58 - wave);
    ctx.lineTo(0.46, -0.7 - wave);
    ctx.stroke();
    ctx.fillStyle = '#2e8b57';
    ctx.fillRect(0.4, -0.82 - wave, 0.14, 0.08);
    ctx.fillStyle = '#7fd38f';
    ctx.fillRect(0.42, -0.8 - wave, 0.1, 0.02);

    // Head with backwards cap.
    ctx.fillStyle = PALETTE.skin;
    ctx.beginPath();
    ctx.arc(0, -0.82, 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffcc1a';
    ctx.beginPath();
    ctx.arc(0, -0.85, 0.125, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(-0.04, -0.88, 0.08, 0.03);
    ctx.fillStyle = '#1a0f0a';
    ctx.beginPath();
    ctx.ellipse(0, -0.76, 0.04, o.triggered ? 0.03 : 0.012, 0, 0, Math.PI * 2);
    ctx.fill();

    // Speech bubble once he charges.
    if (o.triggered && u > 36) {
      ctx.fillStyle = '#fff';
      roundRect(ctx, -0.32, -1.32, 0.64, 0.2, 0.06);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-0.04, -1.13);
      ctx.lineTo(0.06, -1.13);
      ctx.lineTo(0, -1.03);
      ctx.fill();
      ctx.fillStyle = '#151515';
      ctx.font = '900 0.11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('OWO DA?!', 0, -1.215);
    }
    ctx.restore();
  }

  private drawCoin(ctx: CanvasRenderingContext2D, c: Coin): void {
    const p = this.project(c.x, c.y, c.z);
    const g = this.project(c.x, 0, c.z);
    const r = p.s * 0.17;
    if (r < 0.8) return;
    ctx.save();
    this.fog(ctx, c.z);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(g.x, g.y, r * 0.8, r * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
    const spin = Math.abs(Math.cos(this.clock * 4 + c.id * 0.7));
    const rw = Math.max(r * 0.15, r * spin);
    ctx.fillStyle = PALETTE.coinRim;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, rw, r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.coin;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, rw * 0.78, r * 0.78, 0, 0, Math.PI * 2);
    ctx.fill();
    if (r > 6 && spin > 0.45) {
      ctx.fillStyle = PALETTE.coinRim;
      ctx.font = `bold ${r * 1.1}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(spin, 1);
      ctx.fillText('₦', 0, r * 0.05);
      ctx.restore();
    }
    ctx.restore();
  }

  private drawPowerUp(ctx: CanvasRenderingContext2D, u: PowerUp): void {
    const bob = 0.75 + Math.sin(this.clock * 3 + u.id) * 0.1;
    const p = this.project(u.lane, bob, u.z);
    const g = this.project(u.lane, 0, u.z);
    const r = p.s * 0.26;
    if (r < 1) return;
    const color = POWER_COLORS[u.kind];
    ctx.save();
    this.fog(ctx, u.z);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(g.x, g.y, r * 0.8, r * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
    const glow = ctx.createRadialGradient(p.x, p.y, r * 0.3, p.x, p.y, r * 1.8);
    glow.addColorStop(0, color);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, r * 0.14);
    ctx.strokeStyle = color;
    ctx.stroke();
    drawPowerIcon(ctx, u.kind, p.x, p.y, r * 0.62);
    ctx.restore();
  }

  private drawProp(ctx: CanvasRenderingContext2D, side: -1 | 1, prop: 'lamp' | 'palm' | 'stall', z: number, seed: number): void {
    const x = side * (prop === 'stall' ? 2.25 : 2.0);
    const b = this.project(x, 0, z);
    const u = b.s;
    if (u < 1.5) return;
    ctx.save();
    this.fog(ctx, z);
    if (prop === 'lamp') {
      const top = this.project(x, 2.6, z);
      ctx.strokeStyle = '#2b2b33';
      ctx.lineWidth = Math.max(1, u * 0.05);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(top.x, top.y);
      ctx.lineTo(top.x - side * u * 0.35, top.y);
      ctx.stroke();
      ctx.fillStyle = '#ffe9a8';
      ctx.beginPath();
      ctx.arc(top.x - side * u * 0.35, top.y + u * 0.04, Math.max(1, u * 0.07), 0, Math.PI * 2);
      ctx.fill();
    } else if (prop === 'palm') {
      const top = this.project(x, 2.4, z);
      ctx.strokeStyle = '#6b4a2b';
      ctx.lineWidth = Math.max(1.5, u * 0.09);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.quadraticCurveTo(b.x + side * u * 0.25, (b.y + top.y) / 2, top.x, top.y);
      ctx.stroke();
      ctx.fillStyle = '#1f7a3a';
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + seed;
        ctx.beginPath();
        ctx.ellipse(
          top.x + Math.cos(a) * u * 0.3,
          top.y + Math.sin(a) * u * 0.12 + u * 0.05,
          u * 0.34,
          u * 0.08,
          a,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    } else {
      // Roadside kiosk with an umbrella.
      const pole = this.project(x, 1.3, z);
      const colors = ['#e23b3b', '#2f6fb3', '#0a8f3c', '#ff7b1a'];
      ctx.fillStyle = '#7a4a2a';
      ctx.fillRect(b.x - u * 0.3, b.y - u * 0.5, u * 0.6, u * 0.5);
      ctx.fillStyle = '#f4f1e8';
      ctx.fillRect(b.x - u * 0.3, b.y - u * 0.5, u * 0.6, u * 0.08);
      ctx.strokeStyle = '#333';
      ctx.lineWidth = Math.max(1, u * 0.03);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y - u * 0.5);
      ctx.lineTo(pole.x, pole.y);
      ctx.stroke();
      ctx.fillStyle = colors[Math.abs(seed) % colors.length];
      ctx.beginPath();
      ctx.moveTo(pole.x - u * 0.55, pole.y + u * 0.22);
      ctx.quadraticCurveTo(pole.x, pole.y - u * 0.25, pole.x + u * 0.55, pole.y + u * 0.22);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, state: GameState): void {
    const p = state.player;
    const ground = this.project(p.x, 0, 0);
    const pos = this.project(p.x, p.y, 0);
    const u = pos.s;

    // Shadow shrinks as the runner leaves the ground.
    const sh = 1 / (1 + p.y * 0.8);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(ground.x, ground.y, u * 0.24 * sh, u * 0.06 * sh, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    if (p.invulnerable > 0 && Math.floor(p.invulnerable * 12) % 2 === 0) ctx.globalAlpha = 0.45;
    ctx.translate(pos.x, pos.y);
    ctx.scale(u, u);
    // Lean into lane changes.
    ctx.rotate((p.lane - p.x) * 0.25);

    const sliding = p.slideTime > 0;
    const airborne = p.y > 0.01;
    const crashed = state.phase === 'over';
    const ph = state.phase === 'playing' ? p.runPhase : this.clock * 4;
    const sw = Math.sin(ph);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (sliding) {
      // Low crouch / baseball slide.
      ctx.strokeStyle = PALETTE.trousers;
      ctx.lineWidth = 0.12;
      ctx.beginPath();
      ctx.moveTo(-0.1, -0.2);
      ctx.lineTo(-0.2, -0.04);
      ctx.moveTo(0.1, -0.2);
      ctx.lineTo(0.22, -0.04);
      ctx.stroke();
      ctx.fillStyle = PALETTE.shirt;
      roundRect(ctx, -0.2, -0.48, 0.4, 0.3, 0.08);
      ctx.fill();
      ctx.fillStyle = PALETTE.shirtStripe;
      ctx.fillRect(-0.055, -0.48, 0.11, 0.3);
      ctx.strokeStyle = PALETTE.skin;
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      ctx.moveTo(-0.18, -0.42);
      ctx.lineTo(-0.36, -0.3);
      ctx.moveTo(0.18, -0.42);
      ctx.lineTo(0.36, -0.3);
      ctx.stroke();
      this.drawHead(ctx, 0, -0.58);
    } else {
      const hipY = -0.52;
      const tuck = airborne ? 0.16 : 0;
      const liftL = airborne ? tuck : Math.max(0, sw) * 0.16;
      const liftR = airborne ? tuck : Math.max(0, -sw) * 0.16;
      // Legs with knees.
      ctx.strokeStyle = PALETTE.trousers;
      ctx.lineWidth = 0.12;
      const leg = (side: number, lift: number) => {
        const footY = -0.05 - lift;
        const kneeY = (hipY + footY) / 2 - lift * 0.3;
        ctx.beginPath();
        ctx.moveTo(side * 0.09, hipY);
        ctx.lineTo(side * (0.12 + lift * 0.3), kneeY);
        ctx.lineTo(side * 0.1, footY);
        ctx.stroke();
        ctx.fillStyle = '#f4f4f4';
        ctx.beginPath();
        ctx.ellipse(side * 0.1, footY + 0.02, 0.07, 0.04, 0, 0, Math.PI * 2);
        ctx.fill();
      };
      leg(-1, liftL);
      leg(1, liftR);
      // Torso: green-white-green shirt.
      ctx.fillStyle = PALETTE.shirt;
      roundRect(ctx, -0.19, -0.96, 0.38, 0.48, 0.08);
      ctx.fill();
      ctx.fillStyle = PALETTE.shirtStripe;
      ctx.fillRect(-0.06, -0.95, 0.12, 0.46);
      // Conductor's money pouch strap.
      ctx.strokeStyle = '#5a3a1e';
      ctx.lineWidth = 0.035;
      ctx.beginPath();
      ctx.moveTo(-0.17, -0.92);
      ctx.lineTo(0.17, -0.58);
      ctx.stroke();
      ctx.fillStyle = '#7a4a2a';
      roundRect(ctx, 0.1, -0.62, 0.13, 0.12, 0.03);
      ctx.fill();
      // Arms.
      ctx.strokeStyle = PALETTE.skin;
      ctx.lineWidth = 0.075;
      const arm = (side: number, swing: number) => {
        const handY = airborne || crashed ? -1.18 : -0.62 - swing * 0.1;
        ctx.beginPath();
        ctx.moveTo(side * 0.18, -0.9);
        ctx.lineTo(side * 0.29, (-0.9 + handY) / 2 + 0.03);
        ctx.lineTo(side * 0.26, handY);
        ctx.stroke();
      };
      arm(-1, -sw);
      arm(1, sw);
      this.drawHead(ctx, 0, -1.07);
    }

    ctx.restore();

    // Shield bubble.
    if (state.effects.shield) {
      const c = this.project(p.x, p.y + (sliding ? 0.3 : 0.6), 0);
      const pulse = 1 + Math.sin(this.clock * 6) * 0.04;
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = POWER_COLORS.shield;
      ctx.lineWidth = Math.max(2, u * 0.03);
      ctx.fillStyle = 'rgba(63,197,255,0.15)';
      ctx.beginPath();
      ctx.arc(c.x, c.y, u * 0.68 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawHead(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.fillStyle = PALETTE.skin;
    ctx.beginPath();
    ctx.arc(x, y, 0.13, 0, Math.PI * 2);
    ctx.fill();
    // Cap seen from behind, with adjuster strap.
    ctx.fillStyle = PALETTE.cap;
    ctx.beginPath();
    ctx.arc(x, y - 0.01, 0.14, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#f4f4f4';
    ctx.fillRect(x - 0.04, y - 0.02, 0.08, 0.025);
  }

  private drawSpeedLines(ctx: CanvasRenderingContext2D, state: GameState): void {
    const d = difficulty(state);
    if (d < 0.25) return;
    const { w, h, cx, horizonY } = this.view;
    ctx.save();
    ctx.strokeStyle = `rgba(255,255,255,${(d - 0.25) * 0.25})`;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.floor(this.clock * 20) * 0.37;
      const r0 = Math.max(w, h) * (0.45 + ((i * 37 + Math.floor(this.clock * 30)) % 10) / 40);
      const x0 = cx + Math.cos(a) * r0;
      const y0 = horizonY + Math.sin(a) * r0;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(cx + Math.cos(a) * r0 * 1.25, horizonY + Math.sin(a) * r0 * 1.25);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D, dt: number): void {
    for (const pt of this.particles) {
      pt.life -= dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vy += 600 * dt;
      ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;
    this.particles = this.particles.filter((pt) => pt.life > 0);
  }

  private drawFloatTexts(ctx: CanvasRenderingContext2D, dt: number): void {
    for (const t of this.texts) {
      t.life -= dt;
      t.y -= 30 * dt;
      const a = Math.min(1, t.life / 0.4);
      ctx.save();
      ctx.globalAlpha = Math.max(0, a);
      ctx.font = `900 ${Math.round(28 * t.size)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(20,8,30,0.8)';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
      ctx.restore();
    }
    this.texts = this.texts.filter((t) => t.life > 0);
  }

  private drawHud(ctx: CanvasRenderingContext2D, state: GameState): void {
    const { w } = this.view;
    const top = this.safeTop + 14;
    ctx.save();
    ctx.textBaseline = 'top';

    // Score (centre).
    ctx.textAlign = 'center';
    ctx.font = '900 34px system-ui, sans-serif';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(20,8,30,0.7)';
    const score = String(Math.floor(state.score));
    ctx.strokeText(score, w / 2, top);
    ctx.fillStyle = '#fff';
    ctx.fillText(score, w / 2, top);
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(`BEST ${Math.max(state.best, Math.floor(state.score))}`, w / 2, top + 38);

    // Coins (right).
    ctx.textAlign = 'right';
    ctx.font = '800 22px system-ui, sans-serif';
    const coinText = String(state.coins);
    const tw = ctx.measureText(coinText).width;
    const cy = top + 14;
    ctx.strokeText(coinText, w - 14, top + 3);
    ctx.fillStyle = PALETTE.coin;
    ctx.fillText(coinText, w - 14, top + 3);
    const ix = w - 14 - tw - 16;
    ctx.fillStyle = PALETTE.coinRim;
    ctx.beginPath();
    ctx.arc(ix, cy, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.coin;
    ctx.beginPath();
    ctx.arc(ix, cy, 8.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.coinRim;
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('₦', ix, cy + 1);

    // Active power-ups (right, under coins).
    const chips: { kind: PowerKind; frac: number }[] = [];
    if (state.effects.shield) chips.push({ kind: 'shield', frac: 1 });
    if (state.effects.magnet > 0) chips.push({ kind: 'magnet', frac: state.effects.magnet / MAGNET_DURATION });
    if (state.effects.double > 0) chips.push({ kind: 'double', frac: state.effects.double / DOUBLE_DURATION });
    chips.forEach((chip, i) => {
      const x = w - 30 - i * 42;
      const y = top + 52;
      ctx.fillStyle = 'rgba(20,8,30,0.6)';
      ctx.beginPath();
      ctx.arc(x, y, 17, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = POWER_COLORS[chip.kind];
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 17, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * chip.frac);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.fill();
      drawPowerIcon(ctx, chip.kind, x, y, 8);
    });
    ctx.restore();
  }
}

function drawPowerIcon(ctx: CanvasRenderingContext2D, kind: PowerKind, x: number, y: number, r: number): void {
  ctx.save();
  ctx.lineCap = 'butt';
  if (kind === 'magnet') {
    ctx.strokeStyle = POWER_COLORS.magnet;
    ctx.lineWidth = r * 0.45;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.6, Math.PI, 0, true);
    ctx.lineTo(x + r * 0.6, y - r * 0.6);
    ctx.moveTo(x - r * 0.6, y);
    ctx.lineTo(x - r * 0.6, y - r * 0.6);
    ctx.stroke();
    ctx.strokeStyle = '#ccc';
    ctx.beginPath();
    ctx.moveTo(x - r * 0.6, y - r * 0.6);
    ctx.lineTo(x - r * 0.6, y - r * 0.9);
    ctx.moveTo(x + r * 0.6, y - r * 0.6);
    ctx.lineTo(x + r * 0.6, y - r * 0.9);
    ctx.stroke();
  } else if (kind === 'shield') {
    ctx.fillStyle = POWER_COLORS.shield;
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r * 0.85, y - r * 0.6);
    ctx.quadraticCurveTo(x + r * 0.8, y + r * 0.6, x, y + r);
    ctx.quadraticCurveTo(x - r * 0.8, y + r * 0.6, x - r * 0.85, y - r * 0.6);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillStyle = '#1f9d55';
    ctx.font = `900 ${r * 1.3}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('x2', x, y + r * 0.08);
  }
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

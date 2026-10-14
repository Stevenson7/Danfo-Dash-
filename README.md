# Danfo Dash 🚌💨

A mobile-first, three-lane endless runner set on the streets of Lagos. Dodge
yellow danfo buses, jump potholes, duck under road barriers and grab as much
naira as you can while rush hour gets faster and faster.

Built with **React + TypeScript + Vite + HTML Canvas**. All graphics are drawn
in code (no image assets), sound effects are synthesised with Web Audio, and
the game runs entirely in the browser: **no backend, no accounts, no API keys**.

## How to play

| Action        | Phone              | Keyboard                    |
| ------------- | ------------------ | --------------------------- |
| Change lane   | Swipe left / right | ← / → or A / D              |
| Jump          | Swipe up           | ↑, W or Space               |
| Slide / duck  | Swipe down         | ↓ or S                      |
| Pause         | ❚❚ button          | P or Esc                    |
| Start/restart | Tap / swipe up     | Enter (or Space on results) |

Tip: swipe down while in the air to slam back to the ground and slide; swipe up
while sliding to jump straight out of it.

**Obstacles**

- 🚌 **Danfo**: too tall to jump. Change lane.
- 🕳️ **Pothole**: jump over it (or change lane).
- 🚧 **Barrier** (the yellow *DUCK* sign): slide under it (or change lane).

**Pickups**

- **₦ coins**: +10 points each. Coin arcs over potholes reward good jumps;
  low coins under barriers reward slides.
- 🧲 **Magnet** (red): pulls nearby coins to you for 9 s.
- 🛡️ **Shield** (blue): absorbs one crash.
- **x2 Double Naira** (green): doubles all points for 10 s.

**Scoring & difficulty**: points accrue with distance plus coins. Speed rises
continuously and obstacle rows get denser. Every row leaves at least one lane
free of danfos, so the road is always beatable. Jumps keep their height but get
quicker at high speed. Your personal best is saved on your device
(`localStorage`). After a run, **Share score** opens your phone's share sheet
(WhatsApp, X, etc.) with your score and a link to the game, or copies the
message to the clipboard on browsers without one. The game auto-pauses when you switch apps.

## Play it

Live at **https://danfo-dash-lovat.vercel.app/**. On Android, open it in Chrome
and choose **⋮ → Add to Home screen** for a full-screen, app-like experience.

## Deployment (no terminal needed)

The game is hosted on **Vercel**, which rebuilds and redeploys automatically
every time `main` changes. To update the live game, merge changes into `main`.

To set it up on a new Vercel project: import the GitHub repo on vercel.com,
keep the detected **Vite** preset (build command `npm run build`, output
directory `dist`) and deploy. No environment variables are needed. The same
settings work on Netlify or Cloudflare Pages, and `base: './'` in the Vite
config lets the build run from any sub-path.

**CI**: `.github/workflows/ci.yml` runs the tests and production build on every
push and pull request, so a red ❌ on a commit means something is broken.

## Local development (optional)

Requires Node.js 20+ (22 recommended).

```bash
npm install
npm run dev        # dev server (reachable from a phone on the same Wi-Fi)
npm test           # unit tests
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

## Project structure

```
src/
  App.tsx            React overlays: title, pause and game-over screens
  styles.css
  game/
    engine.ts        Pure game logic: physics, spawning, collisions, scoring
    renderer.ts      Pseudo-3D canvas renderer, HUD, particles
    input.ts         Swipe + keyboard input
    audio.ts         Synthesised sound effects
    storage.ts       Personal best + mute setting
    Game.ts          Ties it together: loop, input, audio, rendering
    constants.ts     Tuning knobs (speeds, jump, spawn rates…)
    *.test.ts        Vitest unit tests
.github/workflows/ci.yml       CI: tests + production build
```

## Tests

`npm test` runs Vitest unit tests covering lane changes, jump/slide physics,
fast-fall, collisions for each obstacle type, shields, coins, magnet,
double naira, scoring, score sharing, the difficulty ramp, road-generation fairness (every row
has a non-danfo lane), determinism, swipe/keyboard mapping and personal-best
storage. A small autopilot bot also plays a full minute on 10 different road
seeds to check the road stays beatable.

## Roadmap

Planned for a later release: national leaderboards and online multiplayer.

## Credits

All code, graphics and sounds are original and generated procedurally.

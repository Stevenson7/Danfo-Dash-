import { useEffect, useRef, useState } from 'react';
import { Game, type GameSnapshot } from './game/Game';
import type { ObstacleKind } from './game/types';

const CRASH_LINES: Record<ObstacleKind, { title: string; line: string }> = {
  danfo: { title: 'Wahala!', line: 'You jam danfo. Conductor no go happy.' },
  pothole: { title: 'Gbam!', line: 'Pothole don swallow your leg.' },
  barrier: { title: 'Ouch!', line: 'You for duck under that barrier.' },
};

const INITIAL: GameSnapshot = {
  phase: 'ready',
  score: 0,
  coins: 0,
  best: 0,
  newBest: false,
  crashedBy: null,
  muted: false,
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [snap, setSnap] = useState<GameSnapshot>(INITIAL);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !surfaceRef.current) return;
    try {
      const game = new Game(canvasRef.current, surfaceRef.current, setSnap);
      gameRef.current = game;
      return () => {
        game.destroy();
        gameRef.current = null;
      };
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const game = () => gameRef.current;
  const crash = snap.crashedBy ? CRASH_LINES[snap.crashedBy] : CRASH_LINES.danfo;

  return (
    <div className="app" ref={surfaceRef}>
      <canvas ref={canvasRef} className="stage" aria-label="Danfo Dash game" />

      {error && (
        <div className="overlay">
          <div className="card">
            <h2>Can't start the game</h2>
            <p>{error}</p>
          </div>
        </div>
      )}

      {(snap.phase === 'playing' || snap.phase === 'paused') && (
        <div className="corner-buttons">
          <button className="icon-btn" aria-label="Pause" onClick={() => game()?.togglePause()}>
            {snap.phase === 'paused' ? '▶' : '❚❚'}
          </button>
          <button className="icon-btn" aria-label={snap.muted ? 'Unmute' : 'Mute'} onClick={() => game()?.toggleMute()}>
            {snap.muted ? '🔇' : '🔊'}
          </button>
        </div>
      )}

      {snap.phase === 'ready' && (
        <div className="overlay menu">
          <div className="title-block">
            <div className="logo">
              <span className="logo-danfo">DANFO</span>
              <span className="logo-dash">DASH</span>
            </div>
            <p className="tagline">Lagos rush hour. No brakes. No wahala.</p>
          </div>

          <div className="card how">
            <div className="how-row">
              <span className="key">⇆</span>
              <span>Swipe left / right to change lane</span>
            </div>
            <div className="how-row">
              <span className="key">⇡</span>
              <span>Swipe up to jump potholes</span>
            </div>
            <div className="how-row">
              <span className="key">⇣</span>
              <span>Swipe down to duck under barriers</span>
            </div>
            <div className="how-row muted-text">
              <span className="key small">⌨</span>
              <span>Arrows / WASD · Space jump · P pause</span>
            </div>
          </div>

          <button className="cta" onClick={() => game()?.start()} autoFocus>
            Tap to run
          </button>
          {snap.best > 0 && <p className="best-line">Personal best: {snap.best}</p>}
          <button className="text-btn" onClick={() => game()?.toggleMute()}>
            Sound: {snap.muted ? 'off' : 'on'}
          </button>
        </div>
      )}

      {snap.phase === 'paused' && (
        <div className="overlay dim">
          <div className="card center">
            <h2>Paused</h2>
            <p className="muted-text">Take a breather. Traffic go wait.</p>
            <button className="cta" onClick={() => game()?.resume()} autoFocus>
              Resume
            </button>
            <button className="text-btn" onClick={() => game()?.start()}>
              Restart run
            </button>
          </div>
        </div>
      )}

      {snap.phase === 'over' && (
        <div className="overlay dim">
          <div className="card center over">
            <h2 className="crash-title">{crash.title}</h2>
            <p className="muted-text">{crash.line}</p>
            {snap.newBest && <div className="badge">New personal best!</div>}
            <div className="stats">
              <div>
                <span className="stat-label">Score</span>
                <span className="stat-value">{snap.score}</span>
              </div>
              <div>
                <span className="stat-label">Naira</span>
                <span className="stat-value coin">₦{snap.coins}</span>
              </div>
              <div>
                <span className="stat-label">Best</span>
                <span className="stat-value">{snap.best}</span>
              </div>
            </div>
            <button className="cta" onClick={() => game()?.start()} autoFocus>
              Run again
            </button>
            <p className="muted-text small">Tap, swipe up or press Enter to restart</p>
          </div>
        </div>
      )}
    </div>
  );
}

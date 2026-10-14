import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildShareMessage, gameUrl, shareScore } from './share';

describe('share message', () => {
  it('includes score, naira and a challenge', () => {
    const msg = buildShareMessage(2450.7, 86, false);
    expect(msg).toBe('I scored 2,450 and grabbed ₦86 in Danfo Dash 🚌 Can you beat me?');
  });

  it('brags about a new personal best', () => {
    expect(buildShareMessage(100, 2, true)).toMatch(/^New personal best! I scored 100/);
  });

  it('links to the game without query or hash', () => {
    expect(gameUrl({ origin: 'https://danfo.example', pathname: '/play/' })).toBe('https://danfo.example/play/');
  });
});

describe('shareScore', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses the native share sheet when available', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, share });
    expect(await shareScore(10, 1, false)).toBe('shared');
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ title: 'Danfo Dash', url: gameUrl() }));
  });

  it('treats closing the share sheet as cancelled', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('closed', 'AbortError'));
    vi.stubGlobal('navigator', { ...navigator, share });
    expect(await shareScore(10, 1, false)).toBe('cancelled');
  });

  it('copies to the clipboard when sharing is unsupported', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, share: undefined, clipboard: { writeText } });
    expect(await shareScore(10, 1, false)).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('I scored 10'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(gameUrl()));
  });
});

/** Score sharing: native share sheet on phones, clipboard everywhere else. */

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

export function buildShareMessage(score: number, coins: number, newBest: boolean): string {
  const fmt = (n: number) => Math.floor(n).toLocaleString('en-US');
  const brag = newBest ? 'New personal best! ' : '';
  return `${brag}I scored ${fmt(score)} and grabbed ₦${fmt(coins)} in Danfo Dash 🚌 Can you beat me?`;
}

/** The game's own address, without query strings or hashes. */
export function gameUrl(loc: Pick<Location, 'origin' | 'pathname'> = window.location): string {
  return loc.origin + loc.pathname;
}

export async function shareScore(score: number, coins: number, newBest: boolean): Promise<ShareResult> {
  const text = buildShareMessage(score, coins, newBest);
  const url = gameUrl();

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: 'Danfo Dash', text, url });
      return 'shared';
    } catch (e) {
      // The user closed the share sheet – not an error.
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      // Otherwise fall through to copying.
    }
  }
  return (await copyText(`${text} ${url}`)) ? 'copied' : 'failed';
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall back below */
  }
  // Older browsers / non-secure contexts.
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

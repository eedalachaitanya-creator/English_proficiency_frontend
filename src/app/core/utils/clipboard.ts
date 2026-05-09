/**
 * Copy a string to the system clipboard, working in BOTH secure and
 * non-secure browsing contexts.
 *
 * Why this exists: navigator.clipboard.writeText() is only defined in
 * "secure contexts" — HTTPS, localhost, or 127.0.0.1. When HR opens the
 * app over a LAN IP like http://10.0.0.14, navigator.clipboard is
 * undefined, so the previous code threw a synchronous TypeError that
 * the .then().catch()/.finally() chain didn't catch. The Copy URL
 * button looked dead.
 *
 * Strategy:
 *   1. Prefer navigator.clipboard.writeText() when available.
 *   2. Fall back to the legacy document.execCommand('copy') path via a
 *      hidden <textarea>. This still works on plain HTTP / IP origins
 *      and is the universal "compatibility" path before the Async
 *      Clipboard API was widely shipped.
 *
 * Returns a Promise that resolves true if the copy succeeded, false
 * otherwise. Never rejects, so callers can chain .then() without
 * needing to also catch synchronous throws.
 */
export function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => legacyCopy(text),
    );
  }
  return Promise.resolve(legacyCopy(text));
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const ta = document.createElement('textarea');
  ta.value = text;
  // Off-screen but still selectable — display:none and visibility:hidden
  // both prevent execCommand('copy') from working in some browsers.
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '0';
  ta.style.width = '1px';
  ta.style.height = '1px';
  ta.style.padding = '0';
  ta.style.border = 'none';
  ta.style.opacity = '0';
  ta.style.pointerEvents = 'none';
  document.body.appendChild(ta);
  const previousActive = document.activeElement as HTMLElement | null;
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  // Restore focus so the page doesn't visibly jump.
  previousActive?.focus?.();
  return ok;
}

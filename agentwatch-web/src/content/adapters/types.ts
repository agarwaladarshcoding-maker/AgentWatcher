/**
 * A site adapter — the web analog of a desktop agent profile (spec §B7, §9).
 * Intentionally tiny: a host match, a busy signal (the Stop control), a stream
 * root to observe, and optional snippet / jump / reply helpers. Selectors are
 * the #1 maintenance risk, so unknown or drifted sites degrade to the generic
 * quiescence adapter rather than breaking.
 */
export interface AgentSiteAdapter {
  /** Stable id, e.g. "claude". */
  id: string;
  /** Human label, e.g. "Claude". */
  label: string;
  /** Host globs this adapter matches, e.g. ["claude.ai"]. */
  match: string[];
  /** Present in the DOM ONLY while generating (the Stop button). */
  busySelector?: string;
  /** The container to observe for mutations; defaults to document.body. */
  streamRoot: () => Element | null;
  /** Quiescence debounce in ms (fallback completion signal). */
  quietMs?: number;
  /** First ~chars of the latest answer, for the notification snippet. */
  lastMessageText?: () => string | null;
  /** Element to scroll into view on jump-back. */
  jumpTarget?: () => Element | null;
  /**
   * Type `text` into this site's composer and submit it. The ONE sanctioned
   * write beyond scroll-on-jump, only ever called for an explicit user reply
   * relayed from the bonded desktop app. Returns true if it succeeded.
   */
  injectReply?: (text: string) => boolean;
}

/** Match a hostname against an adapter's globs (suffix match on host). */
export function hostMatches(host: string, globs: string[]): boolean {
  return globs.some((g) => host === g || host.endsWith(`.${g}`) || host.includes(g));
}

/**
 * Generic composer injection: focus a contenteditable/textarea, set its value
 * via the native setter (so React/Vue see it), dispatch input, then submit by
 * pressing Enter. Used by adapters that don't override injectReply.
 */
export function genericInjectReply(
  editorSelector: string,
  text: string,
): boolean {
  const el = document.querySelector<HTMLElement>(editorSelector);
  if (!el) return false;
  el.focus();
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    setter?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    // contenteditable
    el.textContent = text;
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }
  el.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
    }),
  );
  return true;
}

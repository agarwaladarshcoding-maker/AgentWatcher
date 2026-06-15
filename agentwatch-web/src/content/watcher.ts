import type { AgentSiteAdapter } from "./adapters/types";
import { DEFAULT_QUIET_MS, type AgentState } from "../shared/types";

/**
 * The watcher — one MutationObserver state machine per page (spec §B7, §8).
 *
 * Busy detection, most-reliable-first:
 *   • PRIMARY  — the adapter's busySelector (the Stop control). Present while
 *     generating; gone when finished.
 *   • FALLBACK — mutation quiescence: if there's no busy selector, a burst of
 *     mutations marks "working" and `quietMs` of silence marks "done".
 *
 * Completion fires ONLY on the busy→idle edge, once per generation, so we never
 * notify for the user's own message or fire twice for one answer. All debounce
 * lives here (the content script outlives the ephemeral service worker).
 *
 * Read-only: the observer never writes to the page. The single allowed write is
 * scroll-on-jump, handled in content/index.ts.
 */
export interface WatcherReport {
  state(state: AgentState): void;
  completed(snippet: string | undefined, output: string | undefined): void;
}

export function startWatcher(
  adapter: AgentSiteAdapter,
  report: WatcherReport,
): () => void {
  let busy = false;
  let quietTimer: ReturnType<typeof setTimeout> | undefined;
  let observer: MutationObserver | null = null;
  const quietMs = adapter.quietMs ?? DEFAULT_QUIET_MS;

  const settleDone = (): void => {
    if (!busy) return;
    busy = false;
    const text = adapter.lastMessageText?.() ?? undefined;
    const snippet = text ? text.trim().slice(0, 120) : undefined;
    const output = text ? text.trim().slice(0, 4000) : undefined;
    report.state("done");
    report.completed(snippet, output);
  };

  const markWorking = (): void => {
    if (!busy) {
      busy = true;
      report.state("working");
    }
  };

  const hasBusySignal = (): boolean | null => {
    if (!adapter.busySelector) return null; // no signal → rely on quiescence
    return !!document.querySelector(adapter.busySelector);
  };

  const onMutations = (): void => {
    const signal = hasBusySignal();
    if (signal === true) {
      markWorking();
      clearTimeout(quietTimer);
    } else if (signal === false) {
      // Stop control gone → finished.
      settleDone();
    } else {
      // No busy selector: treat activity as working, debounce to done.
      markWorking();
      clearTimeout(quietTimer);
      quietTimer = setTimeout(settleDone, quietMs);
    }
  };

  const attach = (): void => {
    observer?.disconnect();
    const root = adapter.streamRoot() ?? document.body;
    observer = new MutationObserver(onMutations);
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  };

  attach();

  // SPA route changes: re-resolve the stream root so watching survives in-app
  // navigation (spec §9.3). Patch pushState/replaceState + listen to popstate.
  const reattach = (): void => {
    setTimeout(attach, 50);
  };
  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);
  history.pushState = function (...args) {
    origPush(...(args as Parameters<typeof history.pushState>));
    reattach();
  };
  history.replaceState = function (...args) {
    origReplace(...(args as Parameters<typeof history.replaceState>));
    reattach();
  };
  window.addEventListener("popstate", reattach);

  return () => {
    clearTimeout(quietTimer);
    observer?.disconnect();
    window.removeEventListener("popstate", reattach);
    history.pushState = origPush;
    history.replaceState = origReplace;
  };
}

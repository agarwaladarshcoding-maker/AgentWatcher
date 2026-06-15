import type { TrackedAgent } from "../shared/types";

/**
 * SW state store (spec §B7, §4.4). The MV3 service worker is ephemeral, so the
 * live picture is persisted to chrome.storage.session and rebuilt on wake from
 * content-script heartbeats. Nothing critical lives only in worker memory.
 *
 * Keyed by tabId. All reads/writes are async and best-effort.
 */
const KEY = "agents";

export type AgentMap = Record<number, TrackedAgent>;

export async function loadAgents(): Promise<AgentMap> {
  try {
    const got = await chrome.storage.session.get(KEY);
    return (got[KEY] as AgentMap) ?? {};
  } catch {
    return {};
  }
}

export async function saveAgents(agents: AgentMap): Promise<void> {
  try {
    await chrome.storage.session.set({ [KEY]: agents });
  } catch {
    /* storage may be unavailable; live map still works in-memory */
  }
}

/** The pairing code the user entered, persisted across SW restarts. */
const CODE_KEY = "bridgeCode";

export async function loadBridgeCode(): Promise<string> {
  try {
    const got = await chrome.storage.local.get(CODE_KEY);
    return (got[CODE_KEY] as string) ?? "";
  } catch {
    return "";
  }
}

export async function saveBridgeCode(code: string): Promise<void> {
  try {
    await chrome.storage.local.set({ [CODE_KEY]: code });
  } catch {
    /* ignore */
  }
}

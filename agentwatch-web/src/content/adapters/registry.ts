import { hostMatches, type AgentSiteAdapter } from "./types";
import { claude } from "./claude";
import { chatgpt } from "./chatgpt";
import { gemini } from "./gemini";
import { perplexity } from "./perplexity";
import { copilot } from "./copilot";
import { grok } from "./grok";
import { generic } from "./generic";

/** Tier-1 adapters, most-specific first (spec §9.5). */
export const ADAPTERS: AgentSiteAdapter[] = [
  claude,
  chatgpt,
  gemini,
  perplexity,
  copilot,
  grok,
];

/** All adapter ids we ship (sent in the bridge handshake). */
export const ADAPTER_IDS = ADAPTERS.map((a) => a.id);

/** Pick the adapter for a host; falls back to the generic quiescence adapter. */
export function pickAdapter(host: string): AgentSiteAdapter {
  return ADAPTERS.find((a) => hostMatches(host, a.match)) ?? generic;
}

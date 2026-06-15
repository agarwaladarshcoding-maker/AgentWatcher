import { create } from "zustand";
import type { AppSettings } from "../../../shared/types";
import { DEFAULT_SETTINGS } from "../../../shared/types";

/**
 * Renderer-side settings store. Persists to localStorage and mirrors every
 * change to the main process (which uses them for the Allow/Deny bytes and for
 * gating OS notifications).
 */
const STORAGE_KEY = "agentwatch.settings";

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* fall back to defaults */
  }
  return { ...DEFAULT_SETTINGS };
}

interface SettingsStore {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  /** Push current settings to main (call once on startup). */
  sync: () => void;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: load(),
  update: (patch) =>
    set((prev) => {
      const settings = { ...prev.settings, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      } catch {
        /* ignore quota errors */
      }
      window.agentwatch.updateSettings(settings);
      return { settings };
    }),
  sync: () => window.agentwatch.updateSettings(get().settings),
}));

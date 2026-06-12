import { join } from "node:path";
import fs from "node:fs";
import { app } from "electron";
import { DEFAULT_SETTINGS, type AppSettings } from "../shared/ipc";

/**
 * Persisted app settings (Phase 4) stored as JSON in userData. Defensive: any
 * read/write failure falls back to defaults and never throws into the app.
 */
export class Settings {
  private value: AppSettings = { ...DEFAULT_SETTINGS };
  private file = "";

  init(): void {
    try {
      this.file = join(app.getPath("userData"), "settings.json");
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
        this.value = { ...DEFAULT_SETTINGS, ...raw };
      }
    } catch (error) {
      console.error("[agentwatch] settings load failed, using defaults:", error);
      this.value = { ...DEFAULT_SETTINGS };
    }
  }

  get(): AppSettings {
    return { ...this.value };
  }

  set(patch: Partial<AppSettings>): AppSettings {
    this.value = { ...this.value, ...patch };
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.value, null, 2), "utf8");
    } catch (error) {
      console.error("[agentwatch] settings save failed:", error);
    }
    return this.get();
  }
}

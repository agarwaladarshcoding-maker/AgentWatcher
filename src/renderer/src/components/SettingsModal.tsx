import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { DEFAULT_SETTINGS, type AppSettings } from "../../../shared/ipc";

interface SettingsModalProps {
  onClose: () => void;
}

/**
 * Settings (Phase 4): the default Allow/Deny bytes written to a session's stdin.
 * A trailing newline is added automatically, so just type e.g. `y` / `n` (or
 * `yes`). These override the per-profile defaults for all sessions.
 */
export function SettingsModal({ onClose }: SettingsModalProps): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    let active = true;
    window.agentwatch
      .getSettings()
      .then((s) => active && setSettings(s))
      .catch(() => active && setSettings({ ...DEFAULT_SETTINGS }));
    return () => {
      active = false;
    };
  }, []);

  const strip = (v: string): string => v.replace(/\n$/, "");

  const save = async (patch: Partial<AppSettings>): Promise<void> => {
    const next = await window.agentwatch.setSettings(patch);
    setSettings(next);
  };

  return (
    <Modal title="Settings" onClose={onClose}>
      {!settings ? (
        <p className="modal-empty">Loading…</p>
      ) : (
        <div className="settings-form">
          <p className="settings-note">
            Default responses written to an agent&apos;s input when you click
            Allow / Deny. A newline is added automatically.
          </p>
          <label className="settings-row">
            <span>Allow sends</span>
            <input
              className="settings-input"
              value={strip(settings.defaultAllow)}
              onChange={(e) => save({ defaultAllow: e.target.value })}
              placeholder="y"
            />
          </label>
          <label className="settings-row">
            <span>Deny sends</span>
            <input
              className="settings-input"
              value={strip(settings.defaultDeny)}
              onChange={(e) => save({ defaultDeny: e.target.value })}
              placeholder="n"
            />
          </label>
          <p className="settings-saved">Changes save automatically.</p>
        </div>
      )}
    </Modal>
  );
}

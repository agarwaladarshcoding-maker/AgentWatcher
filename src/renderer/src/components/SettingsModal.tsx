import { Modal } from "./Modal";
import { useSettings } from "../store/settings";

/**
 * Settings: notification + sound toggles and configurable Allow/Deny responses
 * (architecture doc §8 Phase 4 / §16.6). The response fields override the agent
 * profile's defaults; \n / \r are interpreted as newline / carriage-return.
 */
function decode(s: string): string {
  return s.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t");
}
function encode(s: string): string {
  return s.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
}

export function SettingsModal({
  onClose,
}: {
  onClose: () => void;
}): JSX.Element {
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);

  return (
    <Modal
      title="Settings"
      onClose={onClose}
      small
      actions={
        <button className="btn btn-allow" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="field">
        <label className="field-toggle">
          <input
            type="checkbox"
            checked={settings.notifications}
            onChange={(e) => update({ notifications: e.target.checked })}
          />
          Show OS notifications for permission prompts
        </label>
        <p className="field-hint">
          Click a notification to jump to the agent; on macOS you can Allow/Deny
          or type a reply right from it.
        </p>
      </div>

      <div className="field">
        <label className="field-toggle">
          <input
            type="checkbox"
            checked={settings.sound}
            onChange={(e) => update({ sound: e.target.checked })}
          />
          Play a chime when a permission lands
        </label>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="set-allow">
          Allow sends (blank = agent default, usually <code>y</code>)
        </label>
        <input
          id="set-allow"
          className="field-input"
          value={encode(settings.allowInput)}
          placeholder="\n  (e.g. y\\n)"
          onChange={(e) => update({ allowInput: decode(e.target.value) })}
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="set-deny">
          Deny sends (blank = agent default, usually <code>n</code>)
        </label>
        <input
          id="set-deny"
          className="field-input"
          value={encode(settings.denyInput)}
          placeholder="\n  (e.g. n\\n)"
          onChange={(e) => update({ denyInput: decode(e.target.value) })}
        />
      </div>
    </Modal>
  );
}

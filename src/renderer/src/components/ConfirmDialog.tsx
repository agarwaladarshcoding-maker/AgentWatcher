import { Modal } from "./Modal";

/**
 * A small confirmation dialog — used before terminating a live session so the
 * red close button never kills an agent by accident.
 */
export function ConfirmDialog({
  title,
  message,
  warn,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  warn?: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <Modal
      title={title}
      onClose={onClose}
      small
      actions={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-deny"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="confirm-text">{message}</p>
      {warn && <p className="confirm-text confirm-warn">{warn}</p>}
    </Modal>
  );
}

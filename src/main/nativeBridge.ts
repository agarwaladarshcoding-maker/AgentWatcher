import fs from "node:fs";
import tty from "node:tty";

/**
 * NativeTerminalBridge — the "many mirrors" half of the dual-mirror passthrough
 * (architecture doc §18 "One process, many mirrors", Phase 2).
 *
 * It attaches to the controlling terminal that launched `agentwatch` (via
 * /dev/tty) and lets the SINGLE PTY also drive that native terminal:
 *   - verbatim PTY output is written to the native terminal (a second faithful sink)
 *   - raw keystrokes typed in the native terminal are forwarded back to the PTY
 *   - native terminal resizes are reported so the PTY can follow
 *
 * Crucially there is no second process: we never spawn the CLI twice. This is a
 * byte-level passthrough, so it is fully agent-agnostic.
 *
 * It is best-effort: when there is no controlling TTY (e.g. a packaged
 * double-click launch, or a GUI-only dev run), attach() returns false and the
 * app runs GUI-only with no error.
 */
export interface NativeBridgeHandlers {
  /** A chunk of raw input typed in the native terminal. */
  onInput: (data: string) => void;
  /** The native terminal was resized. */
  onResize: (cols: number, rows: number) => void;
}

export class NativeTerminalBridge {
  private inStream: tty.ReadStream | null = null;
  private outStream: tty.WriteStream | null = null;
  private inFd: number | null = null;
  private outFd: number | null = null;
  private attached = false;
  private rawModeSet = false;

  get isAttached(): boolean {
    return this.attached;
  }

  /** Current native terminal size, or null if not attached / unknown. */
  get size(): { cols: number; rows: number } | null {
    if (this.outStream && this.outStream.columns && this.outStream.rows) {
      return { cols: this.outStream.columns, rows: this.outStream.rows };
    }
    return null;
  }

  /**
   * Try to attach to the controlling terminal. Returns true on success.
   * Windows is not supported yet (no /dev/tty); it falls back to GUI-only.
   */
  attach(handlers: NativeBridgeHandlers): boolean {
    if (process.platform === "win32") return false;

    let outFd: number;
    let inFd: number;
    try {
      outFd = fs.openSync("/dev/tty", "w");
      inFd = fs.openSync("/dev/tty", "r");
    } catch {
      return false; // no controlling terminal
    }

    if (!tty.isatty(outFd) || !tty.isatty(inFd)) {
      this.safeClose(outFd);
      this.safeClose(inFd);
      return false;
    }

    try {
      this.outStream = new tty.WriteStream(outFd);
      this.inStream = new tty.ReadStream(inFd);
    } catch {
      this.safeClose(outFd);
      this.safeClose(inFd);
      return false;
    }
    this.outFd = outFd;
    this.inFd = inFd;

    // Raw mode so every keystroke (incl. Ctrl-C as \x03) is forwarded to the
    // PTY rather than interpreted by the native terminal's line discipline.
    try {
      this.inStream.setRawMode(true);
      this.rawModeSet = true;
    } catch {
      // some terminals may refuse; passthrough output still works
    }

    this.inStream.on("data", (chunk: Buffer) => {
      handlers.onInput(chunk.toString("utf8"));
    });
    this.inStream.on("error", () => {
      /* ignore: terminal can disappear */
    });

    this.outStream.on("resize", () => {
      const size = this.size;
      if (size) handlers.onResize(size.cols, size.rows);
    });

    this.attached = true;

    // Report the initial size so the PTY can start matching the native terminal.
    const size = this.size;
    if (size) handlers.onResize(size.cols, size.rows);

    return true;
  }

  /** Write a verbatim chunk of PTY output to the native terminal. */
  write(data: string): void {
    if (this.attached && this.outStream) this.outStream.write(data);
  }

  /** Restore the native terminal and release the fds. */
  detach(): void {
    if (!this.attached) return;
    this.attached = false;

    if (this.inStream) {
      try {
        if (this.rawModeSet) this.inStream.setRawMode(false);
      } catch {
        /* ignore */
      }
      this.inStream.removeAllListeners("data");
      try {
        this.inStream.destroy();
      } catch {
        /* ignore */
      }
    }
    if (this.outStream) {
      try {
        this.outStream.destroy();
      } catch {
        /* ignore */
      }
    }
    this.inStream = null;
    this.outStream = null;
    this.rawModeSet = false;
    // destroy() closes the underlying fds; nothing else to close.
    this.inFd = null;
    this.outFd = null;
  }

  private safeClose(fd: number): void {
    try {
      fs.closeSync(fd);
    } catch {
      /* ignore */
    }
  }
}

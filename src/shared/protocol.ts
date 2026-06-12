/**
 * AgentWatch relay wire protocol (TS twin of bin/protocol.js).
 *
 * A single local socket carries both control messages and the raw PTY byte
 * stream, framed as:
 *
 *   [ type:uint8 ][ length:uint32 BE ][ payload: <length> bytes ]
 *
 * Keep this in exact sync with bin/protocol.js (the CJS twin used by the
 * launcher). Used by the Electron main process IPC socket server.
 */
export enum FrameType {
  CREATE = 1, // client -> server : JSON { command, args, cwd, cols, rows }
  INPUT = 2, //  client -> server : raw stdin bytes
  RESIZE = 3, // client -> server : JSON { cols, rows }
  OUTPUT = 4, // server -> client : raw PTY output bytes
  EXIT = 5, //   server -> client : JSON { code, signal }
  READY = 6, //  server -> client : JSON { sessionId, pid }
}

export const HEADER_LEN = 5;

export interface CreatePayload {
  command: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
}

export function encode(type: FrameType, payload: Buffer | string): Buffer {
  const body = Buffer.isBuffer(payload)
    ? payload
    : Buffer.from(payload ?? "", "utf8");
  const header = Buffer.allocUnsafe(HEADER_LEN);
  header.writeUInt8(type, 0);
  header.writeUInt32BE(body.length, 1);
  return Buffer.concat([header, body]);
}

export function encodeJson(type: FrameType, obj: unknown): Buffer {
  return encode(type, Buffer.from(JSON.stringify(obj), "utf8"));
}

/**
 * Incremental frame decoder. Feed it socket chunks; it invokes onFrame for each
 * complete frame, tolerating frames split across chunks.
 */
export class FrameDecoder {
  private buf: Buffer = Buffer.alloc(0);

  constructor(private readonly onFrame: (type: number, payload: Buffer) => void) {}

  push(chunk: Buffer): void {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      if (this.buf.length < HEADER_LEN) return;
      const type = this.buf.readUInt8(0);
      const len = this.buf.readUInt32BE(1);
      if (this.buf.length < HEADER_LEN + len) return;
      const payload = this.buf.subarray(HEADER_LEN, HEADER_LEN + len);
      this.buf = this.buf.subarray(HEADER_LEN + len);
      this.onFrame(type, payload);
    }
  }
}

/** The well-known socket path shared by the launcher and the app. */
export function socketPath(): string {
  if (process.platform === "win32") {
    return "\\\\.\\pipe\\agentwatch";
  }
  const dir = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || "/tmp";
  return `${dir.replace(/\/$/, "")}/agentwatch.sock`;
}

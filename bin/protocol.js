"use strict";
/**
 * AgentWatch relay wire protocol (CJS — used by the bin/agentwatch.js launcher).
 *
 * A single local socket carries both control messages and the raw PTY byte
 * stream, so we frame everything:
 *
 *   [ type:uint8 ][ length:uint32 BE ][ payload: <length> bytes ]
 *
 * Keep this in exact sync with src/shared/protocol.ts (the TS twin used by the
 * Electron main process). The framing is tiny on purpose.
 */

const FrameType = {
  CREATE: 1, // client -> server : JSON { command, args, cwd, cols, rows }
  INPUT: 2, //  client -> server : raw stdin bytes
  RESIZE: 3, // client -> server : JSON { cols, rows }
  OUTPUT: 4, // server -> client : raw PTY output bytes
  EXIT: 5, //   server -> client : JSON { code, signal }
  READY: 6, //  server -> client : JSON { sessionId, pid }
};

const HEADER_LEN = 5;

function encode(type, payload) {
  const body = Buffer.isBuffer(payload)
    ? payload
    : Buffer.from(payload == null ? "" : String(payload), "utf8");
  const header = Buffer.allocUnsafe(HEADER_LEN);
  header.writeUInt8(type, 0);
  header.writeUInt32BE(body.length, 1);
  return Buffer.concat([header, body]);
}

function encodeJson(type, obj) {
  return encode(type, Buffer.from(JSON.stringify(obj), "utf8"));
}

/**
 * Incremental frame decoder. Feed it socket chunks; it calls onFrame(type,
 * payloadBuffer) for each complete frame. Tolerates frames split across chunks.
 */
class FrameDecoder {
  constructor(onFrame) {
    this.onFrame = onFrame;
    this.buf = Buffer.alloc(0);
  }

  push(chunk) {
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
function socketPath() {
  if (process.platform === "win32") {
    return "\\\\.\\pipe\\agentwatch";
  }
  const dir = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || "/tmp";
  return dir.replace(/\/$/, "") + "/agentwatch.sock";
}

module.exports = {
  FrameType,
  HEADER_LEN,
  encode,
  encodeJson,
  FrameDecoder,
  socketPath,
};

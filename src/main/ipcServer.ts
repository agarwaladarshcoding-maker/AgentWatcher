import net from "node:net";
import fs from "node:fs";
import {
  FrameType,
  FrameDecoder,
  encode,
  encodeJson,
  socketPath,
  type CreatePayload,
} from "../shared/protocol";
import type { SessionManager } from "./sessionManager";
import type { PtyExitInfo } from "../shared/ipc";

/**
 * The local socket server that relay launchers connect to (see bin/agentwatch.js).
 * Each connection is a viewer of one session: it sends CREATE/INPUT/RESIZE and
 * receives OUTPUT/EXIT. This is what lets every native terminal mirror its agent
 * while a single app owns all the PTYs.
 */
interface Client {
  socket: net.Socket;
  viewerId: string;
  sessionId: string | null;
}

export class IpcServer {
  private server: net.Server | null = null;
  private seq = 0;
  private readonly clients = new Set<Client>();
  private readonly bySession = new Map<string, Set<Client>>();

  constructor(private readonly sessions: SessionManager) {}

  listen(): void {
    const p = socketPath();
    if (process.platform !== "win32") {
      try {
        fs.unlinkSync(p);
      } catch {
        /* no stale socket */
      }
    }
    this.server = net.createServer((socket) => this.onConnection(socket));
    this.server.on("error", (err) =>
      console.error("[agentwatch] ipc server error:", err),
    );
    this.server.listen(p, () =>
      console.log(`[agentwatch] ipc server listening at ${p}`),
    );
  }

  private onConnection(socket: net.Socket): void {
    this.seq += 1;
    const client: Client = {
      socket,
      viewerId: `relay:${this.seq}`,
      sessionId: null,
    };
    this.clients.add(client);
    const decoder = new FrameDecoder((type, payload) =>
      this.onFrame(client, type, payload),
    );
    socket.on("data", (chunk) => decoder.push(chunk));
    socket.on("close", () => this.onClose(client));
    socket.on("error", () => {
      /* terminal can vanish; close handler cleans up */
    });
  }

  private onFrame(client: Client, type: number, payload: Buffer): void {
    switch (type) {
      case FrameType.CREATE: {
        let p: CreatePayload;
        try {
          p = JSON.parse(payload.toString("utf8")) as CreatePayload;
        } catch {
          return;
        }
        const info = this.sessions.create(
          {
            command: p.command,
            args: Array.isArray(p.args) ? p.args : [],
            cwd: p.cwd,
            cols: p.cols,
            rows: p.rows,
          },
          client.viewerId,
        );
        client.sessionId = info.id;
        let set = this.bySession.get(info.id);
        if (!set) {
          set = new Set();
          this.bySession.set(info.id, set);
        }
        set.add(client);
        this.send(
          client.socket,
          encodeJson(FrameType.READY, { sessionId: info.id, pid: info.pid }),
        );
        break;
      }
      case FrameType.INPUT:
        if (client.sessionId) {
          this.sessions.write(client.sessionId, payload.toString("utf8"));
        }
        break;
      case FrameType.RESIZE: {
        if (!client.sessionId) break;
        try {
          const { cols, rows } = JSON.parse(payload.toString("utf8"));
          this.sessions.setViewerSize(client.sessionId, client.viewerId, cols, rows);
        } catch {
          /* ignore malformed */
        }
        break;
      }
      default:
        break;
    }
  }

  private onClose(client: Client): void {
    this.clients.delete(client);
    if (client.sessionId) {
      const set = this.bySession.get(client.sessionId);
      set?.delete(client);
      if (set && set.size === 0) this.bySession.delete(client.sessionId);
      this.sessions.removeViewer(client.sessionId, client.viewerId);
    }
  }

  /** Forward verbatim PTY output to the relay(s) viewing this session. */
  sendOutput(id: string, chunk: string): void {
    const set = this.bySession.get(id);
    if (!set || set.size === 0) return;
    const frame = encode(FrameType.OUTPUT, Buffer.from(chunk, "utf8"));
    for (const c of set) this.send(c.socket, frame);
  }

  /** Tell the relay(s) the session ended, so the native terminal restores + exits. */
  sendExit(id: string, info: PtyExitInfo): void {
    const set = this.bySession.get(id);
    if (!set) return;
    const frame = encodeJson(FrameType.EXIT, info);
    for (const c of set) this.send(c.socket, frame);
  }

  close(): void {
    for (const c of this.clients) {
      try {
        c.socket.destroy();
      } catch {
        /* ignore */
      }
    }
    try {
      this.server?.close();
    } catch {
      /* ignore */
    }
    if (process.platform !== "win32") {
      try {
        fs.unlinkSync(socketPath());
      } catch {
        /* ignore */
      }
    }
  }

  private send(socket: net.Socket, buf: Buffer): void {
    try {
      if (!socket.destroyed) socket.write(buf);
    } catch {
      /* ignore */
    }
  }
}

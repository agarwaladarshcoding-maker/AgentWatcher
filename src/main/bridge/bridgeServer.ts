import { randomBytes } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import {
  BRIDGE_DEFAULT_PORT,
  BRIDGE_PORT_RANGE,
  BRIDGE_PROTOCOL_VERSION,
  parseInbound,
  type BridgeOutbound,
} from "../../shared/bridge";
import type { BrowserAgentRegistry } from "./browserAgents";

/**
 * BridgeServer — the local, server-less channel to the AgentWatch Web Chrome
 * extension (spec: browser-bonding §B1, §B0). It runs a loopback-only
 * WebSocket server (127.0.0.1) and speaks the JSON bridge contract.
 *
 * Security (R4.3, R4.6):
 *   - binds to 127.0.0.1 only (never 0.0.0.0) — no off-machine reach;
 *   - accepts connections only from chrome-extension:// origins;
 *   - requires a pairing token in `bridge:hello` before accepting any data.
 *
 * It is fully isolated: a crash or malformed input here must never touch CLI
 * sessions. When the extension disconnects, the registry is cleared so the
 * desktop "Chrome section" hides (additive-bonding invariant).
 */
export interface BridgeStatus {
  connected: boolean;
  port: number | null;
  pairingCode: string;
}

export class BridgeServer {
  private wss: WebSocketServer | null = null;
  private port: number | null = null;
  private authed = new Set<WebSocket>();
  /** The pairing token the extension must present (shown in the app UI). */
  private readonly token = randomBytes(4).toString("hex"); // 8-char code

  constructor(
    private readonly registry: BrowserAgentRegistry,
    private readonly onStatusChange: (status: BridgeStatus) => void,
  ) {}

  status(): BridgeStatus {
    return {
      connected: this.authed.size > 0,
      port: this.port,
      pairingCode: this.token,
    };
  }

  /** Start listening; tries BRIDGE_DEFAULT_PORT then a small fallback range. */
  start(): void {
    this.listenFrom(BRIDGE_DEFAULT_PORT, 0);
  }

  private listenFrom(basePort: number, attempt: number): void {
    if (attempt >= BRIDGE_PORT_RANGE) {
      console.error("[agentwatch] bridge: no free port in range; bridge disabled");
      return;
    }
    const port = basePort + attempt;
    const wss = new WebSocketServer({ host: "127.0.0.1", port });
    wss.on("listening", () => {
      this.wss = wss;
      this.port = port;
      console.log(`[agentwatch] bridge listening at ws://127.0.0.1:${port}`);
      this.emitStatus();
    });
    wss.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        try {
          wss.close();
        } catch {
          /* ignore */
        }
        this.listenFrom(basePort, attempt + 1);
      } else {
        console.error("[agentwatch] bridge server error:", err);
      }
    });
    wss.on("connection", (socket, req) => this.onConnection(socket, req));
  }

  private onConnection(
    socket: WebSocket,
    req: { headers: Record<string, unknown> },
  ): void {
    // Origin allowlist: only our extension may connect.
    const origin = String(req.headers["origin"] ?? "");
    if (!origin.startsWith("chrome-extension://")) {
      this.deny(socket, "origin not allowed");
      return;
    }
    socket.on("message", (data) => this.onMessage(socket, data.toString()));
    socket.on("close", () => this.onClose(socket));
    socket.on("error", () => this.onClose(socket));
  }

  private onMessage(socket: WebSocket, text: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return; // malformed — ignore (R5.5)
    }
    const msg = parseInbound(parsed);
    if (!msg) return; // unknown/malformed — ignore (R5.5)

    // Until authenticated, the ONLY accepted message is a valid hello.
    if (!this.authed.has(socket)) {
      if (msg.type !== "bridge:hello") return;
      if (msg.token !== this.token) {
        this.deny(socket, "invalid pairing code");
        return;
      }
      this.authed.add(socket);
      this.send(socket, {
        type: "bridge:hello-ack",
        version: BRIDGE_PROTOCOL_VERSION,
        capabilities: ["focusTab", "scrollToLatest", "injectReply"],
      });
      this.emitStatus();
      return;
    }

    // Authenticated traffic → drive the registry.
    switch (msg.type) {
      case "bridge:hello":
        break; // already authed; ignore duplicate hello
      case "bridge:agents":
        this.registry.replaceSnapshot(msg.agents);
        break;
      case "agent:state":
        this.registry.applyState(msg.tabId, msg.state);
        break;
      case "agent:completed":
        this.registry.applyCompleted(
          msg.tabId,
          msg.label,
          msg.snippet,
          msg.output,
        );
        break;
    }
  }

  private onClose(socket: WebSocket): void {
    const wasAuthed = this.authed.delete(socket);
    if (wasAuthed && this.authed.size === 0) {
      // Last client gone → clear watched tabs so the Chrome section hides.
      this.registry.clear();
      this.emitStatus();
    }
  }

  // ── App → extension actions ───────────────────────────────────────────
  focusTab(tabId: number): void {
    this.broadcast({ type: "focusTab", tabId });
    this.broadcast({ type: "scrollToLatest", tabId });
  }

  injectReply(tabId: number, text: string): void {
    this.broadcast({ type: "injectReply", tabId, text });
  }

  private broadcast(msg: BridgeOutbound): void {
    for (const s of this.authed) this.send(s, msg);
  }

  private send(socket: WebSocket, msg: BridgeOutbound): void {
    try {
      socket.send(JSON.stringify(msg));
    } catch {
      /* socket may be closing; ignore */
    }
  }

  private deny(socket: WebSocket, reason: string): void {
    this.send(socket, { type: "bridge:denied", reason });
    try {
      socket.close();
    } catch {
      /* ignore */
    }
  }

  private emitStatus(): void {
    try {
      this.onStatusChange(this.status());
    } catch {
      /* never let a listener break the bridge */
    }
  }

  shutdown(): void {
    this.authed.clear();
    try {
      this.wss?.close();
    } catch {
      /* ignore */
    }
    this.wss = null;
    this.port = null;
  }
}

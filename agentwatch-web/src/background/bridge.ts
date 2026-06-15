import {
  BRIDGE_DEFAULT_PORT,
  BRIDGE_PORT_RANGE,
  BRIDGE_PROTOCOL_VERSION,
  type BridgeInbound,
  type BridgeOutbound,
  type TrackedAgent,
} from "../shared/types";

/**
 * Bridge client (spec §B7 task 22, §20 of the web plan). Connects OUT to the
 * desktop app's loopback WebSocket, completes a token handshake, and streams
 * watched-tab state. If no app is present it silently stays disconnected and
 * the extension works fully standalone (additive-bonding invariant).
 *
 * Resilience: probes the port range, auto-reconnects with backoff, and re-sends
 * a full snapshot on (re)connect so the desktop rebuilds its picture.
 */
export interface BridgeHandlers {
  onConnected(): void;
  onDisconnected(): void;
  /** App → ext: focus a tab (and scroll), or inject a reply. */
  onFocusTab(tabId: number): void;
  onScrollToLatest(tabId: number): void;
  onInjectReply(tabId: number, text: string): void;
  /** Provide the current snapshot to send on connect. */
  snapshot(): TrackedAgent[];
  /** The pairing token the user entered (empty disables bonding). */
  token(): string;
  /** Adapter ids we ship (sent in hello). */
  adapters(): string[];
}

export class BridgeClient {
  private ws: WebSocket | null = null;
  private connected = false;
  private authed = false;
  private portAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(private readonly h: BridgeHandlers) {}

  isConnected(): boolean {
    return this.authed;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }

  private connect(): void {
    if (this.stopped) return;
    if (!this.h.token()) {
      // No pairing code → don't attempt; retry later in case the user pairs.
      this.scheduleReconnect(4000);
      return;
    }
    const port = BRIDGE_DEFAULT_PORT + (this.portAttempt % BRIDGE_PORT_RANGE);
    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://127.0.0.1:${port}`);
    } catch {
      this.portAttempt += 1;
      this.scheduleReconnect(1000);
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this.send({
        type: "bridge:hello",
        version: BRIDGE_PROTOCOL_VERSION,
        adapters: this.h.adapters(),
        token: this.h.token(),
      });
    };
    ws.onmessage = (ev) => this.onMessage(String(ev.data));
    ws.onerror = () => {
      // A closed/forbidden port errors; advance to the next port and retry.
      this.portAttempt += 1;
    };
    ws.onclose = () => {
      const wasAuthed = this.authed;
      this.connected = false;
      this.authed = false;
      this.ws = null;
      if (wasAuthed) this.h.onDisconnected();
      this.scheduleReconnect(this.connected ? 1000 : 1500);
    };
  }

  private onMessage(text: string): void {
    let msg: BridgeInbound;
    try {
      msg = JSON.parse(text) as BridgeInbound;
    } catch {
      return;
    }
    switch (msg.type) {
      case "bridge:hello-ack":
        this.authed = true;
        this.portAttempt = 0;
        this.h.onConnected();
        this.sendSnapshot();
        break;
      case "bridge:denied":
        // Bad token/origin — stop hammering; the user must re-pair.
        try {
          this.ws?.close();
        } catch {
          /* ignore */
        }
        break;
      case "focusTab":
        this.h.onFocusTab(msg.tabId);
        break;
      case "scrollToLatest":
        this.h.onScrollToLatest(msg.tabId);
        break;
      case "injectReply":
        this.h.onInjectReply(msg.tabId, msg.text);
        break;
    }
  }

  sendSnapshot(): void {
    if (!this.authed) return;
    this.send({ type: "bridge:agents", agents: this.h.snapshot() });
  }

  sendState(tabId: number, state: TrackedAgent["state"]): void {
    if (this.authed) this.send({ type: "agent:state", tabId, state });
  }

  sendCompleted(agent: TrackedAgent): void {
    if (!this.authed) return;
    this.send({
      type: "agent:completed",
      tabId: agent.tabId,
      label: agent.label,
      snippet: agent.snippet,
      output: agent.output,
    });
  }

  private send(msg: BridgeOutbound): void {
    if (this.ws && this.connected) {
      try {
        this.ws.send(JSON.stringify(msg));
      } catch {
        /* socket closing */
      }
    }
  }

  private scheduleReconnect(delay: number): void {
    if (this.stopped) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}

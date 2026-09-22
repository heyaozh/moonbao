// WebSocket 客户端：把服务端事件翻译成总线事件；断线自动重连（指数退避）。
// 每次连上都发 hello（服务端 30 分钟内视为同一会话，不会重复主动开口）。

import type { ClientMessage, ServerEvent } from "../../shared/protocol";
import type { SpeechAudio } from "../audio";
import type { Bus } from "./bus";

export class EngineClient {
  private ws: WebSocket | null = null;
  private retry = 0;
  private closed = false;
  connected = false;

  constructor(
    private bus: Bus,
    private audio: SpeechAudio | null = null
  ) {}

  connect() {
    this.closed = false;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.connected = true;
      this.bus.emit("net:status", { connected: true });
      this.send({ type: "hello" });
    };
    ws.onmessage = (e) => {
      let ev: ServerEvent;
      try {
        ev = JSON.parse(e.data);
      } catch {
        return;
      }
      this.dispatch(ev);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.connected) this.bus.emit("net:status", { connected: false });
      this.connected = false;
      if (this.closed) return;
      const delay = Math.min(8000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => ws.close();
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }

  send(msg: ClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  private dispatch(ev: ServerEvent) {
    switch (ev.type) {
      case "state":
        this.bus.emit("engine:state", { value: ev.value });
        break;
      case "transcript":
        this.bus.emit("engine:transcript", { role: ev.role, text: ev.text, confidence: ev.confidence });
        break;
      case "emotion":
        this.bus.emit("engine:emotion", { valence: ev.valence, arousal: ev.arousal });
        break;
      case "action":
        this.bus.emit("engine:action", { name: ev.name, intensity: ev.intensity });
        break;
      case "proactive":
        this.bus.emit("engine:proactive", { reason: ev.reason });
        break;
      case "reply_delta":
        this.bus.emit("engine:reply_delta", { text: ev.text });
        break;
      case "reply_done":
        this.bus.emit("engine:reply_done", { text: ev.text });
        break;
      case "audio":
        void this.audio?.enqueue(ev.gen, ev.seq, ev.mp3Base64);
        break;
      case "audio_done":
        break;
      case "hello_ack":
        this.bus.emit("engine:hello", { absentDays: ev.absentDays, voice: ev.voice });
        break;
      case "error":
        this.bus.emit("engine:error", { message: ev.message });
        break;
    }
  }
}

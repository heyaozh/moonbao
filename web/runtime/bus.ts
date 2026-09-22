// 事件总线：前端的中枢。引擎事件、本地反射、UI 输入都经它流转，渲染层只订阅它。
// PLAN §2「事件总线中枢」原则的前端落地。

import type { Action, EngineState } from "../../shared/protocol";

export interface BusEvents {
  /** 用户开始/停止打字（Tier 0 反射源） */
  "user:typing": { active: boolean };
  "user:send": { text: string };
  "net:status": { connected: boolean };
  "engine:state": { value: EngineState };
  "engine:emotion": { valence: number; arousal: number };
  "engine:action": { name: Action; intensity: number };
  "engine:reply_delta": { text: string };
  "engine:reply_done": { text: string };
  "engine:transcript": { role: "user" | "pet"; text: string; confidence?: number };
  "engine:proactive": { reason: "follow_up" | "return" };
  "engine:hello": { absentDays: number; voice: boolean };
  "engine:error": { message: string };
  /** 经节拍器重新放出的协议流（渲染层与气泡消费这些，不直接消费 engine:*） */
  "paced:emotion": { valence: number; arousal: number };
  "paced:action": { name: Action; intensity: number };
  /** 已显现的正文全文（逐字增长） */
  "paced:text": { text: string };
  "paced:done": { text: string };
}

type Handler<K extends keyof BusEvents> = (payload: BusEvents[K]) => void;

export class Bus {
  private handlers = new Map<keyof BusEvents, Set<Handler<any>>>();

  on<K extends keyof BusEvents>(type: K, fn: Handler<K>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit<K extends keyof BusEvents>(type: K, payload: BusEvents[K]) {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(payload);
      } catch (e) {
        console.error(`[bus] ${String(type)} handler:`, e);
      }
    }
  }
}

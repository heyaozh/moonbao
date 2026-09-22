// 角色运行时：把总线上的事件变成渲染层调用。
// 两类来源：
//   1. 大脑层（LLM 首行头）→ 情绪目标 + 动作意图
//   2. Tier 0 反射（纯代码，0ms）：打字→飘近；思考中→歪头；卡太久→变暗；断线→变暗/重连→亮起；
//      出错→抖一下。失败即人设：任何异常都先变成一个可爱的身体反应。
// 低延迟的第一道防线在这里：用户还没等到云端，它已经有反应了。

import type { EngineState } from "../../shared/protocol";
import type { Bus } from "./bus";
import type { CharacterRenderer } from "./renderer";

export interface RuntimeOptions {
  /** 思考多久没回音先歪头（ms） */
  thinkTiltAfter?: number;
  /** 思考多久算"卡住"，暗下去（ms） */
  stallAfter?: number;
  /** 打字飘近的冷却（ms） */
  leanCooldown?: number;
}

export function installRuntime(bus: Bus, renderer: CharacterRenderer, opts: RuntimeOptions = {}) {
  const thinkTiltAfter = opts.thinkTiltAfter ?? 700;
  const stallAfter = opts.stallAfter ?? 7000;
  const leanCooldown = opts.leanCooldown ?? 8000;

  let state: EngineState = "idle";
  let thinkTimer: ReturnType<typeof setTimeout> | null = null;
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  let lastLeanAt = -Infinity;
  let wasDisconnected = false;
  let greeted = false;

  const clearTimers = () => {
    if (thinkTimer) clearTimeout(thinkTimer);
    if (stallTimer) clearTimeout(stallTimer);
    thinkTimer = stallTimer = null;
  };

  // ---- 大脑层 ----
  bus.on("paced:emotion", ({ valence, arousal }) => renderer.setEmotion(valence, arousal));
  bus.on("paced:action", ({ name, intensity }) => renderer.playAction(name, intensity));

  // ---- Tier 0 反射 ----
  bus.on("user:typing", ({ active }) => {
    renderer.setListening(active);
    const now = performance.now();
    if (active && now - lastLeanAt > leanCooldown) {
      lastLeanAt = now;
      renderer.playAction("lean_in", 0.5);
    }
  });

  bus.on("user:send", () => {
    renderer.setListening(false);
  });

  bus.on("engine:state", ({ value }) => {
    state = value;
    clearTimers();
    renderer.setSpeaking(value === "speaking");
    if (value === "thinking") {
      thinkTimer = setTimeout(() => {
        if (state === "thinking") renderer.playAction("think_tilt", 0.5);
      }, thinkTiltAfter);
      stallTimer = setTimeout(() => {
        if (state === "thinking") renderer.playAction("dim", 0.4);
      }, stallAfter);
    }
  });

  bus.on("net:status", ({ connected }) => {
    if (!connected) {
      wasDisconnected = true;
      renderer.playAction("dim", 0.6);
    } else if (wasDisconnected) {
      wasDisconnected = false;
      renderer.playAction("brighten", 0.6);
    }
  });

  bus.on("engine:hello", () => {
    // 见面点个头（只在本页第一次连上时）
    if (greeted) return;
    greeted = true;
    setTimeout(() => renderer.playAction("nod", 0.5), 400);
  });

  bus.on("engine:error", () => {
    renderer.playAction("shiver", 0.4);
  });
}

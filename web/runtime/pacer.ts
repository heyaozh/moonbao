// 节拍器：把服务端一口气流下来的「头/正文」按说话的节奏重新放出来。
// 为什么：LLM 一秒内就能吐完两拍，如果情绪/动作立刻全应用，第二拍会瞬间盖掉第一拍——
// 观众什么都没看见。这里让文字按阅读速度逐字显现，后续拍的情绪/动作等前一拍的话说完再上。
// 第一拍不等（表情先于文字动，这是协议的初衷）。打断/新一轮 → 立刻清空。

import type { Action } from "../../shared/protocol";
import type { Bus } from "./bus";

type Item =
  | { kind: "emotion"; valence: number; arousal: number }
  | { kind: "action"; name: Action; intensity: number }
  | { kind: "text"; text: string }
  | { kind: "done"; text: string };

export interface PacerOptions {
  /** 基础显现速度（字/秒） */
  charsPerSec?: number;
  /** 积压超过这么多字就加速 */
  backlogFast?: number;
  /** 拍与拍之间的停顿（ms） */
  beatPause?: number;
}

export function installPacer(bus: Bus, opts: PacerOptions = {}) {
  const cps = opts.charsPerSec ?? 13;
  const backlogFast = opts.backlogFast ?? 36;
  const beatPause = opts.beatPause ?? 380;

  const queue: Item[] = [];
  let shown = ""; // 本轮已显现的正文
  let revealedAny = false; // 本轮是否已经显现过正文（首拍不等）
  let holdUntil = 0; // 停顿到什么时候
  let acc = 0; // 字数累加器（小数）
  let lastT = performance.now();
  // 用 setTimeout 而不是 rAF：后台/隐藏标签页里 rAF 会完全停掉，回到前台时话才继续说；
  // setTimeout 在后台只是降频，dt 放宽到 1s 让它能追上进度。
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flushAll = () => {
    // 立刻把队列里剩下的全部放出（打断/出错/新一轮）
    for (const it of queue) {
      if (it.kind === "text") shown += it.text;
      else if (it.kind === "emotion") bus.emit("paced:emotion", it);
      else if (it.kind === "action") bus.emit("paced:action", it);
      else if (it.kind === "done") bus.emit("paced:done", { text: it.text });
    }
    queue.length = 0;
    if (shown) bus.emit("paced:text", { text: shown });
  };
  const reset = () => {
    queue.length = 0;
    shown = "";
    revealedAny = false;
    holdUntil = 0;
    acc = 0;
  };

  const tick = () => {
    timer = null;
    const now = performance.now();
    const dt = Math.min(1, (now - lastT) / 1000);
    lastT = now;

    if (now >= holdUntil) {
      let budget = dt * cps * (backlog() > backlogFast ? 2.2 : 1) + acc;
      acc = 0;
      while (queue.length > 0) {
        const it = queue[0];
        if (it.kind === "emotion" || it.kind === "action") {
          // 后续拍：等前面的话说完，再停顿一下
          if (revealedAny && it.kind === "emotion" && holdUntil < now) {
            holdUntil = now + beatPause;
            queue.shift();
            bus.emit("paced:emotion", it);
            break;
          }
          queue.shift();
          if (it.kind === "emotion") bus.emit("paced:emotion", it);
          else bus.emit("paced:action", it);
          continue;
        }
        if (it.kind === "done") {
          queue.shift();
          bus.emit("paced:done", { text: it.text });
          continue;
        }
        // 正文：按预算逐字放
        if (budget < 1) {
          acc = budget;
          break;
        }
        const n = Math.min(it.text.length, Math.floor(budget));
        const piece = it.text.slice(0, n);
        it.text = it.text.slice(n);
        budget -= n;
        shown += piece;
        revealedAny = true;
        bus.emit("paced:text", { text: shown });
        // 句末小停顿
        if (/[。！？!?…]$/.test(piece)) {
          holdUntil = now + 160;
          if (!it.text) queue.shift();
          break;
        }
        if (!it.text) queue.shift();
      }
    }
    if (queue.length > 0) schedule();
  };
  const schedule = () => {
    if (!timer) timer = setTimeout(tick, 33);
  };
  const backlog = () => queue.reduce((n, it) => n + (it.kind === "text" ? it.text.length : 0), 0);
  const push = (it: Item) => {
    queue.push(it);
    lastT = performance.now();
    schedule();
  };

  bus.on("engine:emotion", (e) => push({ kind: "emotion", ...e }));
  bus.on("engine:action", (a) => push({ kind: "action", ...a }));
  bus.on("engine:reply_delta", ({ text }) => push({ kind: "text", text }));
  bus.on("engine:reply_done", ({ text }) => push({ kind: "done", text }));
  // 新一轮开始/主动开口/出错：上一轮残留立刻放完并清零
  bus.on("engine:transcript", ({ role }) => {
    if (role === "user") {
      flushAll();
      reset();
    }
  });
  bus.on("engine:proactive", () => {
    flushAll();
    reset();
  });
  bus.on("engine:error", () => {
    flushAll();
    reset();
  });
  bus.on("paced:done", () => {
    shown = "";
    revealedAny = false;
  });
}

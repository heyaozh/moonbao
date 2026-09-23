// 眨眼就是人格：间隔从指数分布抽（不是定时器），形态（普通 / 双眨 / 慢眨 / 眯眼 / 呆眼）由情绪偏置。
// 输出两个量：openness（0..1，竖向缩放）和 shape（贴图形态）。动作原语可以临时强制形态。

import type { EyeShape } from "./eyes";
import { expRandom, lerp } from "./math";
import { params } from "./params";

type Phase = "open" | "closing" | "hold" | "opening";

export class Blinker {
  openness = 1;
  shape: EyeShape = "round";
  /** 呆眼的连续量（1 = 正常，dazeScale = 完全呆） */
  daze = 1;
  private phase: Phase = "open";
  private t = 0;
  private nextIn = 2;
  private slow = false;
  private pendingDouble = false;
  private squintUntil = 0;
  private clock = 0;
  private forced: { shape: EyeShape; until: number } | null = null;
  /** 半睁（dim 时）：openness 上限 */
  lidCap = 1;

  constructor() {
    this.schedule(0.5);
  }

  private schedule(arousal: number) {
    const b = params.blink;
    const mean = lerp(b.meanCalm, b.meanExcited, arousal);
    this.nextIn = Math.max(b.minGap, expRandom(mean));
  }

  /** 立刻眨一次（被戳、惊讶用）。 */
  blinkNow(double = false) {
    if (this.phase !== "open") return;
    this.phase = "closing";
    this.t = 0;
    this.pendingDouble = double;
  }

  /** 动作原语临时强制形态（秒）。 */
  force(shape: EyeShape, dur: number) {
    this.forced = { shape, until: this.clock + dur };
  }

  update(dt: number, valence: number, arousal: number) {
    const b = params.blink;
    this.clock += dt;
    this.t += dt;
    const closeDur = b.closeDur * (this.slow ? b.slowFactor : 1);
    const openDur = b.openDur * (this.slow ? b.slowFactor : 1);
    const hold = this.slow ? b.slowHold : 0.02;

    switch (this.phase) {
      case "open":
        this.openness = Math.min(this.lidCap, lerp(this.openness, 1, 1 - Math.exp(-dt / 0.08)));
        if (this.t >= this.nextIn) {
          this.phase = "closing";
          this.t = 0;
          // 形态抽签：困 / 信任 → 慢眨多；兴奋 → 双眨多
          const r = Math.random();
          const pSlow = b.pSlow + (arousal < 0.3 ? 0.25 : 0) + (valence > 0.5 ? 0.08 : 0);
          const pDouble = b.pDouble + (arousal > 0.7 ? 0.2 : 0);
          this.slow = r < pSlow;
          this.pendingDouble = !this.slow && r > 1 - pDouble;
        }
        break;
      case "closing":
        this.openness = Math.max(0, 1 - this.t / closeDur);
        if (this.t >= closeDur) {
          this.phase = "hold";
          this.t = 0;
        }
        break;
      case "hold":
        this.openness = 0;
        if (this.t >= hold) {
          this.phase = "opening";
          this.t = 0;
        }
        break;
      case "opening":
        this.openness = Math.min(1, this.t / openDur);
        if (this.t >= openDur) {
          this.t = 0;
          if (this.pendingDouble) {
            this.pendingDouble = false;
            this.phase = "open";
            this.nextIn = b.doubleGap;
          } else {
            this.phase = "open";
            this.slow = false;
            this.schedule(arousal);
            // 心情好：眨完眼有概率停在 ^ ^
            if (valence >= b.squintValence && Math.random() < b.pSquint) {
              this.squintUntil = this.clock + b.squintHold;
            }
          }
        }
        break;
    }

    // 形态
    if (this.forced && this.clock < this.forced.until) {
      this.shape = this.forced.shape;
    } else {
      this.forced = null;
      this.shape = this.clock < this.squintUntil ? "squint" : "round";
    }
    // 呆眼：活力很低时眼睛缩成点（连续插值，不突变）
    const dazeTarget = arousal <= b.dazeArousal ? b.dazeScale : 1;
    this.daze = lerp(this.daze, dazeTarget, 1 - Math.exp(-dt / 0.5));
  }
}

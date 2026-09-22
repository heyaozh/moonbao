// 渲染层接口：角色运行时只往这里输出 { 情绪目标, 动作意图, 在听/在说 }。
// 月亮渲染器（P0 起）、DOM 占位、纯文本 stub 各自实现；随时可换、可叠加。

import type { Action } from "../../shared/protocol";

export interface CharacterRenderer {
  /** 情绪目标（渲染层自己做惯性，不许瞬变） */
  setEmotion(valence: number, arousal: number): void;
  playAction(name: Action, intensity: number): void;
  setListening(on: boolean): void;
  setSpeaking(on: boolean): void;
  update(dt: number): void;
}

/**
 * DOM 占位渲染器：一个会发光、会轻轻浮动的圆。
 * 作用只有一个——在真正的月亮渲染器落地之前，让整条链路（大脑 → 节拍器 → 运行时 → 渲染层）今天就能肉眼验证。
 * 不代表任何美术方向，P0 用 three.js 版替换它。
 */
export class PlaceholderRenderer implements CharacterRenderer {
  private target = { valence: 0.2, arousal: 0.5 };
  private cur = { valence: 0.2, arousal: 0.5 };
  private listening = false;
  private speaking = false;
  private t = 0;
  private kick = 0; // 动作触发后的短暂脉冲
  private label = "";
  /** 情绪趋近的时间常数（秒）：情绪有惯性 */
  tau = 1.4;

  constructor(private el: HTMLElement, private badge: HTMLElement | null = null) {}

  setEmotion(valence: number, arousal: number) {
    this.target.valence = Math.max(-1, Math.min(1, valence));
    this.target.arousal = Math.max(0, Math.min(1, arousal));
  }
  playAction(name: Action, intensity: number) {
    if (name === "idle_drift") return;
    this.kick = 0.6 + intensity * 0.6;
    this.label = name;
    if (this.badge) this.badge.textContent = name;
  }
  setListening(on: boolean) {
    this.listening = on;
  }
  setSpeaking(on: boolean) {
    this.speaking = on;
  }
  update(dt: number) {
    this.t += dt;
    const k = 1 - Math.exp(-dt / this.tau);
    this.cur.valence += (this.target.valence - this.cur.valence) * k;
    this.cur.arousal += (this.target.arousal - this.cur.arousal) * k;
    this.kick = Math.max(0, this.kick - dt);

    const a = this.cur.arousal + (this.speaking ? 0.12 : 0);
    const bob = Math.sin(this.t * (0.6 + a * 0.8)) * (4 + a * 6);
    const glow = 0.35 + (this.cur.valence + 1) * 0.25 + (this.listening ? 0.15 : 0);
    const scale = 1 + (this.kick > 0 ? Math.sin(this.kick * 8) * 0.04 : 0);
    this.el.style.transform = `translate(-50%, calc(-50% + ${bob.toFixed(1)}px)) scale(${scale.toFixed(3)})`;
    this.el.style.boxShadow = `0 0 ${Math.round(40 + glow * 80)}px ${Math.round(glow * 30)}px rgba(255, 244, 214, ${glow.toFixed(2)})`;
    this.el.style.opacity = String(0.75 + glow * 0.25);
  }
}

/** 文本 stub：把协议流打进一个 DOM 日志（或 console），无图也能验大脑 */
export class StubRenderer implements CharacterRenderer {
  constructor(private el: HTMLElement | null = null, private max = 40) {}
  private line(s: string) {
    const t = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    const msg = `${t} ${s}`;
    if (!this.el) {
      console.log("[renderer]", msg);
      return;
    }
    const d = document.createElement("div");
    d.textContent = msg;
    this.el.appendChild(d);
    while (this.el.childElementCount > this.max) this.el.firstElementChild?.remove();
    this.el.scrollTop = this.el.scrollHeight;
  }
  setEmotion(v: number, a: number) {
    this.line(`情绪 v=${v.toFixed(2)} a=${a.toFixed(2)}`);
  }
  playAction(name: Action, i: number) {
    this.line(`动作 ${name} ×${i.toFixed(1)}`);
  }
  setListening(on: boolean) {
    this.line(on ? "在听" : "不听了");
  }
  setSpeaking(on: boolean) {
    if (on) this.line("开口");
  }
  update() {}
}

/** 扇出：同一协议流喂给多个渲染层（月亮 + 日志） */
export class FanoutRenderer implements CharacterRenderer {
  constructor(private targets: CharacterRenderer[]) {}
  setEmotion(v: number, a: number) {
    for (const t of this.targets) t.setEmotion(v, a);
  }
  playAction(n: Action, i: number) {
    for (const t of this.targets) t.playAction(n, i);
  }
  setListening(on: boolean) {
    for (const t of this.targets) t.setListening(on);
  }
  setSpeaking(on: boolean) {
    for (const t of this.targets) t.setSpeaking(on);
  }
  update(dt: number) {
    for (const t of this.targets) t.update(dt);
  }
}

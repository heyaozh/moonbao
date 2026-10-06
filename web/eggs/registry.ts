// 彩蛋注册表（PLAN V9）：每条彩蛋 = 一个名字 + 一段编排（play）。三个入口都走 playEgg：
//   真实触发（手势 / 传感器 / 服务端命中）→ playEgg(name, ctx)
//   脚本化（录片、面板按钮、?scene=egg-<名字>）→ playEgg(name, ctx{scripted:true})：先 setup 搭场景，再 play
// 彩蛋之间互斥（同一时刻只演一条，EggStage）；用户看片打 ✗ 的在 params.eggs.<名字>.enabled 关掉，脚本化入口不受开关限制（还要能重录）。

import type { App } from "../app/app";
import type { SoundEngine } from "../audio/synth";
import type { ChatView } from "../chat/chatview";
import type { DemoBrain } from "../chat/demo";
import type { Behaviors } from "../moon/behaviors";
import type { MoonInteraction } from "../moon/interact";
import { params } from "../moon/params";
import { eggInfo } from "./catalog";
import type { SymbolFX } from "./symbols";

export interface EggCtx {
  app: App;
  chat: ChatView;
  demo: DemoBrain;
  life: Behaviors;
  interact: MoonInteraction;
  symbols: SymbolFX;
  sound: SoundEngine;
  stage: EggStage;
  /** 脚本化：录片 / 面板 / ?scene=egg-*（自己搭场景、自己说台词；不看开关） */
  scripted: boolean;
}

export type EggOpts = Record<string, unknown>;

export interface EggDef {
  play: (x: EggCtx, opts: EggOpts) => void;
  /** 脚本化时先搭的场景（例如先发一句暗号的气泡） */
  setup?: (x: EggCtx, opts: EggOpts) => void;
  /** setup 之后等多久再 play（秒，App 时钟） */
  lead?: number;
}

const defs = new Map<string, EggDef>();

export function defineEgg(name: string, def: EggDef) {
  if (!eggInfo(name)) console.warn(`[eggs] ${name} 不在 catalog 里（web/eggs/catalog.ts）`);
  defs.set(name, def);
}

/** 同一时刻只演一条 */
export class EggStage {
  private cur: { name: string; until: number } | null = null;
  /** App 时钟（主循环每帧喂） */
  now = 0;
  claim(name: string, seconds: number) {
    if (this.cur && this.now < this.cur.until && this.cur.name !== name) return false;
    this.cur = { name, until: this.now + seconds };
    return true;
  }
  release() {
    this.cur = null;
  }
  get active() {
    return !!this.cur && this.now < this.cur.until;
  }
  get current() {
    return this.active ? this.cur!.name : null;
  }
}

export function eggEnabled(name: string) {
  const e = (params.eggs as Record<string, { enabled?: boolean } | undefined>)[name];
  return e?.enabled !== false;
}

export function playEgg(name: string, x: EggCtx, opts: EggOpts = {}): boolean {
  const info = eggInfo(name);
  const def = defs.get(name);
  if (!info || !def) {
    console.warn(`[eggs] 没有这个彩蛋：${name}`);
    return false;
  }
  if (!x.scripted && !eggEnabled(name)) return false;
  if (!x.stage.claim(name, info.seconds)) return false;
  x.life.notifyActivity();
  if (x.scripted && def.setup) {
    def.setup(x, opts);
    x.demo.schedule(def.lead ?? 0.6, () => def.play(x, opts));
  } else def.play(x, opts);
  return true;
}

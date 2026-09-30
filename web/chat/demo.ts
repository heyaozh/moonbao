// 演示大脑：没连服务端时（或场景剧本里）按剧本回话。
// 它发出和真大脑经过节拍器之后一样的总线事件（engine:state、paced:emotion / action / text / done），
// 但用 App 的时钟，所以 __step 快进、录 GIF 都是确定的。台词取自用户的概念图。

import type { Action } from "../../shared/protocol";
import type { Bus } from "../runtime/bus";
import { isCJK } from "./glyphs";

interface Beat {
  at: number;
  fn: () => void;
  /** 属于哪一次回复（新消息来了，旧回复没说完的部分作废，和真引擎的打断一致） */
  gen?: number;
}

export interface Reply {
  text: string;
  v: number;
  a: number;
  act: Action;
  i: number;
  /** 想多久再回（秒） */
  think?: number;
}

const EN: [RegExp, Reply][] = [
  [/\b(hi|hello|hey)\b/i, { text: "Hi~ I was just counting the stars. You're my favorite one tonight.", v: 0.7, a: 0.7, act: "bounce", i: 0.6 }],
  [/(long day|tired|exhausted)/i, { text: "Rest here a moment. I'll keep the stars quiet for you.", v: 0.1, a: 0.3, act: "lean_in", i: 0.5 }],
  [/(sad|down|lonely|cry)/i, { text: "Come sit by me. We don't have to say anything.", v: -0.1, a: 0.25, act: "dim", i: 0.4, think: 1.8 }],
  [/(tried my best|nothing.*right|failed)/i, { text: "Even quiet stars are still shining.", v: 0.2, a: 0.35, act: "lean_in", i: 0.6 }],
  [/(stay with me|don't go)/i, { text: "Of course. We can watch the stars together.", v: 0.6, a: 0.5, act: "brighten", i: 0.6 }],
  [/(propose|boyfriend|girlfriend|love)/i, { text: "A little nervous, a lot in love. I'll keep a tiny constellation glowing for you.", v: 0.8, a: 0.7, act: "spin", i: 0.6 }],
  [/(good ?night|sleep)/i, { text: "Good night. I'll be right here, glowing softly.", v: 0.5, a: 0.2, act: "nod", i: 0.4 }],
  [/\?$/, { text: "Hmm… let me think. I'm only a small moon, but I'm listening.", v: 0.3, a: 0.4, act: "think_tilt", i: 0.6, think: 1.6 }],
];
const EN_DEFAULT: Reply[] = [
  { text: "I'm here. Tell me more?", v: 0.35, a: 0.5, act: "lean_in", i: 0.5 },
  { text: "Mm-hm. The stars and I are listening.", v: 0.4, a: 0.45, act: "nod", i: 0.5 },
  { text: "That sounds like a lot. You're doing okay.", v: 0.2, a: 0.35, act: "lean_in", i: 0.5 },
];
const ZH: [RegExp, Reply][] = [
  [/(你好|嗨|哈喽|在吗)/, { text: "你来啦。我刚刚在数星星，你是今晚最亮的那颗。", v: 0.7, a: 0.7, act: "bounce", i: 0.6 }],
  [/(累|困|忙)/, { text: "那就在这儿歇一会儿吧，我让星星们小声一点。", v: 0.1, a: 0.3, act: "lean_in", i: 0.5 }],
  [/(难过|伤心|不开心|哭)/, { text: "过来陪我坐一会儿。不说话也没关系。", v: -0.1, a: 0.25, act: "dim", i: 0.4, think: 1.8 }],
  [/(喧嚣|吵|孤单|一个人)/, { text: "当世界有些喧嚣，我会拾起最安静的星光，为你写下一句温柔的提醒：亲爱的朋友，今夜，你不必独自闪耀。", v: 0.6, a: 0.45, act: "brighten", i: 0.7 }],
  [/(晚安|睡)/, { text: "晚安。我就在这儿，轻轻地亮着。", v: 0.5, a: 0.2, act: "nod", i: 0.4 }],
  [/[？?]$/, { text: "唔……我想想。我只是个小月亮，但我在认真听。", v: 0.3, a: 0.4, act: "think_tilt", i: 0.6, think: 1.6 }],
];
const ZH_DEFAULT: Reply[] = [
  { text: "我在呢。再多说一点？", v: 0.35, a: 0.5, act: "lean_in", i: 0.5 },
  { text: "嗯嗯，我和星星都在听。", v: 0.4, a: 0.45, act: "nod", i: 0.5 },
  { text: "听起来不容易。你已经做得很好啦。", v: 0.2, a: 0.35, act: "lean_in", i: 0.5 },
];

export function cannedReply(user: string): Reply {
  const zh = [...user].some(isCJK);
  for (const [re, r] of zh ? ZH : EN) if (re.test(user.trim())) return r;
  const pool = zh ? ZH_DEFAULT : EN_DEFAULT;
  return pool[Math.floor(Math.random() * pool.length)];
}

export class DemoBrain {
  private t = 0;
  private beats: Beat[] = [];
  /** 字/秒（和真节拍器一样的阅读速度） */
  cps = 14;

  constructor(private bus: Bus) {}

  get busy() {
    return this.beats.length > 0;
  }

  /** 剧本：dt 秒后做某件事（App 时钟） */
  schedule(dt: number, fn: () => void) {
    this.at(dt, fn);
  }

  private gen = 0;
  private at(dt: number, fn: () => void, gen?: number) {
    this.beats.push({ at: this.t + dt, fn, gen });
    this.beats.sort((a, b) => a.at - b.at);
  }

  /** 打断：还没说完的那句作废（已经写出来的由 ChatView 在新一轮开始时收尾，和真引擎的抢话一致） */
  interrupt() {
    const n = this.beats.length;
    this.beats = this.beats.filter((b) => b.gen == null);
    if (this.beats.length !== n) this.bus.emit("engine:state", { value: "idle" });
  }

  /** 回一句：先想一下，再表情，再逐字 */
  reply(user: string, r: Reply = cannedReply(user), opts: { holdThinking?: boolean } = {}) {
    this.interrupt();
    const g = ++this.gen;
    const think = r.think ?? 0.9 + Math.random() * 0.5;
    this.at(0.05, () => this.bus.emit("engine:state", { value: "thinking" }), g);
    if (opts.holdThinking) return;
    this.at(think, () => {
      this.bus.emit("paced:emotion", { valence: r.v, arousal: r.a });
      this.bus.emit("paced:action", { name: r.act, intensity: r.i });
      this.bus.emit("engine:state", { value: "speaking" });
    }, g);
    this.stream(r.text, think + 0.15, g);
  }

  /** 它主动说一句（没有你的气泡） */
  say(text: string, v = 0.6, a = 0.5, act: Action = "brighten") {
    const g = ++this.gen;
    this.at(0.05, () => {
      this.bus.emit("engine:proactive", { reason: "follow_up" });
      this.bus.emit("moon:hint", { length: [...text].length, text });
      this.bus.emit("paced:emotion", { valence: v, arousal: a });
      this.bus.emit("paced:action", { name: act, intensity: 0.6 });
      this.bus.emit("engine:state", { value: "speaking" });
    }, g);
    this.stream(text, 0.3, g);
  }

  private stream(text: string, start: number, gen?: number) {
    const chars = [...text];
    let shown = "";
    // 标点后面喘一口气（整句往后顺延，字的先后不会乱）
    let t = start;
    for (const ch of chars) {
      this.at(t, () => {
        shown += ch;
        this.bus.emit("paced:text", { text: shown });
      }, gen);
      t += 1 / this.cps + (/[，。！？,.!?…]/.test(ch) ? 0.1 : 0);
    }
    this.at(t + 0.2, () => {
      this.bus.emit("paced:done", { text });
      this.bus.emit("engine:state", { value: "idle" });
    }, gen);
  }

  clear() {
    this.beats = [];
  }

  update(dt: number) {
    this.t += dt;
    while (this.beats.length && this.beats[0].at <= this.t) this.beats.shift()!.fn();
  }
}

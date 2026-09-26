// 首次见面（PLAN V7，成长点子 5「互相起名」）：
//   黑 → 星星亮起来 → 月亮从很深的地方飘过来，睡着的 → 醒来、眨眨眼、笑 → 用星星写：你好呀……我是你的小月亮
//   → 「我该怎么叫你呀？」你输入名字 → 它开心地念一遍 → 「那……你想叫我什么呢？」你给它起名 → 它转一圈，记住
// 这段台词是本地的（不走 LLM：确定、零成本、零延迟）。随时可以跳过；名字以后在设置里改。

import type { App } from "../app/app";
import type { ChatView } from "../chat/chatview";
import type { DemoBrain } from "../chat/demo";
import type { Behaviors } from "../moon/behaviors";
import type { MoonInteraction } from "../moon/interact";
import { params } from "../moon/params";
import { saveProfile, uiLang, type Profile } from "./settings";

const L = {
  en: {
    hello: "Hi… I'm your little moon.",
    askName: "What should I call you?",
    namePh: "Your name…",
    nice: (n: string) => `${n}… what a lovely name.`,
    askMoon: "And what would you like to call me?",
    moonPh: "A name for your moon…",
    love: (n: string) => `${n}. I love it.`,
    noName: "That's okay. I'll just be your moon.",
    skip: "skip",
  },
  zh: {
    hello: "你好呀……我是你的小月亮。",
    askName: "我该怎么叫你呀？",
    namePh: "你的名字…",
    nice: (n: string) => `${n}……好好听的名字。`,
    askMoon: "那……你想叫我什么呢？",
    moonPh: "给月亮起个名字…",
    love: (n: string) => `${n}。我好喜欢。`,
    noName: "没关系，那我就做你的月亮。",
    skip: "跳过",
  },
};

export class Onboarding {
  active = false;
  private step = 0;
  private t = 0;
  private fadeFrom = 1;
  private skipBtn: HTMLButtonElement | null = null;
  onDone?: () => void;

  constructor(
    private app: App,
    private chat: ChatView,
    private demo: DemoBrain,
    private interact: MoonInteraction,
    private life: Behaviors,
    private profile: Profile,
    private input: HTMLInputElement
  ) {}

  private get L() {
    return L[uiLang(this.profile)];
  }

  /** 它在说话的时候，输入框和语音先暗着（等它问完再答，字不会串行） */
  private listen(on: boolean) {
    this.input.disabled = !on;
    const v = document.getElementById("voiceBtn") as HTMLButtonElement | null;
    if (v) v.disabled = !on;
  }

  /** 说一句，返回说完需要的秒数 */
  private say(text: string, v = 0.6, a = 0.55) {
    this.demo.say(text, v, a, "idle_drift");
    return [...text].length / this.demo.cps + 1.3;
  }

  start() {
    this.active = true;
    this.step = 0;
    this.t = 0;
    this.chat.clear();
    this.life.paused = true;
    this.fadeFrom = params.post.exposure;
    params.post.exposure = 0.001;
    // 月亮在很深的地方，睡着
    this.interact.offset.set(0.6, 1.2, -7);
    this.interact.vel.set(0, 0, 0);
    this.app.moon.flashExpr("sleeping", 3.6);
    this.listen(false);
    this.skipBtn = document.createElement("button");
    this.skipBtn.id = "skipIntro";
    this.skipBtn.textContent = this.L.skip;
    this.skipBtn.onclick = () => this.finish();
    document.getElementById("glass")!.appendChild(this.skipBtn);
    const d = this.demo;
    d.schedule(3.5, () => {
      this.app.moon.flashExpr("surprised", 0.6);
      this.app.moon.blinker.blinkNow(true);
    });
    d.schedule(4.2, () => {
      this.app.moon.flashExpr("happy", 1.6);
      this.app.moon.playAction("bounce", 0.6, "manual");
      // 飘到一边，给星星写字的地方
      this.app.moon.chatMode = true;
    });
    d.schedule(4.8, () => {
      const dur = this.say(this.L.hello, 0.7, 0.6);
      d.schedule(dur + 0.6, () => {
        const d2 = this.say(this.L.askName, 0.5, 0.5);
        this.input.placeholder = this.L.namePh;
        this.step = 1;
        d.schedule(d2 - 1.1, () => this.active && this.listen(true));
      });
    });
  }

  /** 输入框里发出的一句话：在见面流程里就归它处理（返回 true = 已处理，不送大脑） */
  handleInput(text: string): boolean {
    if (!this.active) return false;
    const d = this.demo;
    if (this.step === 1) {
      this.profile.userName = text.slice(0, 30);
      this.step = 2;
      this.listen(false);
      this.app.moon.flashExpr("happy", 2);
      this.app.moon.playAction("bounce", 0.7, "manual");
      const dur = this.say(this.L.nice(this.profile.userName), 0.8, 0.7);
      d.schedule(dur + 0.4, () => {
        const d2 = this.say(this.L.askMoon, 0.55, 0.5);
        this.input.placeholder = this.L.moonPh;
        this.step = 3;
        d.schedule(d2 - 1.1, () => this.active && this.listen(true));
      });
      return true;
    }
    if (this.step === 3) {
      this.profile.moonName = text.slice(0, 30);
      this.step = 4;
      this.listen(false);
      this.app.moon.flashExpr("laugh", 2.2);
      this.app.moon.playAction("spin", 0.8, "manual");
      const dur = this.say(this.L.love(this.profile.moonName), 0.9, 0.8);
      d.schedule(dur + 0.5, () => this.finish());
      return true;
    }
    return true; // 台词还没说完：先不接话
  }

  finish() {
    if (!this.active) return;
    this.active = false;
    this.profile.onboarded = true;
    saveProfile(this.profile);
    params.post.exposure = this.fadeFrom;
    this.skipBtn?.remove();
    this.skipBtn = null;
    this.listen(true);
    this.life.paused = false;
    const zh = uiLang(this.profile) === "zh";
    this.input.placeholder = zh ? "想和月亮说些什么…" : "Say something to the moon…";
    this.onDone?.();
  }

  update(dt: number) {
    if (!this.active) return;
    this.t += dt;
    // 从深处飘过来（覆盖手势物理）：0 → 3.6 秒，缓出
    if (this.t < 3.6) {
      const u = this.t / 3.6;
      const e = 1 - Math.pow(1 - u, 3);
      this.interact.offset.set(0.6 * (1 - e), 1.2 * (1 - e) + Math.sin(u * Math.PI) * 0.15, -7 * (1 - e));
      this.interact.vel.set(0, 0, 0);
    }
    // 从黑里慢慢亮起来（2.5 秒）
    if (this.t < 2.6) params.post.exposure = Math.max(0.001, this.fadeFrom * Math.min(1, this.t / 2.5) ** 1.6);
  }
}

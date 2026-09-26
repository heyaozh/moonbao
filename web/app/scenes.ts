// 场景预设：?scene=<名字> 直接打开某个画面状态（验收、录 GIF、和概念图并排比较都用它）。
// 对照表见 assets/ui-concept/README.md。对话类场景用演示大脑按剧本跑（App 时钟，__step 可快进）。

import type { ChatView } from "../chat/chatview";
import type { DemoBrain } from "../chat/demo";
import { EXPR_NAMES, type ExprName } from "../moon/expressions";
import type { Behaviors } from "../moon/behaviors";
import { params } from "../moon/params";
import type { Onboarding } from "../ui/onboarding";
import type { App } from "./app";

export interface SceneCtx {
  chat: ChatView;
  demo: DemoBrain;
  life: Behaviors;
  onboarding?: Onboarding;
}

export interface Scene {
  label: string;
  /** 对照的概念图（assets/ui-concept/ 里的文件名） */
  ref?: string;
  /** 这个场景要快进几秒才到「好看的那一刻」（截图 / 对照页用） */
  settle?: number;
  apply(app: App, x: SceneCtx): void;
}

let timers: ReturnType<typeof setInterval>[] = [];

function base(app: App, x: SceneCtx, opts: { keepChat?: boolean } = {}) {
  if (x.onboarding?.active) x.onboarding.finish();
  for (const t of timers) clearInterval(t);
  timers = [];
  app.world.sunAltOverride = -30;
  app.world.hourOverride = null;
  params.light.phaseDeg = -1;
  app.moon.exprOverride = null;
  app.moon.chatMode = false;
  app.stage.cam.autoShake = false;
  if (!opts.keepChat) {
    x.demo.clear();
    x.chat.clear();
    x.chat.thinking.showQuestion(false);
    x.chat.setThinking(false);
  }
  x.life.paused = false;
}

/** 按时间表跑一段剧本：[秒, 做什么] */
function script(x: SceneCtx, steps: [number, () => void][]) {
  for (const [at, fn] of steps) x.demo.schedule(at, fn);
}

export const SCENES: Record<string, Scene> = {
  real: {
    label: "实时",
    apply(app, x) {
      base(app, x);
      app.world.sunAltOverride = null;
    },
  },
  idle: {
    label: "待机",
    ref: "moon-ui-left-v2.jpg",
    apply(app, x) {
      base(app, x);
      params.light.phaseDeg = 0;
      app.moon.exprOverride = "happy";
    },
  },
  night: { label: "夜", apply: (app, x) => base(app, x) },
  dawn: {
    label: "清晨",
    apply(app, x) {
      base(app, x);
      app.world.sunAltOverride = -4;
    },
  },
  day: {
    label: "白天",
    apply(app, x) {
      base(app, x);
      app.world.sunAltOverride = 32;
    },
  },
  dusk: {
    label: "黄昏",
    apply(app, x) {
      base(app, x);
      app.world.sunAltOverride = 1;
    },
  },
  crescent: {
    label: "蛾眉月",
    apply(app, x) {
      base(app, x);
      params.light.phaseDeg = 128;
      params.light.limbDeg = 58;
    },
  },
  faces: {
    label: "表情轮播",
    apply(app, x) {
      base(app, x);
      params.light.phaseDeg = 0;
      x.life.paused = true;
      let i = 0;
      const next = () => {
        app.moon.exprOverride = EXPR_NAMES[i % EXPR_NAMES.length] as ExprName;
        i++;
      };
      next();
      timers.push(setInterval(next, 1400));
    },
  },
  chat: {
    label: "对话",
    ref: "moonbao-dialogue-lensing.jpg",
    settle: 9,
    apply(app, x) {
      base(app, x);
      params.light.phaseDeg = 0;
      x.life.paused = true;
      const u = "I'm a bit nervous because I would like to propose to my boyfriend.";
      script(x, [[0.2, () => {
        x.chat.startExchange(u);
        x.demo.reply(u);
      }]]);
    },
  },
  history: {
    label: "历史",
    ref: "moonbao-depth-03.jpg",
    settle: 19,
    apply(app, x) {
      base(app, x);
      params.light.phaseDeg = 118;
      params.light.limbDeg = 70;
      x.life.paused = true;
      const lines: [string, number][] = [
        ["Long day.", 0.2],
        ["I tried my best, but nothing seemed to go right.", 6.5],
        ["Will you stay with me?", 12.5],
      ];
      script(x, lines.map(([u, at]) => [at, () => {
        x.chat.startExchange(u);
        x.demo.reply(u);
      }]));
    },
  },
  long: {
    label: "长句",
    ref: "moonbao-long-message.jpg",
    settle: 5.5,
    apply(app, x) {
      base(app, x);
      params.light.phaseDeg = 0;
      x.life.paused = true;
      script(x, [[0.2, () => x.demo.say("When the world feels a little too loud, I will gather the quietest stars and write you a gentle reminder that you never have to shine alone tonight, my friend.", 0.6, 0.45, "brighten")]]);
    },
  },
  longzh: {
    label: "中文长句",
    ref: "moonbao-chinese-message.jpg",
    settle: 6,
    apply(app, x) {
      base(app, x);
      params.light.phaseDeg = 0;
      x.life.paused = true;
      script(x, [[0.2, () => x.demo.say("当世界有些喧嚣，我会拾起最安静的星光，为你写下一句温柔的提醒：亲爱的朋友，今夜，你不必独自闪耀。", 0.7, 0.5, "brighten")]]);
    },
  },
  thinking: {
    label: "在想",
    ref: "moonbao-squish-typing-v2.jpg",
    settle: 2.5,
    apply(app, x) {
      base(app, x);
      params.light.phaseDeg = 0;
      x.life.paused = true;
      const u = "I'm a bit sad today.";
      script(x, [[0.2, () => {
        x.chat.startExchange(u);
        x.demo.reply(u, undefined, { holdThinking: true });
        app.moon.flashExpr("squeeze", 60);
      }]]);
    },
  },
  question: {
    label: "问号",
    settle: 2.5,
    apply(app, x) {
      base(app, x);
      params.light.phaseDeg = 0;
      x.life.paused = true;
      const u = "What's the meaning of life?";
      script(x, [[0.2, () => {
        x.chat.startExchange(u);
        x.demo.reply(u, undefined, { holdThinking: true });
        x.chat.thinking.showQuestion(true);
        app.moon.flashExpr("thinking", 60);
      }]]);
    },
  },
  writing: {
    label: "流星写字",
    ref: "moonbao-meteor-lettering.jpg",
    settle: 2.6,
    apply(app, x) {
      base(app, x);
      params.light.phaseDeg = 0;
      x.life.paused = true;
      script(x, [[0.2, () => {
        x.demo.say("moonbao", 0.6, 0.6, "idle_drift");
        app.moon.flashExpr("focused", 60);
      }]]);
    },
  },
  voice: {
    label: "语音黑洞",
    settle: 3,
    apply(app, x) {
      base(app, x);
      params.light.phaseDeg = 0;
      x.life.paused = true;
      script(x, [[0.2, () => {
        x.chat.startVoice();
        app.moon.flashExpr("focused", 60);
      }]]);
      let t = 0;
      timers.push(setInterval(() => {
        t += 0.05;
        x.chat.setVoiceLevel(0.35 + 0.35 * Math.abs(Math.sin(t * 5.3) * Math.sin(t * 1.7)));
      }, 50));
    },
  },
  onboarding: {
    label: "首次见面",
    apply(app, x) {
      base(app, x);
      params.light.phaseDeg = 0;
      x.onboarding?.start();
    },
  },
  demo: {
    label: "演示（循环）",
    apply(app, x) {
      base(app, x);
      x.life.paused = false;
      const convo: [number, string][] = [
        [1.5, "Long day."],
        [8, "I tried my best, but nothing seemed to go right."],
        [15.5, "Will you stay with me?"],
      ];
      const run = () => {
        script(x, convo.map(([at, u]) => [at, () => {
          x.chat.startExchange(u);
          x.demo.reply(u);
        }]));
      };
      run();
    },
  },
};

export function applyScene(app: App, name: string | null, x: SceneCtx): string | null {
  if (!name || !SCENES[name]) return null;
  SCENES[name].apply(app, x);
  return name;
}

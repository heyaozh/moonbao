// 场景预设：?scene=<名字> 直接打开某个画面状态（验收、录 GIF、和概念图并排比较都用它）。
// 对照表见 assets/ui-concept/README.md。对话类场景用演示大脑按剧本跑（App 时钟，__step 可快进）。

import * as THREE from "three";
import type { ChatView } from "../chat/chatview";
import type { DemoBrain } from "../chat/demo";
import { FONT_CANDIDATES, fontState, type FontName } from "../chat/glyphs";
import { EXPR_NAMES, type ExprName } from "../moon/expressions";
import type { Behaviors } from "../moon/behaviors";
import type { MoonInteraction } from "../moon/interact";
import type { MoonPaint } from "../moon/paint";
import { params } from "../moon/params";
import type { Onboarding } from "../ui/onboarding";
import { eggInfo } from "../eggs/catalog";
import type { App } from "./app";

export interface SceneCtx {
  chat: ChatView;
  demo: DemoBrain;
  life: Behaviors;
  onboarding?: Onboarding;
  interact?: MoonInteraction;
  paint?: MoonPaint;
  /** 脚本化地演一条彩蛋（?scene=egg-<名字>，录片用） */
  egg?: (name: string) => boolean;
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
/** 进「字体比较」之前的英文手写体：离开这个场景时还原（面板或 ?font= 选的不会被冲掉） */
let fontBeforeCompare: FontName | null = null;

function base(app: App, x: SceneCtx, opts: { keepChat?: boolean } = {}) {
  if (x.onboarding?.active) x.onboarding.finish();
  if (x.paint?.active) x.paint.exit();
  if (fontBeforeCompare) {
    fontState.en = fontBeforeCompare;
    fontBeforeCompare = null;
  }
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
  x.life.locked = false;
}

/** 按时间表跑一段剧本：[秒, 做什么] */
function script(x: SceneCtx, steps: [number, () => void][]) {
  for (const [at, fn] of steps) x.demo.schedule(at, fn);
}

/** 月亮表面上的一点（dx, dy 以半径为单位，朝你这一面）：剧本里的「手指」 */
function onMoon(app: App, dx: number, dy: number) {
  const c = app.moon.center;
  const r = app.moon.radius;
  return new THREE.Vector3(c.x + dx * r, c.y + dy * r, c.z + r * 0.75);
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
  play: {
    label: "互动（戳 / 甩 / 转晕）",
    settle: 5,
    apply(app, x) {
      base(app, x);
      const it = x.interact;
      if (!it) return;
      // 不用真手指：按 App 时钟排好（录 GIF、快进都确定）
      const at = (dx: number, dy: number) => onMoon(app, dx, dy);
      const d = x.demo;
      d.schedule(1.2, () => it.poke(at(0.42, 0.18)));
      d.schedule(2.4, () => it.poke(at(-0.38, -0.12)));
      d.schedule(3.8, () => it.fling(new THREE.Vector3(3.4, 1.2, -0.4), new THREE.Vector3(0.1, 0.55, 0)));
      d.schedule(7.0, () => it.twirl(1));
      d.schedule(7.5, () => it.twirl(0.8));
      d.schedule(12.6, () => app.moon.flashExpr("laugh", 1.4));
    },
  },
  paint: {
    label: "画月亮",
    apply(app, x) {
      base(app, x);
      params.light.phaseDeg = 0;
      x.paint?.enter();
    },
  },
  fonts: {
    label: "英文字体比较",
    settle: 6,
    apply(app, x) {
      base(app, x);
      params.light.phaseDeg = 0;
      x.life.paused = true;
      // 四个候选轮流写：先用这个字体写它自己的名字（隆重档），再写一句日常的话。定了以后用 ?font= 或面板切默认
      const names = Object.keys(FONT_CANDIDATES) as FontName[];
      fontBeforeCompare = fontState.en;
      let i = 0;
      const show = () => {
        const f = names[i++ % names.length];
        fontState.en = f;
        x.chat.clear();
        app.moon.chatMode = true;
        x.demo.say(f, 0.6, 0.5, "idle_drift");
        x.demo.schedule(2.8, () => x.demo.say("Even quiet stars are still shining. I'll keep a tiny constellation glowing for you.", 0.5, 0.45, "idle_drift"));
        x.demo.schedule(11, show);
      };
      show();
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
      const said = "I couldn't sleep again tonight.";
      script(x, [
        [0.2, () => {
          x.chat.startVoice();
          app.moon.flashExpr("focused", 60);
        }],
        // 说完：识别出的字凝结进黑洞，黑洞缩成刚好装下字的气泡，它回话
        [5.2, () => {
          x.chat.finishVoice(said);
          app.moon.flashExpr("content", 0.4);
          x.demo.reply(said, { text: "Then stay up with me a little. I'll dim the stars so they don't keep you awake.", v: 0.35, a: 0.3, act: "lean_in", i: 0.5, think: 1.1 });
        }],
      ]);
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
    label: "演示（一分钟循环）",
    apply(app, x) {
      base(app, x);
      x.life.paused = false;
      const it = x.interact;
      const exchange = (u: string) => {
        x.chat.startExchange(u);
        x.demo.reply(u);
      };
      // 语音那一段的音量（真实时间驱动，只在黑洞还没识别完时起作用）
      let vt = 0;
      timers.push(setInterval(() => {
        vt += 0.05;
        x.chat.setVoiceLevel(0.35 + 0.35 * Math.abs(Math.sin(vt * 5.3) * Math.sin(vt * 1.7)));
      }, 50));
      const run = () => {
        script(x, [
          // 三轮对话：黑洞气泡 + 光点写字 + 旧的往深处退
          [1.5, () => exchange("Long day.")],
          [8, () => exchange("I tried my best, but nothing seemed to go right.")],
          [15.5, () => exchange("Will you stay with me?")],
          // 它主动开口的短句：远方流星，隆重档（先划过一颗真的流星）
          [23.2, () => app.world.meteors.spawn(app.stage.cam)],
          [24, () => x.demo.say("A shooting star!", 0.8, 0.7, "brighten")],
          // 翻历史：把远处的字拉近，再回到现在
          [30, () => x.chat.scrollBy(1.2)],
          [32.5, () => x.chat.scrollBy(1.2)],
          [35.5, () => x.chat.scrollBy(-2.4)],
          // 语音：黑洞从小长大 → 字凝结进来 → 它回话
          [38, () => {
            x.chat.startVoice();
            app.moon.flashExpr("focused", 4.4);
          }],
          [42.5, () => {
            const said = "Good night, little moon.";
            x.chat.finishVoice(said);
            x.demo.reply(said);
          }],
          // 月亮回家，历史退远；戳一下、甩一下
          [50, () => {
            app.moon.chatMode = false;
            x.chat.scrollTarget = -1.2;
          }],
          [52.5, () => it?.poke(onMoon(app, 0.4, 0.15))],
          [54.5, () => it?.fling(new THREE.Vector3(-3.0, 1.1, -0.3), new THREE.Vector3(-0.1, 0.55, 0))],
          // 清场，从头再来
          [60, () => {
            x.chat.clear();
            app.moon.chatMode = false;
            run();
          }],
        ]);
      };
      run();
    },
  },
};

export function applyScene(app: App, name: string | null, x: SceneCtx): string | null {
  if (!name) return null;
  // 彩蛋场景：满月、夜里、小日子锁住（除非这条彩蛋本身是小日子），0.8 秒后开演（App 时钟，录片可复现）
  if (name.startsWith("egg-")) {
    const egg = name.slice(4);
    const info = eggInfo(egg);
    if (!info || !x.egg) return null;
    base(app, x);
    params.light.phaseDeg = 0;
    x.life.locked = !info.life;
    x.demo.schedule(0.8, () => x.egg!(egg));
    return name;
  }
  if (!SCENES[name]) return null;
  SCENES[name].apply(app, x);
  return name;
}

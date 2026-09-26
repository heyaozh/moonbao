// 场景预设：?scene=<名字> 直接打开某个画面状态（验收、录 GIF、和概念图并排比较都用它）。
// 每个功能落地时在这里加对应场景；README 见 assets/ui-concept/README.md 的对照表。

import { EXPR_NAMES, type ExprName } from "../moon/expressions";
import { params } from "../moon/params";
import type { App } from "./app";

export interface Scene {
  label: string;
  /** 对照的概念图（assets/ui-concept/ 里的文件名） */
  ref?: string;
  apply(app: App): void;
}

function base(app: App) {
  app.world.sunAltOverride = -30;
  app.world.hourOverride = null;
  params.light.phaseDeg = -1;
  app.moon.exprOverride = null;
  app.moon.chatMode = false;
  app.stage.cam.autoShake = false;
}

export const SCENES: Record<string, Scene> = {
  idle: {
    label: "待机（夜）",
    ref: "moon-ui-left-v2.jpg",
    apply(app) {
      base(app);
      params.light.phaseDeg = 0;
      app.moon.exprOverride = "happy";
    },
  },
  night: {
    label: "夜",
    apply(app) {
      base(app);
    },
  },
  dawn: {
    label: "清晨",
    apply(app) {
      base(app);
      app.world.sunAltOverride = -4;
    },
  },
  day: {
    label: "白天",
    apply(app) {
      base(app);
      app.world.sunAltOverride = 32;
    },
  },
  dusk: {
    label: "黄昏",
    apply(app) {
      base(app);
      app.world.sunAltOverride = 1;
    },
  },
  real: {
    label: "实时",
    apply(app) {
      base(app);
      app.world.sunAltOverride = null;
    },
  },
  crescent: {
    label: "蛾眉月",
    ref: "moonbao-depth-03.jpg",
    apply(app) {
      base(app);
      params.light.phaseDeg = 128;
      params.light.limbDeg = 58;
    },
  },
  faces: {
    label: "表情轮播",
    apply(app) {
      base(app);
      params.light.phaseDeg = 0;
      let i = 0;
      const next = () => {
        app.moon.exprOverride = EXPR_NAMES[i % EXPR_NAMES.length] as ExprName;
        i++;
      };
      next();
      clearInterval((window as any).__faceTimer);
      (window as any).__faceTimer = setInterval(next, 1400);
    },
  },
};

export function applyScene(app: App, name: string | null): string | null {
  if (!name || !SCENES[name]) return null;
  clearInterval((window as any).__faceTimer);
  SCENES[name].apply(app);
  return name;
}

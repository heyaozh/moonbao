// 形象对比（2026-09-30 用户：「尝试几种不同的月亮效果，以及面部眼睛和嘴巴的组合让我对比看看哪个形象更好」）。
// 每个形象 = 一组参数覆盖。网址 ?look=baby，或 ?look=baby,mochi（脸 + 月面，按顺序叠加）；面板「形象」里可以现切。
// 选定以后把那组数值写进 params.ts（或面板「存为默认」），这个文件只是对比用的样板间。

import { deepMerge } from "./merge";
import { params } from "./params";

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface Look {
  label: string;
  /** 设计思路（一句话） */
  note: string;
  kind: "face" | "body";
  params: DeepPartial<typeof params>;
}

export const LOOKS: Record<string, Look> = {
  // ───────── 五官 ─────────
  current: {
    label: "默认",
    kind: "face",
    note: "2026-09-30 定的默认：婴儿比例的五官 + 介于原样与奶黄之间的月面 + 一点点灯笼的光",
    params: {},
  },
  classic: {
    label: "旧默认",
    kind: "face",
    note: "2026-09-30 之前的默认：参考图比例的五官、NASA 柔和月面 + 较清楚的小坑",
    params: {
      face: { eyeY: 0, eyeSpacing: 0.66, eyeW: 0.068, eyeH: 0.078, highlightSize: 0.26, mouthBelow: 0.17, mouthWidth: 0.145, smileDepth: 0.05, blushX: 0.44, blushBelow: 0.12, blushRadius: 0.13 },
      moon: { litColor: "#ffd2a0", textureContrast: 1.15, craterDetail: 0.7, bumpStrength: 0.5, selfGlow: 0.035, volume: 0.5, limbDarkening: 0.28, rim: 0.38, brightness: 0.78 },
      light: { haloColor: "#ffe9c8", haloScale: 2.3, haloOpacity: 0.5 },
    },
  },
  baby: {
    label: "婴儿比例",
    kind: "face",
    note: "五官整体往下、眼距更开、眼睛大一点、嘴贴近眼睛——额头大，显小、更可爱（婴儿图式）",
    params: {
      face: { eyeY: -0.1, eyeSpacing: 0.74, eyeW: 0.076, eyeH: 0.088, highlightSize: 0.3, mouthBelow: 0.12, mouthWidth: 0.11, smileDepth: 0.045, blushX: 0.47, blushBelow: 0.09, blushRadius: 0.15 },
    },
  },
  bean: {
    label: "小豆豆眼",
    kind: "face",
    note: "很小的实心豆眼、没有高光，眼距近，嘴和腮红都更小更淡——极简、安静、憨",
    params: {
      face: { eyeSpacing: 0.5, eyeY: 0.02, eyeW: 0.04, eyeH: 0.056, highlight: 0, mouthBelow: 0.13, mouthWidth: 0.09, mouthThickness: 0.018, smileDepth: 0.034, blushX: 0.34, blushBelow: 0.1, blushRadius: 0.1, blushBase: 0.45 },
    },
  },
  sparkle: {
    label: "星星眼",
    kind: "face",
    note: "大眼 + 两个高光（闪亮），嘴很小——更像动画角色，情绪更外放",
    params: {
      face: { eyeSpacing: 0.72, eyeY: -0.02, eyeW: 0.09, eyeH: 0.104, highlightX: -0.28, highlightY: 0.34, highlightSize: 0.36, highlight: 1, highlight2: 0.95, highlight2Size: 0.16, mouthBelow: 0.17, mouthWidth: 0.1, blushX: 0.5, blushBelow: 0.13, blushRadius: 0.14 },
    },
  },
  cat: {
    label: "猫嘴 ω",
    kind: "face",
    note: "豆眼 + ω 嘴 + 横向的椭圆腮红——调皮一点",
    params: {
      face: { catMouth: 1, mouthWidth: 0.12, mouthBelow: 0.14, smileDepth: 0.04, blushAspect: 1.6, blushRadius: 0.09, blushBelow: 0.1, blushX: 0.46 },
    },
  },
  soft: {
    label: "温柔扁眼",
    kind: "face",
    note: "横向的扁椭圆眼、淡高光、浅浅的笑——安静温柔，像一直眯着眼陪你",
    params: {
      face: { eyeW: 0.08, eyeH: 0.05, highlightSize: 0.22, highlight: 0.55, highlightY: 0.25, eyeSpacing: 0.62, eyeY: -0.02, mouthBelow: 0.14, mouthWidth: 0.13, smileDepth: 0.035, blushRadius: 0.14, blushBelow: 0.1, blushAspect: 1.25 },
    },
  },

  bare: {
    label: "不画脸",
    kind: "face",
    note: "光月亮（给 AI 出图当底图）",
    params: { face: { visible: 0 } },
  },

  // ───────── 月面 ─────────
  mochi: {
    label: "奶黄软糯",
    kind: "body",
    note: "纹理和坑淡下去、偏奶黄、多一点自发光和体积光——像软软的糯米团，少一点「真月亮」",
    params: {
      moon: { litColor: "#ffdcaa", textureContrast: 0.5, craterDetail: 0.15, bumpStrength: 0.15, selfGlow: 0.1, volume: 0.65, limbDarkening: 0.15, rim: 0.45 },
      light: { haloColor: "#ffe4b8" },
    },
  },
  silver: {
    label: "银白写实",
    kind: "body",
    note: "偏冷的银白、纹理和坑更清楚——更像真的月亮，可爱全靠脸",
    params: {
      moon: { litColor: "#f3ece2", textureContrast: 1.45, craterDetail: 1, bumpStrength: 0.8, sss: 0.2, rimColor: "#f0f2ff" },
      light: { haloColor: "#eef1ff", haloOpacity: 0.4 },
    },
  },
  lantern: {
    label: "发光灯笼",
    kind: "body",
    note: "自己在发光：亮面更亮、光晕更大更暖、纹理淡一点——像一盏小夜灯",
    params: {
      moon: { brightness: 0.98, selfGlow: 0.2, textureContrast: 0.75, craterDetail: 0.35, rim: 0.6 },
      light: { haloScale: 2.9, haloOpacity: 0.8 },
    },
  },
};

// 打开页面时的原始数值（含 params.overrides.json）：切换形象前先把被形象改过的键还原，再叠新的
const pristine = structuredClone(params) as unknown as Record<string, unknown>;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function restore(target: Obj, src: Obj, shape: Obj) {
  for (const k of Object.keys(shape)) {
    if (isObj(shape[k]) && isObj(target[k]) && isObj(src[k])) restore(target[k] as Obj, src[k] as Obj, shape[k] as Obj);
    else if (k in src) target[k] = structuredClone(src[k]);
  }
}

/** 应用一个或几个形象（按顺序叠加）；空数组 = 回到原样 */
export function applyLooks(names: string[]) {
  for (const L of Object.values(LOOKS)) restore(params as unknown as Obj, pristine, L.params as Obj);
  for (const n of names) {
    const L = LOOKS[n.trim()];
    if (L) deepMerge(params, L.params);
  }
}

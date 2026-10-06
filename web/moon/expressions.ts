// 表情库：每个表情 = 一组连续的脸部参数（眼形、眼睑、瞳孔大小、嘴的弧度与张开、腮红），弹簧过渡。
// 脸画在月亮的着色器里（moon.ts），这里只管「现在该是什么表情」和平滑地变过去。
// 概念图参考：^ ^ 开心（moon-ui-left-v2）、抬头对星星笑（chinese-message）、o 嘴专注地指挥流星（meteor-lettering）、>.< 被戳（squish-typing-v2）。

import { Spring } from "./math";
import { params } from "./params";

export interface FaceParams {
  /** 两只眼的睁开程度 0..1（0 = 闭成一条线） */
  openL: number;
  openR: number;
  /** ^ ^ 笑眼 0..1 */
  happy: number;
  /** > < 挤眼 0..1 */
  squeeze: number;
  /** @ @ 晕 0..1 */
  dizzy: number;
  /** ‿ ‿ 安详地闭着（睡着、享受）0..1 */
  closed: number;
  /** 眼睛大小倍数（惊讶大、呆小） */
  eyeScale: number;
  /** 八字眉那种下垂的难过眼 0..1 */
  sad: number;
  /** ♥ 爱心眼 0..1（只有秘密彩蛋会用，见 PLAN V9-E） */
  heart: number;
  /** ✦ 星星眼 0..1（V9-C） */
  star: number;
  /** 一滴汗 0..1（听岔了 / 不懂） */
  sweat: number;
  /** 闭着嘴吐舌头 0..1 */
  tongue: number;
  /** 高光大小倍数（瞳孔放大时亮一点） */
  shine: number;
  /** 视线（-1..1） */
  gazeX: number;
  gazeY: number;
  /** 嘴：弧度（-1 撇嘴 … 1 微笑）、张开 0..1、宽度倍数、o 型 0..1、波浪（委屈 / 晕）0..1 */
  curve: number;
  open: number;
  width: number;
  round: number;
  wave: number;
  /** 腮红额外加深 0..1 */
  blush: number;
  /** 星星眼：第二个高光 0..1（2026-09-30 用户：星星眼、猫嘴都要做一个表情） */
  sparkle: number;
  /** 猫嘴 ω 0..1 */
  cat: number;
  /** 害羞的斜线腮红 /// 0..1（AI 出图九宫格第 7 格） */
  hatch: number;
}

export const NEUTRAL: FaceParams = {
  openL: 1, openR: 1, happy: 0, squeeze: 0, dizzy: 0, closed: 0, eyeScale: 1, sad: 0, heart: 0, star: 0, sweat: 0, tongue: 0, shine: 1, gazeX: 0, gazeY: 0,
  curve: 0.65, open: 0, width: 1, round: 0, wave: 0, blush: 0, sparkle: 0, cat: 0, hatch: 0,
};

export const EXPRESSIONS = {
  neutral: {},
  smile: { curve: 1 },
  happy: { happy: 1, curve: 1, open: 0.36, width: 1.0, blush: 0.35 },
  laugh: { happy: 1, curve: 1, open: 0.95, width: 1.2, blush: 0.55 },
  shy: { happy: 0.55, gazeX: 0.55, gazeY: -0.5, curve: 0.55, width: 0.75, wave: 0.25, blush: 1 },
  surprised: { eyeScale: 1.28, round: 1, open: 0.55, width: 0.9 },
  focused: { eyeScale: 0.92, round: 1, open: 0.2, width: 0.75 },
  thinking: { gazeX: 0.7, gazeY: 0.75, curve: 0.1, wave: 0.55, width: 0.8 },
  sleepy: { openL: 0.28, openR: 0.28, eyeScale: 0.95, round: 0.85, open: 0.25, width: 0.7 },
  sleeping: { closed: 1, curve: 0.3, round: 0.7, open: 0.12, width: 0.55 },
  sad: { sad: 1, openL: 0.85, openR: 0.85, gazeY: -0.55, curve: -0.65, width: 0.85 },
  pout: { sad: 0.45, eyeScale: 1.12, curve: -0.25, wave: 1, width: 0.8, blush: 0.5 },
  dizzy: { dizzy: 1, wave: 0.85, open: 0.25, width: 0.9 },
  squeeze: { squeeze: 1, round: 1, open: 0.15, width: 0.35, blush: 0.65 },
  content: { happy: 1, curve: 0.85, width: 0.9, blush: 0.45 },
  wink: { openR: 0, curve: 1, open: 0.25, blush: 0.3 },
  winkL: { openL: 0, curve: 1, open: 0.25, blush: 0.3 },
  // 2026-09-30：来自形象对比与 AI 出图九宫格（assets/ui-concept/moonbao-faces.jpg）
  starry: { eyeScale: 1.22, sparkle: 1, curve: 1, open: 0.22, width: 0.8, blush: 0.45 },
  cheeky: { cat: 1, curve: 1, blush: 0.55, gazeX: 0.15 },
  giggle: { hatch: 1, curve: 1, open: 0.45, width: 0.95, blush: 0.6 },
  curious: { eyeScale: 1.1, round: 1, open: 0.35, width: 0.62, gazeY: 0.25 },
  calm: { openL: 0.6, openR: 0.6, curve: 0.8, width: 0.9, blush: 0.2 },
  blank: { eyeScale: 0.62, curve: 0.45, width: 0.7 },
  /** 爱心眼：秘密彩蛋专用——它在替你传话，不是它自己爱上用户（不进 exprForEmotion、不给 LLM 选） */
  heart: { heart: 1, curve: 1, open: 0.3, width: 1.05, eyeScale: 1.12, blush: 1 },
  // ── V9-C ──
  /** 一滴汗：听岔了 / 不懂，视线飘开、波浪嘴 */
  sweat: { sweat: 1, curve: 0.15, wave: 0.6, gazeX: 0.3, width: 0.85 },
  /** 吹口哨：o 嘴、视线飘开（偷懒被抓到装没事） */
  whistle: { round: 1, open: 0.35, width: 0.6, gazeX: 0.6, gazeY: 0.45, openL: 0.9, openR: 0.9 },
  /** :P 吐舌头 */
  tongue: { tongue: 1, curve: 0.9, happy: 0.7, blush: 0.4 },
  /** 瞳孔放大：看到流星那一瞬 */
  dilate: { eyeScale: 1.24, shine: 1.5, curve: 0.8, open: 0.15 },
  /** 耸肩：闭眼 ‿ ‿ + 波浪嘴 */
  shrug: { closed: 1, wave: 1, curve: 0.2, width: 0.8 },
  /** 打喷嚏前：眼睛慢慢眯上、嘴张开「啊……啊……」 */
  presneeze: { openL: 0.4, openR: 0.4, open: 0.55, round: 0.6, width: 0.9 },
  /** 打哈欠 / 伸懒腰 */
  yawn: { closed: 1, open: 0.75, round: 0.9, width: 0.8 },
  /** 认真看你写的字：微微眯眼 */
  reading: { openL: 0.78, openR: 0.78, eyeScale: 0.96, curve: 0.5, width: 0.9 },
} satisfies Record<string, Partial<FaceParams>>;

export type ExprName = keyof typeof EXPRESSIONS;
export const EXPR_NAMES = Object.keys(EXPRESSIONS) as ExprName[];

export const EXPR_LABELS: Record<ExprName, string> = {
  neutral: "平常", smile: "微笑", happy: "开心", laugh: "大笑", shy: "害羞", surprised: "惊讶", focused: "专注", thinking: "思考",
  sleepy: "困", sleeping: "睡着", sad: "难过", pout: "委屈", dizzy: "晕", squeeze: ">.<", content: "满足", wink: "眨眼", winkL: "眨左眼", heart: "爱心眼",
  starry: "星星眼", cheeky: "猫嘴", giggle: "嘿嘿", curious: "好奇", calm: "安心", blank: "发呆",
  sweat: "一滴汗", whistle: "吹口哨", tongue: "吐舌头", dilate: "瞳孔放大", shrug: "耸肩", presneeze: "要打喷嚏", yawn: "哈欠", reading: "看字",
};

export function exprParams(name: ExprName): FaceParams {
  return { ...NEUTRAL, ...EXPRESSIONS[name] };
}

/** 情绪（valence / arousal）→ 默认表情：没有动作或剧本强制时用它。 */
export function exprForEmotion(valence: number, arousal: number): ExprName {
  if (arousal < 0.14) return "sleepy";
  if (valence > 0.6 && arousal > 0.6) return "happy";
  if (valence > 0.55) return "content";
  if (valence > 0.22) return "smile";
  if (valence < -0.45) return "sad";
  if (valence < -0.2) return "pout";
  return "neutral";
}

const KEYS = Object.keys(NEUTRAL) as (keyof FaceParams)[];

/** 当前的脸：每个参数一根弹簧，追目标表情。 */
export class FaceState {
  readonly cur: FaceParams = { ...NEUTRAL };
  private springs = new Map<keyof FaceParams, Spring>();
  private target: FaceParams = { ...NEUTRAL };

  constructor() {
    for (const k of KEYS) this.springs.set(k, new Spring(NEUTRAL[k], params.face.morphOmega, params.face.morphZeta));
  }

  setTarget(p: FaceParams) {
    this.target = p;
  }

  /** 直接跳到（录制、切场景时用）。 */
  snap(p: FaceParams) {
    this.target = p;
    for (const k of KEYS) this.springs.get(k)!.set(p[k]);
  }

  update(dt: number) {
    for (const k of KEYS) {
      const s = this.springs.get(k)!;
      s.omega = params.face.morphOmega;
      s.zeta = params.face.morphZeta;
      s.target = this.target[k];
      this.cur[k] = s.step(dt);
    }
    return this.cur;
  }
}

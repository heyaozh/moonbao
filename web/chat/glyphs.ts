// 字形：月亮的手写字排版、画成发光的字贴图、在笔画上采样光点的落点。
// 英文用手写体（候选见 FONT_CANDIDATES，面板 / ?font= 可切），中文用霞鹜文楷屏幕版。
// 一行一张画布：英文按整词画（保住连笔），中文逐字画、每个字轻微错位旋转（「不是很整齐地漂浮」）。

export const FONT_CANDIDATES = {
  "Dancing Script": '"Dancing Script"',
  Sacramento: "Sacramento",
  Caveat: "Caveat",
  "Ms Madi": '"Ms Madi"',
} as const;
export type FontName = keyof typeof FONT_CANDIDATES;

export const ZH_FONT = '"LXGW WenKai Screen"';
/** 用户气泡里的字：圆润的无衬线（苹果设备上是 SF Pro Rounded） */
export const UI_FONT = 'ui-rounded, "SF Pro Rounded", -apple-system, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", system-ui, sans-serif';

export const fontState = { en: "Dancing Script" as FontName };

const CJK = /[⺀-鿿　-〿＀-￯豈-﫿]/;
export const isCJK = (ch: string) => CJK.test(ch);

/** 行首不许出现的标点 */
// 不能出现在行首的标点：只看这个词的第一个字（英文词自带句末标点，「tonight.」照样可以换行）
const NO_START = /^[，。！？、；：”’）》」』…,.!?;:)\]]/;
/** 句末的词可以稍微超出一点宽度（免得最后一个词孤零零掉到下一行） */
const END_TOL = 1.08;
const ENDS_SENTENCE = /[.!?…。！？~～]["'”’)）]*\s*$/;

export interface CharBox {
  ch: string;
  /** 在行画布上的横向范围（画布像素） */
  x0: number;
  x1: number;
}

export interface LineLayout {
  text: string;
  chars: CharBox[];
  width: number;
  /** 行首缩进（画布像素，制造「不整齐」） */
  indent: number;
  /** 行的小倾斜（弧度）与上下错位（画布像素） */
  tilt: number;
  dy: number;
}

export interface TextStyle {
  /** 字号（画布像素） */
  en: number;
  zh: number;
  /** 行高倍数 */
  lineHeight: number;
  /** 一行最宽（画布像素） */
  maxWidth: number;
}

function fontFor(ch: string, s: TextStyle) {
  return isCJK(ch) ? `400 ${s.zh}px ${ZH_FONT}` : `400 ${s.en}px ${FONT_CANDIDATES[fontState.en]}`;
}

const measureCtx = document.createElement("canvas").getContext("2d")!;

/** 按字体把文字切成「同一种字体」的片段 */
function runs(text: string) {
  const out: { text: string; cjk: boolean }[] = [];
  for (const ch of text) {
    const c = isCJK(ch);
    const last = out[out.length - 1];
    if (last && last.cjk === c) last.text += ch;
    else out.push({ text: ch, cjk: c });
  }
  return out;
}

function measure(text: string, s: TextStyle) {
  let w = 0;
  for (const r of runs(text)) {
    measureCtx.font = fontFor(r.text[0], s);
    w += measureCtx.measureText(r.text).width;
  }
  return w;
}

/** 确保字体（以及这些字所在的分包）已经加载。 */
export async function ensureFonts(text: string, s: TextStyle) {
  const jobs: Promise<unknown>[] = [];
  const zh = [...text].filter(isCJK).join("");
  const en = [...text].filter((c) => !isCJK(c)).join("");
  if (zh) jobs.push(document.fonts.load(`${s.zh}px ${ZH_FONT}`, zh));
  if (en) jobs.push(document.fonts.load(`${s.en}px ${FONT_CANDIDATES[fontState.en]}`, en));
  await Promise.all(jobs).catch(() => undefined);
}

/** 可以放心排版的前缀：英文最后一个不完整的词先不排（否则它到下一行时前面的字会挪位置）。 */
export function stablePrefix(text: string, done: boolean) {
  if (done) return text;
  const m = text.match(/^[\s\S]*[\s,.!?;:，。！？、；：…⺀-鿿]/);
  return m ? m[0] : "";
}

/** 贪心断行（英文按词，中文按字，行首避开标点）。seed 决定每行的不整齐程度，保证同一段话每次排出来一样。 */
export function layoutLines(text: string, s: TextStyle, seed: number): LineLayout[] {
  const tokens: string[] = [];
  let buf = "";
  for (const ch of text) {
    if (ch === "\n") {
      if (buf) tokens.push(buf);
      tokens.push("\n");
      buf = "";
    } else if (isCJK(ch)) {
      if (buf) tokens.push(buf);
      tokens.push(ch);
      buf = "";
    } else if (ch === " ") {
      buf += ch;
      tokens.push(buf);
      buf = "";
    } else buf += ch;
  }
  if (buf) tokens.push(buf);

  const lines: string[] = [];
  let cur = "";
  for (const tk of tokens) {
    if (tk === "\n") {
      lines.push(cur);
      cur = "";
      continue;
    }
    const next = cur + tk;
    const limit = ENDS_SENTENCE.test(tk) ? s.maxWidth * END_TOL : s.maxWidth;
    if (cur && measure(next.trimEnd(), s) > limit && !NO_START.test(tk)) {
      lines.push(cur);
      cur = tk.trimStart();
    } else cur = next;
  }
  if (cur) lines.push(cur);

  const rnd = mulberry(seed);
  return lines.map((ln) => {
    const t = ln.trimEnd();
    const chars: CharBox[] = [];
    let x = 0;
    for (const r of runs(t)) {
      measureCtx.font = fontFor(r.text[0], s);
      let acc = "";
      for (const ch of r.text) {
        const x0 = x + measureCtx.measureText(acc).width;
        acc += ch;
        const x1 = x + measureCtx.measureText(acc).width;
        chars.push({ ch, x0, x1 });
      }
      x += measureCtx.measureText(r.text).width;
    }
    return { text: t, chars, width: x, indent: rnd() * s.en * 1.4, tilt: (rnd() - 0.5) * 0.035, dy: (rnd() - 0.5) * s.en * 0.18 };
  });
}

export interface RenderedLine {
  canvas: HTMLCanvasElement;
  /** 只有字芯（不带发光），用来采样光点落点 */
  ink: ImageData;
  padX: number;
  padY: number;
  baseline: number;
}

/** 把一行画成白色发光字（着色器再上色）。CJK 逐字错位旋转，英文整段画。 */
export function renderLine(line: LineLayout, s: TextStyle, seed: number, glowPx: number): RenderedLine {
  const padX = Math.ceil(glowPx * 2 + s.en * 0.3);
  const padY = Math.ceil(glowPx * 2 + s.en * 0.35);
  const h = Math.ceil(Math.max(s.en, s.zh) * 1.45) + padY * 2;
  const w = Math.ceil(line.width + padX * 2 + s.en * 0.6);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d")!;
  const baseline = padY + Math.max(s.en, s.zh) * 1.05;
  // 同一个种子画两遍（字芯 / 发光），位置完全重合
  const draw = (ctx: CanvasRenderingContext2D, rnd: () => number) => {
    let i = 0;
    for (const r of runs(line.text)) {
      ctx.font = fontFor(r.text[0], s);
      if (r.cjk) {
        for (const ch of r.text) {
          const c = line.chars[i++];
          const jy = (rnd() - 0.5) * s.zh * 0.09;
          const rot = (rnd() - 0.5) * 0.07;
          ctx.save();
          ctx.translate(padX + (c.x0 + c.x1) / 2, baseline + jy);
          ctx.rotate(rot);
          ctx.fillText(ch, -(c.x1 - c.x0) / 2, 0);
          ctx.restore();
        }
      } else {
        const c0 = line.chars[i];
        ctx.fillText(r.text, padX + c0.x0, baseline);
        i += [...r.text].length;
      }
    }
  };
  // 字芯
  g.fillStyle = "#fff";
  draw(g, mulberry(seed));
  const ink = g.getImageData(0, 0, w, h);
  // 发光：再画一层带模糊阴影的，垫在字芯下面（着色器用 alpha 区分芯与光）
  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  const t = tmp.getContext("2d")!;
  t.shadowColor = "rgba(255,255,255,0.9)";
  t.shadowBlur = glowPx;
  t.fillStyle = "rgba(255,255,255,0.55)";
  draw(t, mulberry(seed));
  g.globalCompositeOperation = "destination-over";
  g.drawImage(tmp, 0, 0);
  g.globalCompositeOperation = "source-over";
  return { canvas, ink, padX, padY, baseline };
}

/**
 * 在字芯上采样光点落点：每个字 n 个点，按「书写顺序」排（英文从左到右，中文左上到右下）。
 * 返回画布像素坐标（相对画布左上角）与所属字的下标。
 */
export function sampleInk(r: RenderedLine, line: LineLayout, perCharBase: number): { x: number; y: number; ci: number; order: number }[] {
  const { ink, padX } = r;
  const W = ink.width;
  const H = ink.height;
  const d = ink.data;
  const out: { x: number; y: number; ci: number; order: number }[] = [];
  const step = 2;
  line.chars.forEach((c, ci) => {
    if (/\s/.test(c.ch)) return;
    const pts: { x: number; y: number }[] = [];
    const xa = Math.max(0, Math.floor(padX + c.x0 - 4));
    const xb = Math.min(W - 1, Math.ceil(padX + c.x1 + 4));
    for (let y = 0; y < H; y += step)
      for (let x = xa; x <= xb; x += step) {
        if (d[(y * W + x) * 4 + 3] > 140) pts.push({ x, y });
      }
    if (!pts.length) return;
    // 字越复杂点越多（按墨量），但有上下限
    const n = Math.max(8, Math.min(perCharBase * 2, Math.round(Math.sqrt(pts.length) * perCharBase * 0.16)));
    // 随机挑 n 个，再按书写顺序排
    for (let i = pts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pts[i], pts[j]] = [pts[j], pts[i]];
    }
    const pick = pts.slice(0, n);
    const cjk = isCJK(c.ch);
    const w = Math.max(1, c.x1 - c.x0);
    for (const p of pick) {
      const u = (p.x - padX - c.x0) / w;
      const v = p.y / H;
      out.push({ x: p.x, y: p.y, ci, order: cjk ? u * 0.55 + v * 0.45 : u * 0.9 + v * 0.1 });
    }
  });
  return out;
}

export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 用户的话：系统无衬线字体，冰蓝色，气泡里的多行排版。 */
export function layoutUser(text: string, px: number, maxWidth: number): { lines: string[]; width: number; height: number; lineH: number } {
  measureCtx.font = `400 ${px}px ${UI_FONT}`;
  const tokens = text.match(/[⺀-鿿　-〿＀-￯]|\S+\s*|\s+/g) ?? [text];
  const wrap = (mw: number) => {
    const out: string[] = [];
    let cur = "";
    for (const tk of tokens) {
      const next = cur + tk;
      const limit = ENDS_SENTENCE.test(tk) ? mw * END_TOL : mw;
      if (cur && measureCtx.measureText(next.trimEnd()).width > limit && !NO_START.test(tk)) {
        out.push(cur.trimEnd());
        cur = tk.trimStart();
      } else cur = next;
    }
    if (cur.trim()) out.push(cur.trimEnd());
    return out;
  };
  // 平衡换行（像 CSS text-wrap: balance）：行数不变的前提下尽量窄，
  // 「Will you stay with / me?」→「Will you stay / with me?」
  let lines = wrap(maxWidth);
  if (lines.length >= 2) {
    let lo = px * 2;
    let hi = maxWidth;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (wrap(mid).length > lines.length) lo = mid;
      else hi = mid;
    }
    lines = wrap(hi);
  }
  const width = Math.max(...lines.map((l) => measureCtx.measureText(l).width), px);
  const lineH = px * 1.32;
  return { lines, width, height: lines.length * lineH, lineH };
}

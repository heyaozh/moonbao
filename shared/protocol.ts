// 角色运行时协议：大脑层 ↔ 运行时 ↔ 渲染层 三方共用的类型。
// 服务端与前端都从这里 import，保证线上的事件与渲染适配器永远说同一种语言。
//
//   大脑层（LLM） → 运行时：  PetHeader { valence, arousal, action, intensity, glow }
//   运行时 → 渲染层：        CharacterRenderer 接口（web/runtime/renderer.ts）
//   服务端 → 前端（WS）：    ServerEvent
//   前端 → 服务端（WS）：    ClientMessage
//
// 设计原则：渲染层可替换——月亮渲染器、DOM 占位、纯文本 stub 都只消费这份协议。

/** 动作原语（LLM 从这个枚举里选；非法值回退 idle_drift）
 *  月亮没有四肢、不形变（只有轻微 squash & stretch），所以动作全是「位移 / 翻滚 / 光」三类。 */
export const ACTIONS = [
  "idle_drift", // 什么都不做，继续缓慢漂浮（最常用）
  "lean_in", // 飘近一点：对方开始说事、在认真听
  "think_tilt", // 想想：歪一歪 + 视线飘走
  "bounce", // 弹一下（压扁再弹回）：小开心
  "roll", // 慢慢转过去再转回来（眼睛短暂到背面）：害羞
  "spin", // 快速转一圈：得意、撒欢（大动作，稀有）
  "hide_edge", // 躲到屏幕边缘/外面探半个身子：委屈、试探、被吓到后偷偷看
  "nod", // 上下点一点：打招呼、嗯嗯
  "dim", // 光变暗、往下沉一点：难过、累、阴天
  "brighten", // 光一亮、往上浮一点：被夸、提到喜欢的事、久别重逢
  "shiver", // 发抖：冷、害怕
  "drift_away", // 慢慢飘远一点：需要一点空间（很少用）
] as const;
export type Action = (typeof ACTIONS)[number];

export function isAction(x: unknown): x is Action {
  return typeof x === "string" && (ACTIONS as readonly string[]).includes(x);
}

/** LLM 每轮回复首行输出的结构化头（emotion 在最前：流式首 chunk 即可驱动表情） */
export interface PetHeader {
  valence: number; // -1..1 低落↔开心
  arousal: number; // 0..1 困倦↔兴奋
  action: Action;
  intensity: number; // 0..1
  /** 光的提示（soft / warm / flicker …），预留给渲染层，可缺省 */
  glow?: string;
}

export const DEFAULT_HEADER: PetHeader = {
  valence: 0.2,
  arousal: 0.5,
  action: "idle_drift",
  intensity: 0.5,
};

export type EngineState = "idle" | "listening" | "thinking" | "speaking";

/** 服务端 → 前端 */
export type ServerEvent =
  | { type: "state"; value: EngineState }
  | { type: "transcript"; role: "user" | "pet"; text: string; confidence?: number }
  /** 大脑层给出的情绪目标（渲染层自行做惯性） */
  | { type: "emotion"; valence: number; arousal: number }
  | { type: "action"; name: Action; intensity: number }
  /** 本轮回复是它主动开口（follow-up / 久别归来），不是在回答用户 */
  | { type: "proactive"; reason: "follow_up" | "return" }
  | { type: "reply_delta"; text: string }
  | { type: "reply_done"; text: string }
  // 每个音频块是一段完整可播的 mp3（按句切分）；seq 用于丢弃打断后过期的音频
  | { type: "audio"; seq: number; gen: number; mp3Base64: string }
  | { type: "audio_done"; gen: number }
  | { type: "hello_ack"; absentDays: number; voice: boolean }
  | { type: "error"; message: string };

/** 前端 → 服务端 */
export type ClientMessage =
  /** 页面打开/回到前台：触发主动开口的判定。force=开发期强制重判 */
  | { type: "hello"; force?: boolean }
  | { type: "text"; text: string }
  | { type: "utterance"; wavBase64: string }
  | { type: "interrupt" }
  | { type: "reset" };

// ---------- 头解析（流式，支持多拍） ----------

/**
 * 从 LLM 的流式输出里剥出结构化头，其余作为正文文本吐出。
 * 头 = 单独占一行、以 { 开头 } 结尾的 JSON。第一行通常是头；模型也可以在回复中间再起一拍
 * （空行 + 新的头 + 新的话），每一拍都会触发 onHeader——情绪/动作随文字推进。
 * 容错：没有头（模型忘了）→ 全部当正文；头写坏 → 丢弃该行、正文照常。
 */
export class HeaderScanner {
  private buf = "";
  private atLineStart = true;
  /** 第一拍的头（缺失则 null） */
  header: PetHeader | null = null;
  /** 全部拍的头，按出现顺序 */
  headers: PetHeader[] = [];
  /** 第一拍缺少头（用于统计人格漂移） */
  headerMissing = false;
  private sawText = false;

  constructor(private onHeader?: (h: PetHeader, index: number) => void) {}

  /** 喂一段增量，返回可以立刻当正文用的文本（可能为空串） */
  feed(delta: string): string {
    this.buf += delta;
    let out = "";
    for (;;) {
      const nl = this.buf.indexOf("\n");
      if (nl < 0) break;
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      out += this.consumeLine(line, true);
    }
    // 残段：可能是正在到达的头（行首以 { 开头）——攥着不吐；否则直接吐
    const lead = this.buf.trimStart();
    if (this.atLineStart && lead.startsWith("{") && this.buf.length <= 400) {
      // 头可能已经合上但换行还没来：{...} 后面还有别的字符就当整行处理
      const close = lead.indexOf("}");
      if (close >= 0 && lead.slice(close + 1).trim()) {
        const line = this.buf;
        this.buf = "";
        out += this.consumeLine(line, false);
      }
      return out;
    }
    if (this.buf) {
      if (this.buf.trim()) this.atLineStart = false;
      out += this.buf;
      this.buf = "";
      this.noteText(out);
    }
    return out;
  }

  /** 流结束：把残留冲出来 */
  flush(): string {
    const rest = this.buf;
    this.buf = "";
    const out = rest ? this.consumeLine(rest, false) : "";
    if (!this.header) this.headerMissing = true;
    return out;
  }

  private consumeLine(line: string, hadNewline: boolean): string {
    const t = line.trim();
    if (this.atLineStart && t.startsWith("{")) {
      const close = t.indexOf("}");
      const jsonPart = close >= 0 ? t.slice(0, close + 1) : t;
      const rest = close >= 0 ? t.slice(close + 1).replace(/^\s+/, "") : "";
      const h = parseHeader(jsonPart);
      if (h) {
        if (!this.header && !this.sawText) this.header = h;
        else if (!this.header) this.header = h; // 正文之后才出现的第一拍：仍记为首头，但算缺失
        this.headers.push(h);
        this.onHeader?.(h, this.headers.length - 1);
        this.atLineStart = true;
        // 头与话写在同一行：把话吐出去
        if (rest) {
          this.atLineStart = false;
          this.noteText(rest);
          return rest + (hadNewline ? "\n" : "");
        }
        return "";
      }
      // 不是合法头：当正文
    }
    const text = line + (hadNewline ? "\n" : "");
    if (t) {
      this.noteText(t);
    }
    this.atLineStart = true; // 行结束
    if (!hadNewline) this.atLineStart = false;
    return text;
  }

  private noteText(t: string) {
    if (!t.trim()) return;
    if (!this.sawText && !this.header) this.headerMissing = true;
    this.sawText = true;
  }
}

export function parseHeader(raw: string): PetHeader | null {
  try {
    const j = JSON.parse(raw);
    const num = (v: unknown, lo: number, hi: number, dflt: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
    };
    return {
      valence: num(j.v ?? j.valence, -1, 1, DEFAULT_HEADER.valence),
      arousal: num(j.a ?? j.arousal, 0, 1, DEFAULT_HEADER.arousal),
      action: isAction(j.act ?? j.action) ? (j.act ?? j.action) : "idle_drift",
      intensity: num(j.i ?? j.intensity, 0, 1, DEFAULT_HEADER.intensity),
      glow: typeof j.g === "string" ? j.g : typeof j.glow === "string" ? j.glow : undefined,
    };
  } catch {
    return null;
  }
}

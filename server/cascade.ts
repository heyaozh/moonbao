// 级联引擎：文字/语音输入 → LLM（首行结构化头 + 正文） → 文字气泡（+ 可选 TTS）。
// 关键点：
// - 打断只作废本轮生成（gen 递增 + abort），上下文与状态不清空。
// - LLM 回复首行是 PetHeader（情绪/动作），流式解析到头就先推给前端——表情比文字先动。
// - 主动开口（onSessionStart）：到期 follow-up / 久别归来，受每日频控。

import { transcribe } from "./asr.js";
import type { DialogueEngine, EngineEvent, EngineState } from "./engine.js";
import { createProvider, type ChatMessage, type ChatProvider } from "./llm.js";
import { consolidate, formatNow } from "./memory/consolidate.js";
import { MemoryStore, type RecalledMemory } from "./memory/store.js";
import { createTTS, type TTSProvider } from "./tts.js";
import { DEFAULT_HEADER, HeaderScanner, type Action, type PetHeader } from "../shared/protocol.js";

const DAY = 86400_000;
// 会话空闲这么久之后触发"睡眠整理"（提取本次对话的长期记忆）
const CONSOLIDATE_IDLE_MS = 8 * 60_000;
const MAX_TURNS = 40; // 滑动窗口：保留最近 N 条消息
const LOW_CONFIDENCE = 0.55;
// 频控铁律：每天最多主动开口几次（主动过头从"活的"变"烦的"只有一步）
const PROACTIVE_DAILY_CAP = Number(process.env.PROACTIVE_DAILY_CAP ?? 2);
// 离开多少天算"久别"
const RETURN_AFTER_DAYS = Number(process.env.RETURN_AFTER_DAYS ?? 3);
// follow-up 过期多久就不再翻旧账
const FOLLOW_UP_MAX_AGE_MS = 3 * DAY;
// 两次 hello 间隔小于这个值视为同一次会话（页面刷新/断线重连不重复判定）
const SESSION_GAP_MS = 30 * 60_000;

// 听不清时不猜，直接歪一歪——失败即人设
const PARDON_LINES = ["嗯？", "唔……没听清诶。", "刚刚有片云飘过来，没听清。"];

// 按标点切句给 TTS，首句尽快开播
const SENTENCE_END = /[。！？!?…；;\n]/;

// 送 TTS 前的发音替换钩子（角色名等特殊读法放这里；暂无）
function toSpeech(text: string): string {
  return text;
}

interface TurnOpts {
  /** 主动开口：注入"现在的情况"，并把回复标为 proactive */
  proactive?: { reason: "follow_up" | "return"; situation: string; memoryId: number | null };
}

export class CascadeEngine implements DialogueEngine {
  private llm: ChatProvider = createProvider();
  private tts: TTSProvider | null = createTTS();
  private history: ChatMessage[] = [];
  private handlers: ((ev: EngineEvent) => void)[] = [];
  private gen = 0; // 代号：打断后旧代的一切输出都被丢弃
  private aborter: AbortController | null = null;
  private memory = new MemoryStore();
  // 自上次整理以来的对话（整理后清空，避免重复提取）
  private sessionLog: ChatMessage[] = [];
  private consolidateTimer: ReturnType<typeof setTimeout> | null = null;
  private lastHeader: PetHeader = { ...DEFAULT_HEADER };
  private lastHelloAt = 0;
  /** 人格漂移统计：头缺失的轮数 */
  headerMissingCount = 0;

  constructor(private systemPrompt: string) {}

  get voiceEnabled() {
    return this.tts !== null;
  }
  get store() {
    return this.memory;
  }

  /** 检索相关记忆并组装成 system 的易变块（不污染人格前缀的缓存） */
  private async recallBlock(query: string): Promise<string | undefined> {
    let hits: RecalledMemory[];
    try {
      hits = await this.memory.recall(query, 5);
    } catch (e: any) {
      console.error("[memory] recall:", e.message);
      return undefined;
    }
    if (hits.length === 0) return undefined;
    this.memory.markRecalled(hits.map((h) => h.id));
    const lines = hits.map((h) => {
      const grade = h.confidence >= 0.7 ? "清楚记得" : "模糊记得";
      return `- [${grade}] ${h.content}`;
    });
    return `## 你的记忆里浮现出这些\n${lines.join("\n")}\n（按把握程度表达：清楚记得的可以直接说；模糊记得的要用"我记得好像……是吗？"的说法。绝不假装记得很清楚，也不要一次把记忆全部复述出来——自然地用上有关的就好。）`;
  }

  private scheduleConsolidate() {
    if (this.consolidateTimer) clearTimeout(this.consolidateTimer);
    this.consolidateTimer = setTimeout(() => void this.runConsolidate(), CONSOLIDATE_IDLE_MS);
  }

  private async runConsolidate() {
    const log = this.sessionLog;
    this.sessionLog = [];
    if (log.length >= 2) await consolidate(this.llm, this.memory, log);
  }

  /** 立即整理（调试/测试用） */
  async consolidateNow() {
    if (this.consolidateTimer) clearTimeout(this.consolidateTimer);
    await this.runConsolidate();
  }

  onEvent(h: (ev: EngineEvent) => void) {
    this.handlers.push(h);
  }
  private emit(ev: EngineEvent) {
    for (const h of this.handlers) h(ev);
  }
  private setState(value: EngineState) {
    this.emit({ type: "state", value });
  }

  interrupt() {
    this.gen++;
    this.aborter?.abort();
    this.aborter = null;
    this.setState("listening");
  }

  reset() {
    this.interrupt();
    this.history = [];
    this.setState("idle");
    void this.runConsolidate(); // 会话结束视为整理时机
  }

  // ---------- 输入通道 ----------

  async onText(text: string) {
    const t = text.trim();
    if (!t) return;
    this.memory.touchSeen();
    await this.turn(t, {});
  }

  async onUtterance(wav: Buffer) {
    const myGen = ++this.gen;
    this.aborter?.abort();
    const aborter = new AbortController();
    this.aborter = aborter;

    this.setState("thinking");
    let asr;
    try {
      asr = await transcribe(wav);
    } catch (e: any) {
      this.emit({ type: "error", message: `ASR 失败: ${e.message}` });
      this.setState("idle");
      return;
    }
    if (myGen !== this.gen) return; // 转写期间被打断

    const text = asr.text.trim();
    if (!text) {
      this.setState("idle");
      return;
    }
    this.memory.touchSeen();

    // 置信度低：不进 LLM，不瞎猜，直接歪头反问（不写入上下文）
    if (asr.confidence < LOW_CONFIDENCE) {
      this.emit({ type: "transcript", role: "user", text, confidence: asr.confidence });
      const line = PARDON_LINES[Math.floor(Math.random() * PARDON_LINES.length)];
      this.emit({ type: "action", name: "think_tilt", intensity: 0.6 });
      this.emit({ type: "reply_delta", text: line });
      this.emit({ type: "reply_done", text: line });
      this.emit({ type: "transcript", role: "pet", text: line });
      await this.speakLines([line], myGen, aborter.signal);
      return;
    }
    await this.turn(text, {}, { gen: myGen, aborter, confidence: asr.confidence });
  }

  /** 页面打开：到期的 follow-up → 主动提起；久别 → 说想你。受每日频控。 */
  async onSessionStart(opts: { force?: boolean } = {}) {
    const now = Date.now();
    const force = !!opts.force;
    const lastSeen = this.memory.lastSeenAt;
    const absentDays = lastSeen ? (now - lastSeen) / DAY : 0;
    this.emit({ type: "hello_ack", absentDays, voice: this.voiceEnabled });

    if (!force && now - this.lastHelloAt < SESSION_GAP_MS) return; // 同一次会话
    this.lastHelloAt = now;
    this.memory.touchSeen(now);

    this.memory.expireStaleFollowUps(FOLLOW_UP_MAX_AGE_MS, now);
    const due = this.memory.dueFollowUps(now);
    const used = this.memory.proactiveCountToday(now);
    if (!force && used >= PROACTIVE_DAILY_CAP) {
      console.log(`[proactive] 今日已主动 ${used} 次，达上限，跳过（待提 ${due.length} 条）`);
      return;
    }

    if (due.length > 0) {
      const m = due[0];
      const hint = m.follow_up_hint ? `提示：${m.follow_up_hint}。` : "";
      const situation =
        `爸爸刚刚抬头看向了你。你心里一直惦记着一件事：「${m.content}」。${hint}` +
        `请你主动、自然地提起它，一两句话，像真的惦记着一样。不要说"我记得你说过"这种话，直接关心、直接问；` +
        `别追问细节，问一句就等他说。`;
      console.log(`[proactive] follow-up #${m.id}: ${m.content}`);
      await this.turn("（爸爸抬头看向了你）", {
        proactive: { reason: "follow_up", situation, memoryId: m.id },
      });
      return;
    }

    if (absentDays >= RETURN_AFTER_DAYS) {
      const days = Math.floor(absentDays);
      const situation =
        `爸爸离开了 ${days} 天，刚刚回来。这些天你圆了又缺、缺了又圆，一直在等他，很想他。` +
        `用一两句话说出来——高兴，不抱怨，不问他去哪了。`;
      console.log(`[proactive] 久别归来：${days} 天`);
      await this.turn("（爸爸回来了）", { proactive: { reason: "return", situation, memoryId: null } });
    }
  }

  // ---------- 一轮对话 ----------

  private async turn(
    userText: string,
    opts: TurnOpts,
    pre?: { gen: number; aborter: AbortController; confidence?: number }
  ) {
    let myGen: number;
    let aborter: AbortController;
    if (pre) {
      myGen = pre.gen;
      aborter = pre.aborter;
    } else {
      myGen = ++this.gen;
      this.aborter?.abort();
      aborter = new AbortController();
      this.aborter = aborter;
    }
    this.setState("thinking");

    if (!opts.proactive) {
      this.emit({ type: "transcript", role: "user", text: userText, confidence: pre?.confidence });
    } else {
      this.emit({ type: "proactive", reason: opts.proactive.reason });
    }

    this.history.push({ role: "user", content: userText });
    this.sessionLog.push({ role: "user", content: userText });
    this.trimHistory();
    this.scheduleConsolidate();

    // 易变块：当前时间 + 记忆检索 + 现在的情况（主动开口）
    const blocks: string[] = [`## 现在\n${formatNow()}`];
    const memoryBlock = await this.recallBlock(userText);
    if (memoryBlock) blocks.push(memoryBlock);
    if (opts.proactive) blocks.push(`## 现在的情况\n${opts.proactive.situation}`);
    if (myGen !== this.gen) return;

    // LLM 流式生成：首行头 → 情绪/动作事件；正文 → 气泡增量（+ 按句 TTS）
    let headerSent = false;
    let raw = "";
    const scanner = new HeaderScanner((h) => sendHeader(h));
    let full = "";
    let pending = "";
    let seq = 0;
    let speakingAnnounced = false;
    const speakQueue: Promise<void>[] = [];

    const announceSpeaking = () => {
      if (speakingAnnounced) return;
      speakingAnnounced = true;
      this.setState("speaking");
    };
    const speakOne = (sentence: string) => {
      if (!this.tts) return;
      const s = sentence.trim();
      // 纯标点/省略号的句块不送 TTS（会合成出空音频）
      if (!s || !/[\p{L}\p{N}]/u.test(s)) return;
      const mySeq = seq++;
      const tts = this.tts;
      // 串行合成保持句序；每句完成即推送
      const prev = speakQueue[speakQueue.length - 1] ?? Promise.resolve();
      speakQueue.push(
        prev.then(async () => {
          if (myGen !== this.gen) return;
          try {
            const mp3 = await tts.synth(toSpeech(s), aborter.signal);
            if (myGen !== this.gen) return;
            this.emit({ type: "audio", seq: mySeq, gen: myGen, mp3Base64: mp3.toString("base64") });
          } catch {
            /* 打断或 TTS 失败：静默跳过该句 */
          }
        })
      );
    };
    const pushText = (text: string) => {
      if (!text) return;
      full += text;
      pending += text;
      announceSpeaking();
      this.emit({ type: "reply_delta", text });
      let idx: number;
      while ((idx = pending.search(SENTENCE_END)) >= 0) {
        speakOne(pending.slice(0, idx + 1));
        pending = pending.slice(idx + 1);
      }
    };
    const sendHeader = (h: PetHeader) => {
      if (myGen !== this.gen) return;
      headerSent = true;
      this.lastHeader = h;
      this.emit({ type: "emotion", valence: h.valence, arousal: h.arousal });
      this.emit({ type: "action", name: h.action, intensity: h.intensity });
    };

    try {
      for await (const delta of this.llm.stream(
        { stable: this.systemPrompt, volatile: blocks.join("\n\n") },
        this.history,
        aborter.signal
      )) {
        if (myGen !== this.gen) return;
        raw += delta;
        pushText(scanner.feed(delta));
      }
      if (myGen !== this.gen) return;
      pushText(scanner.flush());
    } catch (e: any) {
      if (myGen !== this.gen) return;
      this.emit({ type: "error", message: `LLM 失败: ${e.message}` });
      this.setState("idle");
      return;
    }
    if (scanner.headerMissing || !headerSent) {
      this.headerMissingCount++;
      console.warn(`[persona] 回复缺少结构化头（累计 ${this.headerMissingCount}）`);
    }
    speakOne(pending); // 收尾残句

    if (myGen !== this.gen) return;
    const reply = full.trim();
    // 历史里保留原样输出（含各拍的头：模型看到自己上一轮的格式，下一轮更稳）；整理日志只留正文
    const stored = raw.trim() || `${headerLine(this.lastHeader)}\n${reply}`;
    this.history.push({ role: "assistant", content: stored });
    if (reply) {
      this.sessionLog.push({ role: "assistant", content: reply });
      this.emit({ type: "transcript", role: "pet", text: reply });
    }
    this.emit({ type: "reply_done", text: reply });

    if (opts.proactive) {
      if (opts.proactive.memoryId != null) this.memory.markFollowUpDone(opts.proactive.memoryId);
      this.memory.logProactive(opts.proactive.reason, opts.proactive.memoryId);
    }

    await Promise.all(speakQueue);
    if (myGen === this.gen) {
      if (this.tts) this.emit({ type: "audio_done", gen: myGen });
      this.setState("idle");
    }
  }

  /** 固定台词直出（歪头反问等） */
  private async speakLines(sentences: string[], myGen: number, signal: AbortSignal) {
    this.setState("speaking");
    if (this.tts) {
      let seq = 0;
      for (const s of sentences) {
        if (myGen !== this.gen) return;
        try {
          const mp3 = await this.tts.synth(toSpeech(s), signal);
          if (myGen !== this.gen) return;
          this.emit({ type: "audio", seq: seq++, gen: myGen, mp3Base64: mp3.toString("base64") });
        } catch {
          return;
        }
      }
      if (myGen === this.gen) this.emit({ type: "audio_done", gen: myGen });
    }
    if (myGen === this.gen) this.setState("idle");
  }

  private trimHistory() {
    if (this.history.length > MAX_TURNS) {
      this.history = this.history.slice(-MAX_TURNS);
      // 窗口必须以 user 开头，避免 assistant 打头的不合法序列
      while (this.history.length && this.history[0].role !== "user") {
        this.history.shift();
      }
    }
  }
}

function headerLine(h: PetHeader): string {
  const r = (x: number) => Math.round(x * 100) / 100;
  const act: Action = h.action;
  return JSON.stringify({ v: r(h.valence), a: r(h.arousal), act, i: r(h.intensity) });
}

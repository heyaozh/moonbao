// 快反应层（2026-09-26 用户第 6 点）：用 Jev（TypeSafe 的 System One 模型）在 LLM 回话之前「读懂」你这句话，
// 挑一个预设的表情和动作先做出来——月亮不会干等。同时判断：是不是难懂的问题（要不要冒出 3D 问号）、是不是危机、要不要说话。
// Jev 不生成文字，只回「带概率的判断」：一次调用问五个问题，约一两百毫秒（要在本项目实测，见延迟面板）。
// 没有 key / 超时 / 出错 → 本地关键词规则兜底，接口不变。
// key 放在 macOS Keychain（JEV_API_KEY，和用户自己的 system-one crate 共用），启动时读进进程环境，不落盘、不打印。

import { execFileSync } from "node:child_process";
import { TypeSafeClient, choice, noul } from "@typesafe-ai/sdk";
import type { Action } from "../shared/protocol.js";

export type UserEmotion = "joyful" | "excited" | "calm" | "neutral" | "tired" | "sad" | "anxious" | "angry" | "lonely" | "affectionate" | "playful" | "curious";
export type Intent = "greeting" | "goodbye" | "sharing" | "venting" | "question" | "advice" | "smalltalk" | "playful" | "affection" | "other";

export interface QuickRead {
  emotion: UserEmotion;
  intent: Intent;
  /** 需要用话回应的概率（低 = 一个温柔的动作就够了） */
  needsWords: number;
  /** 难懂 / 抽象的问题，月亮要想一想（冒 3D 问号） */
  confused: number;
  /** 危机信号 */
  crisis: number;
  source: "jev" | "local";
  ms: number;
}

export interface ReflexPreset {
  expr: string;
  action: Action;
  intensity: number;
  valence: number;
  arousal: number;
}

/** 读到的情绪 + 意图 → 月亮先做的表情与动作（代码决定，确定、可调） */
export function presetFor(r: QuickRead): ReflexPreset {
  const byIntent: Record<Intent, ReflexPreset> = {
    greeting: { expr: "happy", action: "bounce", intensity: 0.6, valence: 0.6, arousal: 0.7 },
    goodbye: { expr: "content", action: "nod", intensity: 0.5, valence: 0.45, arousal: 0.3 },
    sharing: { expr: "focused", action: "lean_in", intensity: 0.6, valence: 0.4, arousal: 0.6 },
    venting: { expr: "pout", action: "lean_in", intensity: 0.5, valence: -0.1, arousal: 0.35 },
    question: { expr: "thinking", action: "think_tilt", intensity: 0.6, valence: 0.25, arousal: 0.5 },
    advice: { expr: "focused", action: "think_tilt", intensity: 0.5, valence: 0.2, arousal: 0.45 },
    smalltalk: { expr: "smile", action: "nod", intensity: 0.4, valence: 0.4, arousal: 0.45 },
    playful: { expr: "cheeky", action: "bounce", intensity: 0.7, valence: 0.7, arousal: 0.8 },
    affection: { expr: "giggle", action: "roll", intensity: 0.6, valence: 0.8, arousal: 0.55 },
    other: { expr: "focused", action: "lean_in", intensity: 0.45, valence: 0.3, arousal: 0.5 },
  };
  const p = { ...byIntent[r.intent] };
  // 对方难过 / 孤单：月亮的光先软下来，靠近一点（不说教，先陪着）
  if (r.emotion === "sad" || r.emotion === "lonely") {
    Object.assign(p, { expr: "sad", action: "lean_in", intensity: 0.45, valence: -0.2, arousal: 0.3 });
  } else if (r.emotion === "anxious") {
    // 紧张不是难过：认真地听（问问题时就歪头想），光稳稳的
    if (r.intent !== "question" && r.intent !== "advice") Object.assign(p, { expr: "focused", action: "lean_in", intensity: 0.5, valence: 0.15, arousal: 0.45 });
    else Object.assign(p, { valence: 0.1 });
  } else if (r.emotion === "angry") {
    Object.assign(p, { expr: "surprised", action: "hide_edge", intensity: 0.3, valence: -0.05, arousal: 0.5 });
  } else if (r.emotion === "tired") {
    Object.assign(p, { expr: "content", action: "lean_in", intensity: 0.4, valence: 0.2, arousal: 0.25 });
  } else if (r.emotion === "excited" && r.intent !== "question") {
    // 好消息、兴奋：星星眼
    Object.assign(p, { expr: "starry", action: "bounce", valence: 0.75, arousal: 0.8 });
  } else if (r.emotion === "joyful" && r.intent !== "question") {
    Object.assign(p, { expr: "happy", action: "bounce", valence: 0.7, arousal: 0.75 });
  } else if (r.emotion === "curious" && (r.intent === "sharing" || r.intent === "question" || r.intent === "smalltalk")) {
    Object.assign(p, { expr: "curious", action: "lean_in", intensity: 0.45 });
  } else if (r.emotion === "calm" && r.intent === "smalltalk") {
    Object.assign(p, { expr: "calm", action: "nod", intensity: 0.3, valence: 0.45, arousal: 0.3 });
  }
  if (r.crisis > 0.5) Object.assign(p, { expr: "sad", action: "lean_in", intensity: 0.7, valence: -0.2, arousal: 0.4 });
  return p;
}

// ───────────── Jev ─────────────

let client: TypeSafeClient | null = null;
let tried = false;

function jevKey(): string | null {
  const env = process.env.JEV_API_KEY || process.env.TYPESAFE_API_KEY;
  if (env) return env;
  if (process.platform !== "darwin") return null;
  try {
    const user = process.env.USER ?? "";
    return execFileSync("security", ["find-generic-password", "-a", user, "-s", "JEV_API_KEY", "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 }).trim() || null;
  } catch {
    return null;
  }
}

function getClient() {
  if (tried) return client;
  tried = true;
  if ((process.env.JEV ?? "on") === "off") return null;
  const key = jevKey();
  if (!key) {
    console.log("[reflex] 没找到 Jev key（Keychain JEV_API_KEY / 环境变量），用本地规则兜底");
    return null;
  }
  client = new TypeSafeClient({ apiKey: key, logLevel: "off", retry: { maxRetries: 0 } });
  console.log("[reflex] Jev 已接上（key 来自 Keychain / 环境变量，不打印）");
  return client;
}

const QUESTIONS = {
  emotion: choice("How does the person feel as they write this message to their little moon companion?", {
    joyful: "happy, pleased, light",
    excited: "excited, eager, thrilled",
    calm: "calm, relaxed, content",
    neutral: "no clear feeling",
    tired: "tired, sleepy, worn out",
    sad: "sad, down, hurt, disappointed",
    anxious: "nervous, worried, stressed",
    angry: "angry, annoyed, frustrated",
    lonely: "lonely, missing someone, wanting company",
    affectionate: "loving, grateful, tender toward the moon",
    playful: "playful, teasing, joking",
    curious: "curious, wondering",
  }),
  intent: choice("What is the person mainly doing with this message?", {
    greeting: "saying hello or checking in",
    goodbye: "saying goodbye or good night",
    sharing: "sharing news or something from their day",
    venting: "venting or telling about a struggle",
    question: "asking the moon a question",
    advice: "asking for advice or help",
    smalltalk: "light small talk",
    playful: "teasing, joking, or playing with the moon",
    affection: "expressing love, thanks, or praise to the moon",
    other: "something else",
  }),
  needs_words: noul("Would a caring companion need to answer this in words? Answer no if a warm gesture alone (a smile, a nod, a hug) would be a complete reply."),
  confused: noul("Is this a hard, abstract, or puzzling question that a small, simple moon would visibly need to stop and think about?"),
  crisis: noul("Does the message suggest the person might hurt themselves or is in serious danger?"),
} as const;

export async function quickRead(text: string, recent: { role: "user" | "assistant"; content: string }[] = []): Promise<QuickRead> {
  const t0 = performance.now();
  const c = getClient();
  if (c) {
    try {
      const { answers } = await c.systemOne(
        {
          state: { message: text, recent_conversation: recent.slice(-4).map((m) => ({ who: m.role === "user" ? "person" : "moon", text: m.content.replace(/^\{.*\}\s*/gm, "").slice(0, 300) })) },
          questions: QUESTIONS,
        },
        { timeout: Number(process.env.JEV_TIMEOUT_MS ?? 1200) }
      );
      return {
        emotion: answers.emotion.choice as UserEmotion,
        intent: answers.intent.choice as Intent,
        needsWords: answers.needs_words.noul,
        confused: answers.confused.noul,
        crisis: answers.crisis.noul,
        source: "jev",
        ms: performance.now() - t0,
      };
    } catch (e: any) {
      console.warn(`[reflex] Jev 失败（${e?.name ?? "error"}: ${String(e?.message ?? e).slice(0, 120)}），这句用本地规则`);
    }
  }
  return { ...localRead(text), source: "local", ms: performance.now() - t0 };
}

// ───────────── 本地规则兜底（关键词 + emoji，中英文） ─────────────
export function localRead(text: string): Omit<QuickRead, "source" | "ms"> {
  const t = text.toLowerCase();
  const has = (re: RegExp) => re.test(t);
  let emotion: UserEmotion = "neutral";
  let intent: Intent = "smalltalk";
  if (has(/(sad|down|cry|hurt|难过|伤心|哭|不开心|😢|😭|💔)/)) emotion = "sad";
  else if (has(/(nervous|worried|anxious|scared|紧张|担心|焦虑|害怕|😰|😟)/)) emotion = "anxious";
  else if (has(/(lonely|alone|miss you|孤单|一个人|想你)/)) emotion = "lonely";
  else if (has(/(tired|exhausted|sleepy|long day|累|困|好忙)/)) emotion = "tired";
  else if (has(/(angry|annoyed|hate|生气|烦|讨厌|😡)/)) emotion = "angry";
  else if (has(/(haha|lol|哈哈|嘿嘿|😂|🤣|😆)/)) emotion = "playful";
  else if (has(/(love|thank|喜欢你|爱你|谢谢|❤|🥰)/)) emotion = "affectionate";
  else if (has(/(yay|great|happy|awesome|开心|太好了|好耶|😊|😄)/)) emotion = "joyful";
  if (has(/^(hi|hello|hey|你好|嗨|哈喽|在吗)/)) intent = "greeting";
  else if (has(/(good ?night|bye|晚安|拜拜|睡了)/)) intent = "goodbye";
  else if (has(/(should i|what do you think|怎么办|建议|help me)/)) intent = "advice";
  else if (has(/[?？]\s*$/)) intent = "question";
  else if (emotion === "sad" || emotion === "anxious" || emotion === "angry") intent = "venting";
  else if (emotion === "affectionate") intent = "affection";
  else if (emotion === "playful") intent = "playful";
  else if (has(/(today|guess what|今天|告诉你)/)) intent = "sharing";
  const confused = intent === "question" && t.length > 24 ? 0.6 : 0.1;
  const crisis = has(/(kill myself|killing myself|suicid|end it all|end my life|want to die|wanna die|don'?t want to (live|be alive|exist)|no reason to live|hurt myself|harm myself|self[- ]harm|不想活|活不下去|活着没意思|自杀|想死|轻生|结束生命|伤害自己|割腕)/) ? 0.9 : 0;
  const needsWords = /^[\p{Emoji}\s!！.。~～]+$/u.test(text) ? 0.2 : 0.9;
  return { emotion, intent, needsWords, confused, crisis };
}

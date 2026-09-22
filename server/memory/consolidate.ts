// "睡眠整理"：会话空闲/结束后，把本次对话交给 LLM 提取值得长期保存的记忆。
// 原则：反思保留来源；不把推测固化成事实（置信度体现在 importance/表述上）。
// follow_up：对话里出现"明天面试""下周体检"这类有时间点的事，整理器给出一个到期时间和提起提示，
// 到期后它会主动开口（见 cascade.onSessionStart）。

import { CHARACTER_NAME } from "../character.js";
import type { ChatMessage, ChatProvider } from "../llm.js";
import type { MemoryKind, MemoryStore } from "./store.js";

const EXTRACT_PROMPT = `你是记忆整理器。下面是小月亮"${CHARACTER_NAME}"和她的朋友（用户，她叫他爸爸）的一段对话记录。
提取值得长期记住的内容，输出严格的 JSON 数组（没有就输出 []），每项：
{"kind":"episode|fact|pinned","content":"一句话，第三人称，具体明确","importance":0..1,"emotional":0..1,
 "follow_up_at":"YYYY-MM-DDTHH:mm 或 null","follow_up_hint":"${CHARACTER_NAME}到时候怎么提起，一句话；或 null"}

规则：
- fact = 关于用户的稳定事实/偏好/近况（"用户下周三有面试"、"用户不喝咖啡了"）
- episode = 这次对话里值得记住的事件/时刻（"9月22日用户第一次和${CHARACTER_NAME}说话"）
- pinned = 用户明确要求记住的事
- 日常寒暄、天气闲聊不值得记。宁缺毋滥，通常 0~3 条。
- 情绪相关的事 emotional 给高；用户难过/开心/紧张的时刻务必记录。
- 不要记${CHARACTER_NAME}自己说的设定内容。只输出 JSON，不要其它文字。

follow_up 规则（这是让用户觉得她"活着"的关键，但宁缺毋滥）：
- 只有用户提到了**未来的具体事件**（面试、考试、体检、出差、约会、比赛、搬家、见某人）或**当下明显的情绪状态**（很累、很难过、生病）才给 follow_up。
- 到期时间用当前时间推算，写绝对时间：
  · 未来事件 → 事件**结束之后**的第一个合适时机：当天 20:00；事件在晚上则次日 09:00。
  · 当下情绪（很累/生病/难过）→ 次日 09:00 轻轻问一句。
  · 时间说不清（"最近""以后"）→ null。
- follow_up_hint 是给${CHARACTER_NAME}的提示，不是台词，例如"问问面试怎么样，别追问细节"、"问问昨晚睡好了没"。`;

function parseLocalDateTime(s: unknown): number | null {
  if (typeof s !== "string" || !s) return null;
  // "YYYY-MM-DDTHH:mm"（无时区）按本地时间解析
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(s.trim());
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

/** "2026-09-22 09:00（周二）" */
export function formatNow(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const wd = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][now.getDay()];
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}（${wd}）`;
}

export async function consolidate(
  llm: ChatProvider,
  store: MemoryStore,
  transcript: ChatMessage[],
  now = Date.now()
): Promise<number> {
  if (transcript.length < 2) return 0;
  const log = transcript
    .map((m) => `${m.role === "user" ? "用户" : CHARACTER_NAME}: ${m.content}`)
    .join("\n");

  let raw = "";
  try {
    for await (const chunk of llm.stream(
      EXTRACT_PROMPT,
      [{ role: "user", content: `现在是 ${formatNow(new Date(now))}。\n\n对话记录：\n${log}` }],
      new AbortController().signal
    )) {
      raw += chunk;
    }
  } catch (e: any) {
    console.error("[memory] consolidate LLM:", e.message);
    return 0;
  }

  let items: any[];
  try {
    const jsonStart = raw.indexOf("[");
    const jsonEnd = raw.lastIndexOf("]");
    items = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
  } catch {
    console.error("[memory] consolidate: 无法解析", raw.slice(0, 200));
    return 0;
  }

  let added = 0;
  for (const it of items) {
    if (!it?.content || typeof it.content !== "string") continue;
    const kind: MemoryKind = ["episode", "fact", "pinned"].includes(it.kind) ? it.kind : "episode";
    let followUpAt = parseLocalDateTime(it.follow_up_at);
    // 已经过去的到期时间没有意义；至少 20 分钟后
    if (followUpAt !== null && followUpAt < now + 20 * 60_000) followUpAt = null;
    const id = await store.add({
      kind,
      content: it.content.slice(0, 200),
      importance: clamp01(it.importance, 0.5),
      emotional: clamp01(it.emotional, 0),
      source: `consolidate:${new Date(now).toISOString().slice(0, 10)}`,
      followUpAt,
      followUpHint:
        followUpAt !== null && typeof it.follow_up_hint === "string"
          ? it.follow_up_hint.slice(0, 120)
          : null,
    });
    if (id !== null) added++;
    if (followUpAt !== null)
      console.log(
        `[memory] follow-up @ ${formatNow(new Date(followUpAt))}: ${it.follow_up_hint ?? it.content}`
      );
  }
  console.log(`[memory] 整理完成：新增 ${added} 条（共 ${store.count()} 条）`);
  return added;
}

function clamp01(v: any, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : dflt;
}

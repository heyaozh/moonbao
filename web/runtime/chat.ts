// 对话壳：气泡 + 输入框 + 状态小标。与渲染层无关的 DOM 覆盖层。
// 出错时不显示技术信息，显示一句它自己的话（失败即人设）。
// 注意：气泡只是「快通道」；重要时刻的回应走星星拼字（P3），届时这里只负责兜底。

import { CHARACTER_NAME } from "../config";
import type { Bus } from "./bus";
import type { EngineClient } from "./client";

const ERROR_LINES = ["唔……刚刚有片云飘过来了。", "诶？星星跑掉了一颗，没接住。", "……我想想哦。（发呆）"];
const TYPING_IDLE_MS = 1800;
const BUBBLE_LINGER_MS = 14_000;

export interface ChatUI {
  onLatency?: (kind: "first_emotion" | "first_text" | "done", ms: number) => void;
}

export function installChat(bus: Bus, client: EngineClient, ui: ChatUI = {}) {
  const bubble = document.getElementById("bubble") as HTMLDivElement;
  const bubbleText = document.getElementById("bubbleText") as HTMLDivElement;
  const userChip = document.getElementById("userChip") as HTMLDivElement;
  const input = document.getElementById("chatInput") as HTMLInputElement;
  const sendBtn = document.getElementById("chatSend") as HTMLButtonElement;
  const status = document.getElementById("status") as HTMLDivElement;
  const log = document.getElementById("transcript") as HTMLDivElement;

  let typingTimer: ReturnType<typeof setTimeout> | null = null;
  let typingActive = false;
  let lingerTimer: ReturnType<typeof setTimeout> | null = null;
  let sentAt = 0;
  let gotEmotion = false;
  let gotText = false;
  let connected = false;

  const setStatus = (text: string, cls = "") => {
    status.textContent = text;
    status.className = cls;
  };

  const showBubble = (text: string, streaming: boolean) => {
    if (lingerTimer) clearTimeout(lingerTimer);
    lingerTimer = null;
    bubble.hidden = false;
    bubble.classList.toggle("streaming", streaming);
    bubbleText.textContent = text.replace(/\n{2,}/g, "\n").trim();
  };
  const lingerBubble = () => {
    if (lingerTimer) clearTimeout(lingerTimer);
    lingerTimer = setTimeout(() => {
      bubble.hidden = true;
    }, BUBBLE_LINGER_MS);
  };
  const appendLog = (who: string, text: string) => {
    const d = document.createElement("div");
    d.className = who === CHARACTER_NAME ? "pet" : "me";
    d.textContent = `${who}：${text}`;
    log.appendChild(d);
    while (log.childElementCount > 60) log.firstElementChild?.remove();
    log.scrollTop = log.scrollHeight;
  };

  const setTyping = (active: boolean) => {
    if (typingActive === active) return;
    typingActive = active;
    bus.emit("user:typing", { active });
  };

  input.addEventListener("input", () => {
    if (input.value.trim()) setTyping(true);
    if (typingTimer) clearTimeout(typingTimer);
    typingTimer = setTimeout(() => setTyping(false), TYPING_IDLE_MS);
  });

  const send = () => {
    const text = input.value.trim();
    if (!text) return;
    if (!connected) {
      showBubble("……（好像还没连上）", false);
      lingerBubble();
      return;
    }
    input.value = "";
    if (typingTimer) clearTimeout(typingTimer);
    setTyping(false);
    sentAt = performance.now();
    gotEmotion = gotText = false;
    userChip.textContent = text;
    userChip.hidden = false;
    appendLog("我", text);
    bus.emit("user:send", { text });
    client.send({ type: "text", text });
  };
  sendBtn.onclick = send;
  // 回车发送：走表单隐式提交（各种输入法/自动化都会触发 submit），再兜一层 keydown
  input.form?.addEventListener("submit", (e) => {
    e.preventDefault();
    send();
  });
  input.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === "Return") && !e.isComposing && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  // ---- 引擎事件 → UI ----
  let current = "";
  bus.on("net:status", ({ connected: c }) => {
    connected = c;
    setStatus(c ? "在夜空里" : "……（离线）", c ? "" : "off");
  });
  bus.on("engine:state", ({ value }) => {
    if (!connected) return;
    if (value === "thinking") setStatus("……想想", "think");
    else if (value === "speaking") setStatus("在拼字", "speak");
    else if (value === "listening") setStatus("在听", "listen");
    else setStatus("在夜空里");
  });
  bus.on("engine:emotion", () => {
    if (sentAt && !gotEmotion) {
      gotEmotion = true;
      ui.onLatency?.("first_emotion", performance.now() - sentAt);
    }
  });
  bus.on("engine:proactive", () => {
    // 它主动开口：不是在回答谁，清掉用户 chip
    userChip.hidden = true;
    current = "";
  });
  bus.on("engine:reply_delta", () => {
    if (sentAt && !gotText) {
      gotText = true;
      ui.onLatency?.("first_text", performance.now() - sentAt);
    }
  });
  bus.on("paced:text", ({ text }) => {
    current = text;
    showBubble(current, true);
  });
  bus.on("paced:done", ({ text }) => {
    if (sentAt) ui.onLatency?.("done", performance.now() - sentAt);
    sentAt = 0;
    current = "";
    if (text) {
      showBubble(text, false);
      appendLog(CHARACTER_NAME, text);
    } else {
      // 只做了动作没说话：不留空气泡
      bubble.hidden = true;
    }
    lingerBubble();
  });
  bus.on("engine:error", ({ message }) => {
    console.warn("[engine]", message);
    sentAt = 0;
    current = "";
    showBubble(ERROR_LINES[Math.floor(Math.random() * ERROR_LINES.length)], false);
    lingerBubble();
  });

  return { appendLog };
}

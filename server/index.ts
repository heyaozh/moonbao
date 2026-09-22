// 本地服务：WebSocket 桥接前端与级联引擎。
// 单用户单会话；前端断线重连后上下文仍在（进程内保存）。
// 人格 = persona/system-prompt.md（角色圣经）+ persona/protocol.md（输出格式），{{NAME}} 由 CHARACTER_NAME 替换。

import "dotenv/config";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { warmup } from "./asr.js";
import { CascadeEngine } from "./cascade.js";
import { CHARACTER_NAME, withName } from "./character.js";
import { warmupEmbedder } from "./memory/embed.js";
import type { ClientMessage } from "../shared/protocol.js";

// 用专用变量，避开各种工具注入的通用 PORT
const PORT = Number(process.env.MOONBAO_PORT ?? 8787);
const VOICE_INPUT = (process.env.VOICE_INPUT ?? "off") === "on";

export function loadPersona(): string {
  const dir = path.join(process.cwd(), "persona");
  const core = readFileSync(path.join(dir, "system-prompt.md"), "utf8");
  const protocol = readFileSync(path.join(dir, "protocol.md"), "utf8");
  return withName(`${core.trim()}\n\n${protocol.trim()}\n`);
}

const engine = new CascadeEngine(loadPersona());

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const json = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body, null, 2));
  };
  if (url.pathname === "/api/health") {
    return json(200, {
      ok: true,
      character: CHARACTER_NAME,
      llm: process.env.LLM_PROVIDER ?? "claude",
      tts: process.env.TTS_PROVIDER ?? "none",
      voiceInput: VOICE_INPUT,
      memories: engine.store.count(),
      headerMissing: engine.headerMissingCount,
    });
  }
  if (url.pathname === "/api/memory") {
    // 调试：最近记忆 + 待提起的 follow-up
    const fmt = (t: number | null) => (t ? new Date(t).toLocaleString("zh-CN") : null);
    return json(200, {
      lastSeenAt: fmt(engine.store.lastSeenAt),
      proactiveToday: engine.store.proactiveCountToday(),
      followUps: engine.store.pendingFollowUps().map((m) => ({
        id: m.id,
        content: m.content,
        at: fmt(m.follow_up_at),
        hint: m.follow_up_hint,
        due: (m.follow_up_at ?? Infinity) <= Date.now(),
      })),
      recent: engine.store.recent(15).map((m) => ({
        id: m.id,
        kind: m.kind,
        content: m.content,
        importance: m.importance,
        at: fmt(m.created_at),
      })),
    });
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("moonbao server ok\n");
});
const wss = new WebSocketServer({ server, path: "/ws" });

let client: WebSocket | null = null;

engine.onEvent((ev) => {
  if (client?.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(ev));
  }
});

wss.on("connection", (ws) => {
  // 只服务最新连接（刷新页面时旧连接让位）
  client?.close();
  client = ws;
  console.log("[ws] client connected");

  ws.on("message", async (data) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    try {
      switch (msg.type) {
        case "hello":
          await engine.onSessionStart({ force: msg.force });
          break;
        case "text":
          await engine.onText(msg.text);
          break;
        case "utterance":
          if (typeof msg.wavBase64 === "string") {
            await engine.onUtterance(Buffer.from(msg.wavBase64, "base64"));
          }
          break;
        case "interrupt":
          engine.interrupt();
          break;
        case "reset":
          engine.reset();
          break;
      }
    } catch (e: any) {
      console.error("[engine]", e);
      ws.send(JSON.stringify({ type: "error", message: String(e?.message ?? e) }));
    }
  });

  ws.on("close", () => {
    if (client === ws) client = null;
    console.log("[ws] client disconnected");
  });
});

if (VOICE_INPUT) warmup(); // 提前拉起 whisper-server，首句不吃模型冷加载
warmupEmbedder(); // 提前加载记忆 embedding 模型（首次运行会下载 ~30MB）

server.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT}  (ws: /ws)  角色=${CHARACTER_NAME}`);
  console.log(
    `[server] LLM=${process.env.LLM_PROVIDER ?? "claude"} TTS=${process.env.TTS_PROVIDER ?? "none"} 语音输入=${VOICE_INPUT ? "on" : "off"}`
  );
});

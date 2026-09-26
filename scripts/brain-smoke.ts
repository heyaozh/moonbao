// 大脑冒烟测试：连上本机服务端，中英文各聊若干轮 + 两段语音，记录每轮的延迟与回复。
// 用法：npx tsx scripts/brain-smoke.ts [轮数=10] [en.wav] [zh.wav]
// 会真的调用 LLM（Haiku，一轮约 $0.002）和 Jev。
import { readFileSync } from "node:fs";
import WebSocket from "ws";

const N = Number(process.argv[2] ?? 10);
const wavs = process.argv.slice(3);
const EN = ["hi moon!", "long day today", "my boss yelled at me", "i made pasta for dinner though", "do you ever get lonely up there?", "what do you do all day?", "haha you're silly", "i have an interview tomorrow", "i'm a bit nervous", "good night moon"];
const ZH = ["你好呀", "今天好累", "被老板说了一顿", "不过晚饭做了番茄面", "你在天上会孤单吗？", "你每天都干什么呀", "哈哈你好可爱", "明天有个面试", "有点紧张", "晚安"];

const ws = new WebSocket("ws://localhost:8787/ws");
type Row = { msg: string; reflex?: number; emotion?: number; text?: number; done?: number; reply: string; src?: string };
const rows: Row[] = [];
let cur: Row | null = null;
let t0 = 0;
let resolveTurn: (() => void) | null = null;

ws.on("message", (d) => {
  const ev = JSON.parse(d.toString());
  if (!cur) return;
  const dt = Math.round(performance.now() - t0);
  if (ev.type === "reflex" && cur.reflex == null) {
    cur.reflex = dt;
    cur.src = `${ev.source}:${ev.expr}+${ev.action}`;
  }
  if (ev.type === "emotion" && cur.emotion == null) cur.emotion = dt;
  if (ev.type === "reply_delta" && cur.text == null) cur.text = dt;
  if (ev.type === "transcript" && ev.role === "user" && cur.msg.startsWith("🎤")) cur.msg += ` → 「${ev.text}」(${(ev.confidence ?? 0).toFixed(2)})`;
  if (ev.type === "reply_done") {
    cur.done = dt;
    cur.reply = ev.text.replace(/\n+/g, " / ");
    resolveTurn?.();
  }
  if (ev.type === "error") {
    cur.reply = `ERROR ${ev.message}`;
    resolveTurn?.();
  }
});

const turn = (payload: object, label: string) =>
  new Promise<void>((resolve) => {
    cur = { msg: label, reply: "" };
    rows.push(cur);
    t0 = performance.now();
    resolveTurn = resolve;
    ws.send(JSON.stringify(payload));
    setTimeout(resolve, 30000);
  });

ws.on("open", async () => {
  ws.send(JSON.stringify({ type: "reset" }));
  await new Promise((r) => setTimeout(r, 300));
  for (const m of EN.slice(0, N)) await turn({ type: "text", text: m }, m);
  ws.send(JSON.stringify({ type: "reset" }));
  await new Promise((r) => setTimeout(r, 300));
  for (const m of ZH.slice(0, N)) await turn({ type: "text", text: m }, m);
  for (const f of wavs) await turn({ type: "utterance", wavBase64: readFileSync(f).toString("base64") }, `🎤 ${f.split("/").pop()}`);
  for (const r of rows) console.log(`${String(r.reflex ?? "-").padStart(5)} ${String(r.emotion ?? "-").padStart(5)} ${String(r.text ?? "-").padStart(5)} ${String(r.done ?? "-").padStart(5)}  ${r.src ?? ""}  「${r.msg}」 → ${r.reply}`);
  const med = (k: keyof Row) => {
    const v = rows.map((r) => r[k] as number).filter((x) => typeof x === "number").sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : NaN;
  };
  console.log(`p50  反应 ${med("reflex")}ms  表情 ${med("emotion")}ms  首字 ${med("text")}ms  完 ${med("done")}ms`);
  ws.close();
  process.exit(0);
});

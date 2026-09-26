// Jev 快反应的实测：延迟 + 判断是否合理（中英文各几句）。npx tsx scripts/jev-probe.ts
import "dotenv/config";
import { presetFor, quickRead } from "../server/reflex.js";

const samples = [
  "hi moon!",
  "Long day.",
  "I tried my best, but nothing seemed to go right.",
  "Will you stay with me?",
  "I'm a bit nervous because I would like to propose to my boyfriend.",
  "haha you're so silly",
  "What's the meaning of life?",
  "good night 🌙",
  "你好呀小月亮",
  "今天好累啊",
  "我有点难过，面试没过",
  "你觉得我应该换工作吗？",
];
const main = async () => {
  const times: number[] = [];
  for (const s of samples) {
    const r = await quickRead(s);
    const p = presetFor(r);
    times.push(r.ms);
    console.log(`${r.source} ${String(Math.round(r.ms)).padStart(4)}ms  ${r.emotion.padEnd(12)} ${r.intent.padEnd(10)} words=${r.needsWords.toFixed(2)} confused=${r.confused.toFixed(2)} crisis=${r.crisis.toFixed(2)} → ${p.expr}+${p.action}   「${s}」`);
  }
  times.sort((a, b) => a - b);
  console.log(`p50 ${Math.round(times[Math.floor(times.length / 2)])}ms  p90 ${Math.round(times[Math.floor(times.length * 0.9)])}ms`);
};
void main();

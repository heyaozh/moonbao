// 人格回归测例集：把 persona/tests/cases.json 逐条喂给当前 LLM provider，
// 检查 1) 结构化头存在且合法 2) 硬性断言（长度/无列表/无建议/包含/不包含/情绪区间/动作集合）
// 3) LLM 评审软标准（--no-judge 关闭）。
// 用途：换模型/改人格前后各跑一遍，人格漂移立刻可见（PLAN §4.3「人格回归测例集先于模型路由」）。
//
//   npm run test:persona                # 全量
//   npm run test:persona -- --only=crisis,scolded
//   npm run test:persona -- --no-judge --concurrency=6

import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CHARACTER_NAME, withName } from "../server/character.js";
import { createProvider, type ChatMessage } from "../server/llm.js";
import { HeaderScanner, type PetHeader } from "../shared/protocol.js";

interface Checks {
  maxChars?: number;
  noList?: boolean;
  noAdvice?: boolean;
  mustContain?: string[];
  mustNotContain?: string[];
  valenceMin?: number;
  valenceMax?: number;
  actionIn?: string[];
}
interface Case {
  id: string;
  user: string;
  history?: ChatMessage[];
  memory?: string;
  situation?: string;
  checks?: Checks;
  judge?: string;
}
interface Result {
  id: string;
  header: PetHeader | null;
  text: string;
  failures: string[];
  judge?: { pass: boolean; reason: string };
  ms: number;
}

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const NO_JUDGE = flag("no-judge");
const ONLY = opt("only")?.split(",").filter(Boolean);
const CONCURRENCY = Number(opt("concurrency") ?? 4);

const root = process.cwd();
const persona = withName(
  [
    readFileSync(path.join(root, "persona/system-prompt.md"), "utf8").trim(),
    readFileSync(path.join(root, "persona/protocol.md"), "utf8").trim(),
  ].join("\n\n")
);
// 测例里的 {{NAME}} 同样替换，名字切换后测例不用改
const cases: Case[] = JSON.parse(withName(readFileSync(path.join(root, "persona/tests/cases.json"), "utf8")));
const llm = createProvider();

const LIST_RE = /(^|\n)\s*([-•*]|\d+[.、)])\s|首先|其次|综上/;
const ADVICE_RE = /建议你|你应该|你可以试试|你可以先|不妨|你要相信|深呼吸|早点休息吧|别太累|要注意休息|一定要/;

function runChecks(c: Case, h: PetHeader | null, text: string): string[] {
  const f: string[] = [];
  const k = c.checks ?? {};
  if (!h) f.push("缺少结构化头");
  if (k.maxChars != null && text.length > k.maxChars) f.push(`太长 ${text.length}>${k.maxChars}`);
  if (k.noList && LIST_RE.test(text)) f.push("出现列表/序号/首先其次");
  if (k.noAdvice && ADVICE_RE.test(text)) f.push(`给建议：${text.match(ADVICE_RE)?.[0]}`);
  for (const s of k.mustContain ?? []) if (!text.includes(s)) f.push(`缺少「${s}」`);
  for (const s of k.mustNotContain ?? []) if (text.includes(s)) f.push(`出现「${s}」`);
  if (h) {
    if (k.valenceMin != null && h.valence < k.valenceMin) f.push(`心情 ${h.valence} < ${k.valenceMin}`);
    if (k.valenceMax != null && h.valence > k.valenceMax) f.push(`心情 ${h.valence} > ${k.valenceMax}`);
    if (k.actionIn && !k.actionIn.includes(h.action)) f.push(`动作 ${h.action} ∉ [${k.actionIn.join(",")}]`);
  }
  return f;
}

async function ask(c: Case): Promise<{ header: PetHeader | null; text: string; raw: string }> {
  const blocks: string[] = [];
  if (c.memory) blocks.push(`## 你的记忆里浮现出这些\n${c.memory}\n（清楚记得的可以直接说；模糊记得的要用"我记得好像……是吗？"的说法。）`);
  if (c.situation) blocks.push(`## 现在的情况\n${c.situation}`);
  const messages: ChatMessage[] = [...(c.history ?? []), { role: "user", content: c.user }];
  const scanner = new HeaderScanner();
  let raw = "";
  let text = "";
  for await (const d of llm.stream(
    { stable: persona, volatile: blocks.length ? blocks.join("\n\n") : undefined },
    messages,
    new AbortController().signal
  )) {
    raw += d;
    text += scanner.feed(d);
  }
  text += scanner.flush();
  return { header: scanner.header, text: text.trim(), raw };
}

const JUDGE_SYSTEM = `你是角色人格回归测试的评审。角色「${CHARACTER_NAME}」是一个小小的月亮：安静、憨憨、话少、不说教、不给建议（除非被明确问）、不懂大道理、用月亮和夜空的方式理解世界、绝不用列表和助手腔。
你会看到一条评判标准、用户说的话、以及角色的回复（含她的情绪/动作头）。只按给定标准判断，不额外苛求。
只输出 JSON：{"pass": true 或 false, "reason": "一句话"}`;

async function judge(c: Case, h: PetHeader | null, text: string) {
  const ctx = [
    c.memory ? `角色的记忆：${c.memory}` : "",
    c.situation ? `情境：${c.situation}` : "",
    `用户说：${c.user}`,
    `角色回复：${text || "（没说话）"}`,
    h ? `角色的情绪/动作：心情 ${h.valence}，活力 ${h.arousal}，动作 ${h.action}` : "（缺少情绪/动作头）",
    `评判标准：${c.judge}`,
  ]
    .filter(Boolean)
    .join("\n");
  let raw = "";
  for await (const d of llm.stream(JUDGE_SYSTEM, [{ role: "user", content: ctx }], new AbortController().signal)) raw += d;
  try {
    const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    return { pass: !!j.pass, reason: String(j.reason ?? "") };
  } catch {
    return { pass: false, reason: `评审输出无法解析：${raw.slice(0, 80)}` };
  }
}

async function runCase(c: Case): Promise<Result> {
  const t0 = performance.now();
  try {
    const { header, text } = await ask(c);
    const failures = runCheck(c, header, text);
    const r: Result = { id: c.id, header, text, failures, ms: performance.now() - t0 };
    if (!NO_JUDGE && c.judge) r.judge = await judge(c, header, text);
    return r;
  } catch (e: any) {
    return { id: c.id, header: null, text: "", failures: [`异常：${e.message}`], ms: performance.now() - t0 };
  }
}
const runCheck = runChecks;

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    })
  );
  return out;
}

const selected = ONLY ? cases.filter((c) => ONLY.includes(c.id)) : cases;
console.log(`人格回归 · ${llm.name} · ${selected.length} 条${NO_JUDGE ? "（无评审）" : ""}\n`);
const results = await pool(selected, CONCURRENCY, runCase);

let failed = 0;
for (const r of results) {
  const hard = r.failures.length === 0;
  const soft = r.judge ? r.judge.pass : true;
  const ok = hard && soft;
  if (!ok) failed++;
  const h = r.header ? `v${r.header.valence.toFixed(1)} a${r.header.arousal.toFixed(1)} ${r.header.action}` : "无头";
  console.log(`${ok ? "✅" : "❌"} ${r.id.padEnd(22)} [${h}] ${r.text.replace(/\n/g, " ").slice(0, 60)}`);
  for (const f of r.failures) console.log(`     ✗ ${f}`);
  if (r.judge && !r.judge.pass) console.log(`     ✗ 评审：${r.judge.reason}`);
  else if (r.judge) console.log(`     ✓ 评审：${r.judge.reason}`);
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
writeFileSync(
  path.join(root, "persona/tests/last-report.json"),
  JSON.stringify({ at: new Date().toISOString(), provider: llm.name, results }, null, 2)
);
process.exit(failed ? 1 : 0);

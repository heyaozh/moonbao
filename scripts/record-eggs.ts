// 录彩蛋片（PLAN V9 验收夹具）：无头 Chrome 打开 ?scene=egg-<名字>&brain=off&panel=off&freeze，
// 页面里 __recordGif 逐帧截图落到 snaps/v9/<名字>/，再用 scripts/make-gif.py 出 MP4（snaps/v9/<名字>.mp4），
// --reel 把这一批拼成 snaps/v9/reel-<批>.mp4（scripts/reel.py，左上角写名字和触发方式）。
//   npm run record:eggs                       # catalog 里全部
//   npm run record:eggs -- --group A --reel   # 一批 + 集锦
//   npm run record:eggs -- --only secret,zzz  # 指定几条
//   npm run record:eggs -- --table            # 只打印 docs/checkpoint-v9.md 用的表
// 需要：Google Chrome（或 CHROME=可执行文件路径）、ffmpeg、python3。vite 没起的话自己起一个（端口 5178）。
// 改了参数想重录：同一条命令再跑一遍就行。

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { EGG_CATALOG, type EggGroup, type EggInfo } from "../web/eggs/catalog.js";

const args = process.argv.slice(2);
const opt = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (k: string) => args.includes(k);
const PORT = Number(opt("--port") ?? 5178);
const CDP_PORT = Number(opt("--cdp") ?? 9333);
const ROOT = process.cwd();

const group = opt("--group") as EggGroup | undefined;
const only = opt("--only")?.split(",").map((s) => s.trim()).filter(Boolean);
const list = EGG_CATALOG.filter((e) => (!group || e.group === group) && (!only || only.includes(e.name)));

if (has("--table")) {
  console.log("| # | 名字 | 怎么触发 | 片子 | 打分（✓ / ✗ / 改） | 一句话 |\n|---|---|---|---|---|---|");
  list.forEach((e, i) => console.log(`| ${e.group}${i + 1} | ${e.label} | ${e.how} | \`snaps/v9/${e.name}.mp4\` | | |`));
  process.exit(0);
}
if (!list.length) {
  console.error("没有匹配的彩蛋");
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function up(url: string, ms = 1500) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    return r.ok;
  } catch {
    return false;
  }
}

async function ensureVite(): Promise<ChildProcess | null> {
  if (await up(`http://localhost:${PORT}/`)) return null;
  console.log(`[record] 起 vite（端口 ${PORT}）…`);
  const p = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"] });
  p.stderr?.on("data", (d) => process.stderr.write(d));
  for (let i = 0; i < 80; i++) {
    await sleep(500);
    if (await up(`http://localhost:${PORT}/`)) return p;
  }
  throw new Error("vite 起不来");
}

function chromePath() {
  const c = [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].filter(Boolean) as string[];
  const f = c.find((x) => existsSync(x));
  if (!f) throw new Error("没找到 Chrome：设 CHROME=可执行文件路径");
  return f;
}

async function launchChrome() {
  const dir = mkdtempSync(path.join(tmpdir(), "moonbao-chrome-"));
  const p = spawn(
    chromePath(),
    [
      "--headless=new",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${dir}`,
      "--window-size=600,1000",
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--mute-audio",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );
  p.stderr?.on("data", () => undefined);
  let ok = false;
  for (let i = 0; i < 60 && !ok; i++) {
    await sleep(300);
    ok = await up(`http://localhost:${CDP_PORT}/json/version`);
  }
  if (!ok) throw new Error("Chrome 的调试口没开");
  const targets = (await (await fetch(`http://localhost:${CDP_PORT}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("Chrome 没有页面 target");
  return { proc: p, dir, wsUrl: page.webSocketDebuggerUrl };
}

/** 最小的 CDP 客户端：只要 Runtime.evaluate 和 Page.navigate */
class CDP {
  private id = 0;
  private pending = new Map<number, { ok: (v: any) => void; err: (e: Error) => void }>();
  private ws: WebSocket;
  onEvent: (m: any) => void = () => undefined;
  constructor(url: string) {
    this.ws = new WebSocket(url, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    this.ws.on("message", (d) => {
      const m = JSON.parse(d.toString());
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id)!;
        this.pending.delete(m.id);
        if (m.error) p.err(new Error(m.error.message));
        else p.ok(m.result);
      } else this.onEvent(m);
    });
  }
  ready() {
    return new Promise<void>((ok, err) => {
      this.ws.once("open", ok);
      this.ws.once("error", err);
    });
  }
  send(method: string, params: Record<string, unknown> = {}) {
    const id = ++this.id;
    return new Promise<any>((ok, err) => {
      this.pending.set(id, { ok, err });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval<T = unknown>(expression: string, awaitPromise = false): Promise<T> {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails));
    return r.result?.value as T;
  }
  close() {
    this.ws.close();
  }
}

async function recordOne(cdp: CDP, e: EggInfo) {
  const url = `http://localhost:${PORT}/?scene=egg-${e.name}&brain=off&panel=off&freeze&hour=22`;
  await cdp.send("Page.navigate", { url });
  const t0 = Date.now();
  for (;;) {
    const ok = await cdp
      .eval<boolean>(`typeof __recordGif === "function" && !!window.__app && __app.moon.body.ready && document.fonts.status === "loaded"`)
      .catch(() => false);
    if (ok) break;
    if (Date.now() - t0 > 40_000) throw new Error(`${e.name}: 页面 40 秒没就绪`);
    await sleep(300);
  }
  await sleep(600);
  const expr = `__recordGif(${JSON.stringify(`v9/${e.name}`)}, { seconds: ${e.seconds}, shake: ${!!e.shake}, fps: 15 })`;
  const r = await cdp.eval<string>(expr, true);
  process.stdout.write(`  ${e.name}: ${r}\n`);
  const mk = spawnSync("python3", ["scripts/make-gif.py", `v9/${e.name}`, "--no-gif"], { cwd: ROOT, stdio: "inherit" });
  if (mk.status !== 0) throw new Error(`make-gif 失败：${e.name}`);
}

async function main() {
  const vite = await ensureVite();
  const chrome = await launchChrome();
  const cdp = new CDP(chrome.wsUrl);
  let failed = 0;
  try {
    await cdp.ready();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    cdp.onEvent = (m) => {
      if (m.method === "Runtime.exceptionThrown") console.error("[page]", m.params.exceptionDetails?.exception?.description ?? "");
      if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") console.error("[page]", m.params.args?.map((a: any) => a.value ?? a.description).join(" "));
    };
    console.log(`[record] ${list.length} 条：${list.map((e) => e.name).join(" ")}`);
    for (const e of list) {
      try {
        await recordOne(cdp, e);
      } catch (err: any) {
        failed++;
        console.error(`[record] ${e.name} 失败：${err.message}`);
      }
    }
    if (has("--reel") && list.length - failed > 0) {
      const name = group ?? (only ? "custom" : "all");
      const items = list.filter((e) => existsSync(path.join(ROOT, "snaps/v9", `${e.name}.mp4`))).flatMap((e, i) => [e.name, `${e.label}|${e.how}`]);
      const r = spawnSync("python3", ["scripts/reel.py", "--out", `snaps/v9/reel-${name}.mp4`, ...items], { cwd: ROOT, stdio: "inherit" });
      if (r.status !== 0) console.error("[record] 拼集锦失败");
    }
  } finally {
    cdp.close();
    chrome.proc.kill();
    rmSync(chrome.dir, { recursive: true, force: true });
    vite?.kill();
  }
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

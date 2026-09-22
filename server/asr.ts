// ASR：本地 whisper.cpp 的 server 常驻模式（模型只加载一次，Metal 加速）。
// 由本进程托管 whisper-server 子进程；返回文字 + 词级置信度均值。
// 置信度是一等信号——低了角色会"歪头"反问，这是级联引擎相对 s2s 的独有优势。

import { spawn, type ChildProcess } from "node:child_process";

const PORT = Number(process.env.WHISPER_PORT ?? 8790);

export interface ASRResult {
  text: string;
  confidence: number; // 0..1，词概率均值
}

let proc: ChildProcess | null = null;
let ready: Promise<void> | null = null;

function ensureServer(): Promise<void> {
  if (ready) return ready;
  const bin = process.env.WHISPER_BIN ?? "whisper-server";
  const model = process.env.WHISPER_MODEL ?? "models/ggml-large-v3-turbo-q5_0.bin";
  const lang = process.env.WHISPER_LANG ?? "zh";

  proc = spawn(bin, ["-m", model, "-l", lang, "--port", String(PORT), "-bs", "3"], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  proc.stderr?.on("data", (d) => (stderr = (stderr + d).slice(-2000)));
  proc.on("exit", (code) => {
    console.error(`[asr] whisper-server exited (${code}): ${stderr.slice(-300)}`);
    proc = null;
    ready = null; // 下次调用时重启
  });
  process.on("exit", () => proc?.kill());

  ready = (async () => {
    for (let i = 0; i < 120; i++) {
      if (!proc) throw new Error(`whisper-server 启动失败: ${stderr.slice(-300)}`);
      try {
        await fetch(`http://127.0.0.1:${PORT}/`, { method: "GET" });
        console.log("[asr] whisper-server ready");
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    throw new Error("whisper-server 启动超时");
  })();
  return ready;
}

export async function transcribe(wav: Buffer): Promise<ASRResult> {
  await ensureServer();
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "utt.wav");
  form.append("response_format", "verbose_json");

  const res = await fetch(`http://127.0.0.1:${PORT}/inference`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(`whisper-server HTTP ${res.status}`);
  const json: any = await res.json();

  const text = String(json.text ?? "").replace(/\n/g, "").trim();
  const probs: number[] = (json.segments ?? []).flatMap((s: any) =>
    (s.words ?? [])
      .filter((w: any) => typeof w.probability === "number")
      .map((w: any) => w.probability)
  );
  const confidence =
    probs.length > 0 ? probs.reduce((a, b) => a + b, 0) / probs.length : 0;
  return { text, confidence };
}

/** 服务启动时预热（可选调用）：提前加载模型，首句不吃冷启动 */
export function warmup() {
  ensureServer().catch((e) => console.error("[asr] warmup:", e.message));
}

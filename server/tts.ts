// TTS 适配层：none（默认：它不说话，文字/星星拼字）/ edge（微软免费语音）/ openai。
// 输入一句文本，输出一段完整 mp3。真人声是付费选项，.env 里 TTS_PROVIDER=edge|openai 即可打开。

import { EdgeTTS } from "@andresaya/edge-tts";
import OpenAI from "openai";

export interface TTSProvider {
  name: string;
  synth(text: string, signal: AbortSignal): Promise<Buffer>;
}

export class EdgeTTSProvider implements TTSProvider {
  name = "edge";
  constructor(private voice: string) {}

  async synth(text: string, signal: AbortSignal): Promise<Buffer> {
    if (signal.aborted) throw new Error("aborted");
    const tts = new EdgeTTS();
    // 语速偏慢：夜里的月亮不着急
    await tts.synthesize(text, this.voice, { rate: "-8%" });
    if (signal.aborted) throw new Error("aborted");
    return tts.toBuffer();
  }
}

export class OpenAITTSProvider implements TTSProvider {
  name = "openai";
  private client = new OpenAI();
  constructor(private voice: string) {}

  async synth(text: string, signal: AbortSignal): Promise<Buffer> {
    const res = await this.client.audio.speech.create(
      {
        model: "gpt-4o-mini-tts",
        voice: this.voice,
        input: text,
        instructions:
          "一个安静的小月亮在夜里轻声说话：语速偏慢，声音轻而柔，带一点睡意，不夸张。",
        response_format: "mp3",
      },
      { signal }
    );
    return Buffer.from(await res.arrayBuffer());
  }
}

/** 返回 null 表示不出声（默认） */
export function createTTS(): TTSProvider | null {
  const which = process.env.TTS_PROVIDER ?? "none";
  if (which === "none" || which === "off") return null;
  if (which === "openai") {
    return new OpenAITTSProvider(process.env.OPENAI_TTS_VOICE ?? "coral");
  }
  return new EdgeTTSProvider(process.env.EDGE_TTS_VOICE ?? "zh-CN-XiaoyiNeural");
}

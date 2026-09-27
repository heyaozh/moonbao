// 麦克风：音量（驱动语音黑洞的漩涡）+ 录成 16 kHz 单声道 WAV（送本机 whisper 识别）。
// 用 ScriptProcessor 收 PCM：老，但 iOS Safari / WKWebView 都支持；数据量很小，够用。
// 静音自动停：说过话之后安静 silenceMs，回调 onSilence（按住 voice 的话由松手结束，不走这里）。

export class Mic {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private proc: ScriptProcessorNode | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private chunks: Float32Array[] = [];
  private rms = 0;
  private spoke = false;
  private quietSince = 0;
  onSilence?: () => void;
  silenceMs = 1400;
  /** 说话的阈值（RMS） */
  threshold = 0.02;

  get active() {
    return this.proc != null;
  }

  async start(): Promise<boolean> {
    if (this.active) return true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      console.warn("[mic] 没拿到麦克风：", e);
      return false;
    }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new AC();
    await this.ctx.resume();
    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.proc = this.ctx.createScriptProcessor(2048, 1, 1);
    this.chunks = [];
    this.spoke = false;
    this.quietSince = performance.now();
    this.proc.onaudioprocess = (e) => {
      const x = e.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(x));
      let s = 0;
      for (let i = 0; i < x.length; i++) s += x[i] * x[i];
      const r = Math.sqrt(s / x.length);
      this.rms = this.rms * 0.7 + r * 0.3;
      const now = performance.now();
      if (r > this.threshold) {
        this.spoke = true;
        this.quietSince = now;
      } else if (this.spoke && now - this.quietSince > this.silenceMs) {
        this.onSilence?.();
      }
    };
    this.src.connect(this.proc);
    this.proc.connect(this.ctx.destination);
    return true;
  }

  /** 0..1 的音量（给画面用，已压缩） */
  level() {
    return Math.min(1, Math.sqrt(this.rms) * 2.2);
  }

  /** 停止并返回 WAV（没说话 / 太短 = null） */
  async stop(): Promise<{ wav: ArrayBuffer; seconds: number } | null> {
    const ctx = this.ctx;
    const rate = ctx?.sampleRate ?? 48000;
    this.proc?.disconnect();
    this.src?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.proc = null;
    this.src = null;
    this.stream = null;
    this.rms = 0;
    await ctx?.close().catch(() => undefined);
    this.ctx = null;
    const n = this.chunks.reduce((a, c) => a + c.length, 0);
    const seconds = n / rate;
    if (!this.spoke || seconds < 0.35) return null;
    const all = new Float32Array(n);
    let o = 0;
    for (const c of this.chunks) {
      all.set(c, o);
      o += c.length;
    }
    this.chunks = [];
    return { wav: encodeWav(downsample(all, rate, 16000), 16000), seconds };
  }
}

function downsample(x: Float32Array, from: number, to: number) {
  if (from === to) return x;
  const ratio = from / to;
  const n = Math.floor(x.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // 简单的盒式平均，防一点混叠
    const a = Math.floor(i * ratio);
    const b = Math.min(x.length, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let j = a; j < b; j++) s += x[j];
    out[i] = s / Math.max(1, b - a);
  }
  return out;
}

function encodeWav(x: Float32Array, rate: number) {
  const buf = new ArrayBuffer(44 + x.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + x.length * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, x.length * 2, true);
  for (let i = 0; i < x.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x[i])) * 0x7fff, true);
  return buf;
}

export function toBase64(buf: ArrayBuffer) {
  let s = "";
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

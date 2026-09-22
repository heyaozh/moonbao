// WebAudio 播放队列：按 seq 顺序播放各句 mp3；提供实时能量（驱动说话时的身体动作）。
// 打断 = stopAll()：立即停声并清队列。
// 真人声是可选付费通道；默认它不说话。

export class SpeechAudio {
  private ctx = new AudioContext();
  private analyser: AnalyserNode;
  private freqData: Uint8Array<ArrayBuffer>;
  private queue: { seq: number; buf: AudioBuffer }[] = [];
  private nextSeq = 0;
  private gen = -1;
  private source: AudioBufferSourceNode | null = null;

  /** 每轮回复第一声开播时回调（测延迟用） */
  onPlayStart: (() => void) | null = null;
  /** 队列播空时回调 */
  onDrain: (() => void) | null = null;

  constructor() {
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.6;
    this.analyser.connect(this.ctx.destination);
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
  }

  async resume() {
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  async enqueue(gen: number, seq: number, mp3Base64: string) {
    if (gen !== this.gen) {
      this.stopAll();
      this.gen = gen;
    }
    const bytes = Uint8Array.from(atob(mp3Base64), (c) => c.charCodeAt(0));
    let buf: AudioBuffer;
    try {
      buf = await this.ctx.decodeAudioData(bytes.buffer);
    } catch {
      return; // 解码失败跳过该句
    }
    if (gen !== this.gen) return; // 解码期间被打断
    this.queue.push({ seq, buf });
    this.queue.sort((a, b) => a.seq - b.seq);
    this.pump();
  }

  stopAll() {
    try {
      this.source?.stop();
    } catch {}
    this.source = null;
    this.queue = [];
    this.nextSeq = 0;
  }

  /** 当前输出能量 0..1（说话动作驱动） */
  get energy(): number {
    if (!this.source) return 0;
    this.analyser.getByteFrequencyData(this.freqData);
    let sum = 0;
    // 语音主要能量在低中频，取前 1/3 频段
    const n = Math.floor(this.freqData.length / 3);
    for (let i = 0; i < n; i++) sum += this.freqData[i];
    return Math.min(1, sum / n / 160);
  }

  get playing(): boolean {
    return this.source !== null;
  }

  private pump() {
    if (this.source) return;
    const next = this.queue[0];
    if (!next || next.seq !== this.nextSeq) return;
    this.queue.shift();
    if (next.seq === 0) this.onPlayStart?.();
    this.nextSeq++;
    const src = this.ctx.createBufferSource();
    src.buffer = next.buf;
    src.connect(this.analyser);
    src.onended = () => {
      if (this.source === src) {
        this.source = null;
        this.pump();
        if (!this.source && this.queue.length === 0) this.onDrain?.();
      }
    };
    this.source = src;
    src.start();
  }
}

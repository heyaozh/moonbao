// 声音（2026-09-26 用户第 7 点：星星生成文字、待机等时候都需要音效或背景音，要合适、放松）。
// 全部 Web Audio 实时合成，零音频素材（没有版权问题，也不用下载）：
//   氛围层：很低的 pad + 太空风 + 随机的钟琴单音（五声音阶；夜里偏 Lydian 更梦幻；难过时换小调），永不重复
//   事件音：流星、光点写字（每个字一个音，一句话是一小段旋律）、戳、撞墙、黑洞嗡鸣与漩涡、识别完成、发送、玻璃按钮、晕
// 坦白：agent 听不见，这里只能按合成参数推理；所有数值在 params.sound，交给用户调。

import { params } from "../moon/params";

type Scale = number[];
// 以半音表示、相对根音
const MAJOR_PENTA: Scale = [0, 2, 4, 7, 9];
const LYDIAN_PENTA: Scale = [0, 2, 4, 6, 9, 11];
const MINOR_PENTA: Scale = [0, 3, 5, 7, 10];

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private ambBus!: GainNode;
  private sfxBus!: GainNode;
  private reverb!: ConvolverNode;
  private revSend!: GainNode;
  private pad: { oscs: OscillatorNode[]; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private wind: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private hole: { gain: GainNode; filter: BiquadFilterNode; osc: OscillatorNode } | null = null;
  private nextChime = 3;
  private t = 0;
  private glyphIdx = 0;
  private lastGlyphAt = 0;
  /** 情绪（-1..1）：影响音阶 */
  mood = 0.3;
  night = 1;
  enabled = true;

  /** 第一次触碰后调用（浏览器要求用户手势才能出声） */
  async unlock() {
    if (this.ctx) {
      if (this.ctx.state !== "running") await this.ctx.resume().catch(() => undefined);
      return;
    }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(comp).connect(ctx.destination);
    this.ambBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.ambBus.connect(this.master);
    this.sfxBus.connect(this.master);
    // 混响：程序生成的脉冲响应（指数衰减的噪声），给星空的空旷感
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.6);
    this.revSend = ctx.createGain();
    this.revSend.gain.value = 0.55;
    this.revSend.connect(this.reverb).connect(this.master);
    this.startAmbient();
    this.applyVolumes();
    this.master.gain.linearRampToValueAtTime(1, ctx.currentTime + 2.5);
  }

  private impulse(seconds: number) {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.6);
    }
    return buf;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const S = params.sound;
    const now = this.ctx.currentTime;
    const on = this.enabled && !S.muted ? 1 : 0;
    this.ambBus.gain.setTargetAtTime(S.ambient * on, now, 0.3);
    this.sfxBus.gain.setTargetAtTime(S.sfx * on, now, 0.1);
  }

  private scale(): Scale {
    if (this.mood < -0.25) return MINOR_PENTA;
    return this.night > 0.5 ? LYDIAN_PENTA : MAJOR_PENTA;
  }

  private note(i: number, octave: number) {
    const sc = this.scale();
    const root = params.sound.rootMidi;
    const k = ((i % sc.length) + sc.length) % sc.length;
    const o = Math.floor(i / sc.length);
    return root + sc[k] + 12 * (octave + o);
  }

  // ───────────── 氛围层 ─────────────
  private startAmbient() {
    const ctx = this.ctx!;
    // pad：根音、五度、九度，轻微失谐，很慢的呼吸
    const g = ctx.createGain();
    g.gain.value = 0.0;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 700;
    f.Q.value = 0.4;
    const root = params.sound.rootMidi - 12;
    const oscs = [0, 7, 14, 19].map((iv, i) => {
      const o = ctx.createOscillator();
      o.type = i % 2 ? "triangle" : "sine";
      o.frequency.value = mtof(root + iv);
      o.detune.value = (Math.random() - 0.5) * 12;
      const og = ctx.createGain();
      og.gain.value = [0.5, 0.3, 0.18, 0.1][i];
      o.connect(og).connect(f);
      o.start();
      return o;
    });
    f.connect(g);
    g.connect(this.ambBus);
    g.connect(this.revSend);
    g.gain.linearRampToValueAtTime(params.sound.padLevel, ctx.currentTime + 6);
    this.pad = { oscs, gain: g, filter: f };
    // 太空风：带通噪声，中心频率慢慢游走
    const noise = ctx.createBufferSource();
    const nb = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noise.buffer = nb;
    noise.loop = true;
    const wf = ctx.createBiquadFilter();
    wf.type = "bandpass";
    wf.frequency.value = 500;
    wf.Q.value = 0.8;
    const wg = ctx.createGain();
    wg.gain.value = 0;
    noise.connect(wf).connect(wg).connect(this.ambBus);
    wg.connect(this.revSend);
    noise.start();
    wg.gain.linearRampToValueAtTime(params.sound.windLevel, ctx.currentTime + 8);
    this.wind = { gain: wg, filter: wf };
  }

  /** 钟琴 / 钢片琴的一个音：FM（载波 + 调制比 3.5 的调制器），长尾进混响 */
  private bell(midi: number, vel: number, when = 0, bus: "amb" | "sfx" = "amb", decay = 2.6) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const f = mtof(midi);
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const mg = ctx.createGain();
    car.frequency.value = f;
    mod.frequency.value = f * 3.5;
    mg.gain.setValueAtTime(f * 1.6 * vel, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.05 + 0.01, t + 0.6);
    mod.connect(mg).connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18 * vel, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() - 0.5) * 0.8;
    car.connect(g).connect(pan);
    pan.connect(bus === "amb" ? this.ambBus : this.sfxBus);
    pan.connect(this.revSend);
    car.start(t);
    mod.start(t);
    car.stop(t + decay + 0.1);
    mod.stop(t + decay + 0.1);
  }

  update(dt: number) {
    if (!this.ctx) return;
    this.t += dt;
    const now = this.ctx.currentTime;
    // pad 与风的呼吸
    if (this.pad) this.pad.filter.frequency.setTargetAtTime(560 + 260 * Math.sin(this.t * 0.07) + 140 * this.night, now, 1.5);
    if (this.wind) this.wind.filter.frequency.setTargetAtTime(420 + 300 * Math.sin(this.t * 0.043 + 1.3), now, 2);
    // 随机的钟琴单音
    this.nextChime -= dt;
    if (this.nextChime <= 0) {
      this.nextChime = params.sound.chimeMin + Math.random() * (params.sound.chimeMax - params.sound.chimeMin);
      const n = Math.floor(Math.random() * 7);
      this.bell(this.note(n, 1), 0.35 + Math.random() * 0.25, 0, "amb", 3.4);
      if (Math.random() < 0.3) this.bell(this.note(n + 2, 1), 0.2, 0.35 + Math.random() * 0.3, "amb", 3);
    }
    // 黑洞：随音量调滤波
    if (this.hole) this.hole.filter.frequency.setTargetAtTime(180 + this.holeLevel * 900, now, 0.08);
  }

  // ───────────── 事件音 ─────────────
  private noiseBurst(from: number, to: number, dur: number, vel: number, q = 1.2) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    const nb = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    src.buffer = nb;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25 * vel, t + dur * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const pan = ctx.createStereoPanner();
    pan.pan.setValueAtTime((Math.random() - 0.5) * 1.2, t);
    src.connect(f).connect(g).connect(pan);
    pan.connect(this.sfxBus);
    pan.connect(this.revSend);
    src.start(t);
  }

  meteor() {
    this.noiseBurst(3200, 500, 0.9, 0.45, 1.6);
  }

  /** 光点写字：每个字一个音，一句话是一小段旋律（五声音阶上走走停停） */
  glyph() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastGlyphAt < 0.07) return;
    this.lastGlyphAt = now;
    const walk = [0, 1, 2, 1, 3, 2, 4, 3, 5, 4, 2, 3];
    const n = walk[this.glyphIdx++ % walk.length] + (this.glyphIdx % 24 > 12 ? 2 : 0);
    this.bell(this.note(n, 2), 0.28, 0, "sfx", 1.6);
  }
  resetGlyphs() {
    this.glyphIdx = 0;
  }

  private tone(from: number, to: number, dur: number, vel: number, type: OscillatorType = "sine") {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3 * vel, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfxBus);
    g.connect(this.revSend);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** 戳：软软的一声「噗」 */
  poke() {
    this.tone(880, 280, 0.12, 0.6);
    this.noiseBurst(2400, 900, 0.07, 0.15, 2);
  }
  /** 撞墙：闷闷的弹一下，越快越响 */
  bounce(speed: number) {
    const v = Math.min(1, speed / 5);
    this.tone(210, 95, 0.22, 0.35 + 0.5 * v);
    this.tone(420, 210, 0.12, 0.12 * v, "triangle");
  }
  grab() {
    this.tone(520, 660, 0.08, 0.25);
  }
  release(speed: number) {
    if (speed > 1.5) this.noiseBurst(600, 2000, 0.35, Math.min(1, speed / 6) * 0.5, 1);
  }
  dizzy() {
    const ctx = this.ctx;
    if (!ctx) return;
    for (let i = 0; i < 4; i++) this.bell(this.note(4 - i, 1), 0.25, i * 0.09, "sfx", 1.2);
  }
  /** 发送：一阵往上走的风 + 一个小钟 */
  send() {
    this.noiseBurst(500, 2400, 0.45, 0.35, 1.1);
    this.bell(this.note(3, 2), 0.2, 0.25, "sfx", 1.4);
  }
  /** 识别完成 / 许愿：细碎的闪光（三个音往上走） */
  shimmer() {
    [0, 2, 4].forEach((n, i) => this.bell(this.note(n + 5, 2), 0.2, i * 0.07, "sfx", 1.8));
  }
  tick() {
    this.noiseBurst(4200, 3000, 0.04, 0.2, 4);
  }
  /** 吹气：一阵风 */
  gust(k = 1) {
    this.noiseBurst(300, 1600, 0.55, 0.35 * Math.min(1, k), 0.7);
  }
  /** 咯咯笑：几个很快的小音上去再下来 */
  giggle() {
    [0, 2, 4, 2, 4].forEach((n, i) => this.bell(this.note(n + 7, 2), 0.13, i * 0.06, "sfx", 2.2));
  }
  /** 点星空亮起小月亮：一个很轻的高音 */
  wisp() {
    this.bell(this.note(7, 2), 0.13, 0, "sfx", 1.6);
  }

  // ───────────── 黑洞（语音） ─────────────
  private holeLevel = 0;
  holeStart() {
    const ctx = this.ctx;
    if (!ctx || this.hole) return;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 55;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 200;
    const g = ctx.createGain();
    g.gain.value = 0;
    osc.connect(f).connect(g).connect(this.sfxBus);
    g.connect(this.revSend);
    osc.start();
    g.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 0.6);
    this.hole = { gain: g, filter: f, osc };
  }
  holeLevelSet(v: number) {
    this.holeLevel = v;
  }
  holeStop() {
    const ctx = this.ctx;
    if (!ctx || !this.hole) return;
    const h = this.hole;
    this.hole = null;
    h.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
    h.osc.stop(ctx.currentTime + 1.2);
  }
}

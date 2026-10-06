// 对话画面的总调度：一轮 = 你的黑洞气泡 + 它的光点字。
// 新一轮出现时，旧的沿 S 形退向深处（变小、变淡、变冷），中间夹着星星；上下拖 / 滚轮把远处的字拉近（2026-09-26 用户第 5 点）。
// 最新一轮在前景场景（气泡要采样背景做透镜）；退下去的挪到背景场景，气泡换便宜版。

import * as THREE from "three";
import type { App } from "../app/app";
import { params } from "../moon/params";
import { BlackHoleBubble } from "./bubble";
import { ThinkingFX } from "./thinking";
import { MoonText } from "./writer";

class Exchange {
  readonly group = new THREE.Group();
  bubble: BlackHoleBubble | null = null;
  text: MoonText | null = null;
  index = 0;
  shown = 0;
  inBack = false;
  born = 0;
  bubbleText = "";
  voice = false;
  /** 打字时的小黑洞（还没发出去的一轮） */
  draft = false;
  /** 它这一轮的话已经说完 */
  moonDone = false;
  /** 排版后需要整体上移多少（字太长压到输入框时） */
  lift = 0;
  /** 这一轮在窗平面上的总高度（气泡 + 字），往上叠历史用 */
  winH = 0.6;
  /** 这一轮顶边在窗平面上的高度（最新时） */
  top = 0.5;
}

export class ChatView {
  readonly thinking = new ThinkingFX();
  private ex: Exchange[] = [];
  private t = 0;
  scroll = 0;
  scrollTarget = 0;
  private lastChatAt = -1e9;
  private histStars: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private lookUntil = 0;
  /** 写字时每个字的回调（声音） */
  onGlyph?: () => void;
  /** 语音时的音量（0..1），驱动黑洞的漩涡与生长 */
  private voiceLevel = 0;
  private voiceStart = 0;
  /** 打字时的小黑洞：想要（输入框里有字）/ 已经有了 / 每敲一个字跳一下 */
  private draftWant = false;
  private draftEx: Exchange | null = null;
  private draftPulse = 0;
  /** 收回去的黑洞：缩成一点再拿掉 */
  private dying: Exchange[] = [];

  constructor(private app: App) {
    const s = app.stage;
    s.front.add(this.thinking.gather, this.thinking.dots, this.thinking.question);
    this.histStars = makeHistoryStars();
    s.back.add(this.histStars);
  }

  get now() {
    return this.t;
  }
  get current(): Exchange | null {
    return this.ex[0] ?? null;
  }
  get count() {
    return this.ex.length;
  }

  /** 画布像素 → 世界单位（在某个深度上，让字在屏幕上是想要的像素大小） */
  unitsPerPx(depth: number, S: number) {
    const cam = this.app.stage.cam;
    const cssPerUnit = this.app.stage.height / (2 * cam.halfH);
    return ((cam.eyeZ + depth) / cam.eyeZ) / (cssPerUnit * S);
  }

  private textScale() {
    return Math.min(3, (devicePixelRatio || 1) * 1.25);
  }

  /** 开一轮新对话。userText = null：它主动开口（没有气泡，走隆重档）。 */
  startExchange(userText: string | null, opts: { grand?: boolean; voice?: boolean; draft?: boolean } = {}): Exchange {
    const now = this.t;
    this.lastChatAt = now;
    // 打字时已经有一个小黑洞：发出去 = 字凝结进这个黑洞，它长成气泡（不另开一轮）
    if (userText != null && this.draftEx) {
      const e = this.draftEx;
      this.draftEx = null;
      this.draftWant = false;
      e.draft = false;
      e.born = now;
      this.setBubbleText(e, userText);
      if (e.bubble) {
        this.app.moon.lookTarget = e.bubble.mesh.getWorldPosition(new THREE.Vector3());
        this.app.moon.lookWeight = 0.55;
        this.lookUntil = now + 1.4;
      }
      return e;
    }
    // 上一轮它还没说完（你抢话了）：那句收尾留在原来那一轮里，后面流进来的字不会串到新的一轮
    const cur = this.ex[0];
    if (cur && cur.text && !cur.moonDone) {
      cur.moonDone = true;
      let full = (cur.text.hintText ?? cur.text.fullText).trimEnd();
      // 被打断的半句：退回上一个词边界，加省略号（「Rest here a mome」→「Rest here a…」）
      if (!cur.text.hintText && full && !/[.!?。！？…~～]$/.test(full)) {
        const cut = /[\u3400-\u9fff]$/.test(full) ? full : full.replace(/\s+\S*$/, "");
        full = (cut || full).replace(/[\s,，、;；:：]+$/, "") + "…";
      }
      if (full) void cur.text.setText(full, true, now).then(() => this.layout(cur));
    }
    // 旧的往后退一格
    for (const e of this.ex) e.index += 1;
    const e = new Exchange();
    e.born = now;
    this.ex.unshift(e);
    this.scrollTarget = 0;
    const s = this.app.stage;
    s.front.add(e.group);
    const cam = s.cam;
    if (userText != null || opts.voice || opts.draft) {
      e.bubble = new BlackHoleBubble(() => s.rtBack.texture);
      e.group.add(e.bubble.mesh);
      e.voice = !!opts.voice;
      e.draft = !!opts.draft;
      if (userText) this.setBubbleText(e, userText);
      else {
        e.bubble.setHalf(0.06, 0.06);
        e.bubble.form = 0;
        e.bubble.formTo(0.001);
      }
      e.bubble.form = 0;
      e.bubble.formTo(1);
    }
    // 月亮的字（先建好，等流式文字）
    const W = params.writer;
    const S = this.textScale();
    const upp = this.unitsPerPx(W.depth, S);
    const style = { en: W.enPx * S, zh: W.zhPx * S, lineHeight: W.lineHeight, maxWidth: W.maxWidth * cam.halfW * 2 * (s.height / (2 * cam.halfH)) * S };
    e.text = new MoonText(
      {
        unitsPerPx: upp,
        moonCenter: this.app.moon.center,
        takeGathered: () => this.thinking.take(),
      },
      style
    );
    // 隆重档（远方流星）只给明确要求的；它主动开口的短句在 moonSay 里按预告长度决定
    e.text.grand = !!opts.grand;
    e.text.onGlyph = () => this.onGlyph?.();
    e.text.group.rotation.z = THREE.MathUtils.degToRad(W.tiltDeg);
    e.group.add(e.text.group);
    this.layout(e);
    // 月亮：给字让位（飘到聊天位），看你的气泡
    this.app.moon.chatMode = true;
    if (e.bubble) {
      this.app.moon.lookTarget = e.bubble.mesh.getWorldPosition(new THREE.Vector3());
      this.app.moon.lookWeight = 0.55;
      this.lookUntil = now + 1.4;
    }
    // 空间里最多留 keep 轮
    while (this.ex.length > params.chat.keep) this.dispose(this.ex.pop()!);
    return e;
  }

  private setBubbleText(e: Exchange, text: string) {
    const B = params.bubble;
    const cam = this.app.stage.cam;
    const cssPerUnit = this.app.stage.height / (2 * cam.halfH);
    e.bubbleText = text;
    // 气泡里的字按 CSS 像素排版：传「每 CSS 像素多少世界单位」
    e.bubble!.setText(text, this.unitsPerPx(B.depth, 1), B.maxWidth * cam.halfW * 2 * cssPerUnit);
    this.layout(e);
  }

  /** 语音：开一个会长大的小黑洞（打字的小黑洞已经在了，就用它） */
  startVoice() {
    this.voiceStart = this.t;
    this.voiceLevel = 0;
    if (this.draftEx) {
      const e = this.draftEx;
      this.draftEx = null;
      this.draftWant = false;
      e.draft = false;
      e.voice = true;
      return e;
    }
    return this.startExchange(null, { voice: true });
  }

  /** 输入框里有没有字：有 → 冒出一个小黑洞（等它把话说完再冒，不打断它）；删空 → 收回去 */
  setDraft(on: boolean) {
    this.draftWant = on;
  }
  /** 敲了一个字：小黑洞跳一下 */
  pulseDraft() {
    this.draftPulse = 1;
  }

  private cancelDraft() {
    const e = this.draftEx;
    this.draftEx = null;
    if (!e) return;
    const i = this.ex.indexOf(e);
    if (i >= 0) {
      this.ex.splice(i, 1);
      for (const x of this.ex) if (x.index > e.index) x.index -= 1;
    }
    e.bubble?.formTo(0);
    this.dying.push(e);
  }
  setVoiceLevel(v: number) {
    this.voiceLevel = v;
  }
  /** 识别出来了：字凝结进黑洞，黑洞缩放成刚好装下字的气泡 */
  finishVoice(text: string) {
    const e = this.ex.find((x) => x.voice && !x.bubbleText);
    if (!e || !e.bubble) return;
    e.voice = false;
    this.setBubbleText(e, text);
    if (e.text) e.text.grand = false;
  }
  cancelVoice() {
    const e = this.ex.find((x) => x.voice && !x.bubbleText);
    if (e) {
      this.ex.splice(this.ex.indexOf(e), 1);
      for (const x of this.ex) if (x.index > e.index) x.index -= 1;
      this.dispose(e);
    }
  }

  private pendingHint: { length: number; text?: string } | null = null;
  /** 演示剧本预告下一句的长度（和全文） */
  hint(length: number, text?: string) {
    this.pendingHint = { length, text };
  }

  /** 让当前这一轮它的话走隆重档（秘密彩蛋）：要在第一个字到达之前调用 */
  markGrand() {
    const e = this.current;
    if (e?.text && !e.text.fullText) e.text.grand = true;
  }

  /** 它说的话（流式全文）。没有当前轮就开一轮（主动开口）。 */
  moonSay(full: string, done: boolean) {
    // 你在打字、它却先开口（主动说话）：小黑洞先收回去，等它说完再冒
    if (this.draftEx) this.cancelDraft();
    let e = this.current;
    // 这一轮它已经说完了（例如主动开口、久别归来）→ 开新的一轮，没有气泡
    if (!e || e.moonDone || e.voice) e = this.startExchange(null);
    if (!e.text) return;
    if (this.pendingHint != null && !e.text.fullText) {
      e.text.hintLength = this.pendingHint.length;
      e.text.hintText = this.pendingHint.text ?? null;
      // 它主动说的短句（≤ 20 字）走隆重档：远方流星、写得大
      if (!e.bubble && this.pendingHint.length <= 20) e.text.grand = true;
      this.pendingHint = null;
    }
    if (done) e.moonDone = true;
    this.lastChatAt = this.t;
    const ex = e;
    void e.text.setText(full, done, this.t).then(() => this.layout(ex));
  }

  setThinking(on: boolean) {
    const cam = this.app.stage.cam;
    this.thinking.setThinking(on, { w: cam.halfW, h: cam.halfH });
  }

  /** 排版一轮：以这一轮的顶边为原点（往深处退时围绕自己缩放，不会和别的轮上下错位）。
   *  气泡靠右、字在下面；太长就整体上移，别压到输入框。 */
  private layout(e: Exchange) {
    const cam = this.app.stage.cam;
    const C = params.chat;
    const d0 = params.writer.depth;
    const s = (cam.eyeZ + d0) / cam.eyeZ;
    const halfW = cam.halfW * s;
    const halfH = cam.halfH * s;
    let y = 0;
    if (e.bubble) {
      const b = e.bubble;
      b.mesh.position.set(halfW * 0.9 - b.half.x - 0.04, -b.half.y, 0);
      y = -b.half.y * 2 - 0.1;
    }
    if (e.text) {
      // 没有气泡（它主动开口）：从 textTopY 那一行开始写
      const top0 = e.bubble ? C.bubbleY * halfH : C.textTopY * halfH;
      const textTop = e.bubble ? Math.min(C.textTopY * halfH - top0, y) : 0;
      // 放大过的短句（「moonbao」那种）居中写
      const x0 = e.text.isBig ? -e.text.estWidth / 2 : -halfW * 0.84;
      e.text.group.position.set(x0, textTop, 0);
      const bottom = top0 + textTop - (e.text.height || 0) - 0.05;
      const floor = -halfH * 0.74;
      e.lift = Math.max(0, floor - bottom) / s;
      e.top = top0 / s;
      e.winH = Math.max(0.3, top0 - bottom) / s;
    }
  }

  /** 滚动历史：正 = 把远处的拉近 */
  scrollBy(delta: number) {
    this.scrollTarget = THREE.MathUtils.clamp(this.scrollTarget + delta, -1.2, Math.max(0, this.ex.length - 1));
    this.lastChatAt = this.t;
  }

  update(dt: number) {
    this.t += dt;
    const app = this.app;
    const s = app.stage;
    const cam = s.cam;
    const C = params.chat;
    const b = s.bufferSize;
    const pr = s.pixelRatio;
    // 很久没说话：月亮回家，历史往后退一点，别挡着它
    const idle = this.t - this.lastChatAt > C.idleReturn;
    if (idle && app.moon.chatMode) {
      app.moon.chatMode = false;
      this.scrollTarget = -1.2;
    }
    this.scroll += (this.scrollTarget - this.scroll) * (1 - Math.exp(-dt * 4));

    // 打字时的小黑洞：它还在说 / 在想 / 你在说话时先不冒（不打断它）；删空了就收回去
    if (this.draftWant && !this.draftEx) {
      const cur = this.current;
      const busy = !!cur && (cur.voice || (!cur.moonDone && this.t - cur.born < 20));
      if (!busy) this.draftEx = this.startExchange(null, { draft: true });
    } else if (!this.draftWant && this.draftEx) this.cancelDraft();
    this.draftPulse = Math.max(0, this.draftPulse - dt * 3.5);
    for (const e of [...this.dying]) {
      e.bubble?.update(dt, this.t, b.w, b.h, (b.h / (2 * cam.halfH)) * (cam.eyeZ / (cam.eyeZ + params.writer.depth)), 0);
      if (!e.bubble || e.bubble.form < 0.03) {
        this.dying.splice(this.dying.indexOf(e), 1);
        this.dispose(e);
      }
    }

    // 往上叠：第 k 轮的顶 = 第 k-1 轮的顶 + 第 k 轮自己（按它那个深度缩小后）的高度 + 一点空隙
    const shrinkAt = (k: number) => (cam.eyeZ + params.writer.depth) / (cam.eyeZ + params.writer.depth + C.stepDepth * Math.max(0, k));
    const cum: number[] = [0];
    for (let i = 1; i <= this.ex.length; i++) {
      const e = this.ex[Math.min(i, this.ex.length - 1)];
      cum.push(cum[i - 1] + (e.winH * shrinkAt(i) + C.stepUp * 0.2) * (i < this.ex.length ? 1 : 1));
    }
    const stackAt = (k: number) => {
      if (k <= 0) return k * (cum[1] ?? 0.8);
      const i = Math.min(Math.floor(k), cum.length - 2);
      return cum[i] + (cum[i + 1] - cum[i]) * (k - i);
    };
    for (const e of this.ex) {
      e.shown += (e.index - e.shown) * (1 - Math.exp(-dt * 2.4));
      const k = e.shown - this.scroll;
      // 位置：往上叠、往右偏、退向深处
      const z = -params.writer.depth - C.stepDepth * Math.max(k, -0.3);
      const sk = (cam.eyeZ - z) / cam.eyeZ;
      const x = (0.2 * THREE.MathUtils.clamp(k, 0, 2.5) + C.swayX * Math.sin(k * 1.3) * 0.5) * cam.halfW;
      const base = this.ex[0] ? this.ex[0].top + this.ex[0].lift : e.top;
      const y = (base + stackAt(k)) * sk;
      e.group.position.set(x, y, z);
      let op = Math.max(0, 1 - C.fadePerStep * Math.max(0, k));
      if (k < 0) op *= Math.max(0, 1 + k * 2.2); // 拉到玻璃前面的淡出
      const cool = Math.min(1, C.coolPerStep * Math.max(0, k));
      // 退下去（k > 0.45）挪到背景场景，气泡换便宜版、开深度测试（会被月亮挡住）
      const shouldBack = k > 0.45;
      if (shouldBack !== e.inBack) {
        e.inBack = shouldBack;
        (shouldBack ? s.back : s.front).add(e.group);
        if (e.bubble) e.bubble.cheap = shouldBack;
        e.group.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.Material | undefined;
          if (m) m.depthTest = shouldBack;
        });
      }
      const pxPerUnit = (b.h / (2 * cam.halfH)) * (cam.eyeZ / (cam.eyeZ - z));
      if (e.bubble) {
        const bb = e.bubble;
        bb.round = e.voice || e.draft;
        if (e.draft) {
          // 打字：小小的、慢慢转，敲一个字跳一下；不长大
          const r = C.draftRadius + this.draftPulse * C.draftPulse;
          bb.setHalf(r, r);
          bb.swirl += (0.22 + this.draftPulse * 0.9 - bb.swirl) * (1 - Math.exp(-dt * 6));
          this.layout(e);
        } else if (e.voice) {
          // 说得越久越大，音量让漩涡转得更急（圆形的奇点，识别完再变成装下字的气泡）
          const grow = Math.min(1, (this.t - this.voiceStart) / 6);
          const r = 0.06 + grow * 0.22 + this.voiceLevel * 0.035;
          bb.setHalf(r, r);
          bb.swirl += (0.4 + this.voiceLevel * 1.6 - bb.swirl) * (1 - Math.exp(-dt * 5));
          this.layout(e);
        } else {
          bb.swirl += (0 - bb.swirl) * (1 - Math.exp(-dt * 3));
        }
        bb.opacity = op;
        const textA = e.bubbleText ? THREE.MathUtils.clamp((bb.form - 0.6) / 0.35, 0, 1) : 0;
        bb.update(dt, this.t, b.w, b.h, pxPerUnit, textA);
      }
      if (e.text) {
        e.text.opacity = op;
        e.text.cool = cool;
        e.text.update(this.t, b.w, b.h, pr);
      }
    }
    // 写字区中心：召集来的星星往这儿飘
    const cur = this.current;
    if (cur?.text) {
      const c = cur.text.group.getWorldPosition(new THREE.Vector3());
      this.thinking.gatherTo.copy(c).add(new THREE.Vector3(cam.halfW * 0.7, -0.25, 0));
      // 写字时月亮看着笔锋一带
      if (this.t > this.lookUntil && cur.text.finishAt > this.t) {
        app.moon.lookTarget = c.clone().add(new THREE.Vector3(cam.halfW * 0.8, -0.2, 0));
        app.moon.lookWeight = 0.45;
      } else if (this.t > this.lookUntil && app.moon.lookWeight > 0 && cur.text.finishAt <= this.t) {
        app.moon.lookWeight = Math.max(0, app.moon.lookWeight - dt);
      }
    }
    this.thinking.update(dt, app.moon.center, app.moon.radius, pr);
    // 历史之间的星星：跟着滚动流过身边
    const hs = this.histStars.material.uniforms;
    hs.uScroll.value = this.scroll * C.stepDepth;
    hs.uPx.value = pr;
    hs.uTime.value = this.t;
    hs.uAlpha.value += ((this.ex.length > 1 ? 1 : 0) - hs.uAlpha.value) * (1 - Math.exp(-dt * 2));
    hs.uExtent.value.set(cam.halfW, cam.halfH);
  }

  private dispose(e: Exchange) {
    e.group.removeFromParent();
    e.bubble?.dispose();
    e.text?.dispose();
  }

  clear() {
    for (const e of this.ex) this.dispose(e);
    this.ex = [];
    this.scroll = this.scrollTarget = 0;
  }
}

/** 历史各层之间的星星：沿 z 分布，滚动时从身边流过（近处的星星随着变化）。 */
function makeHistoryStars() {
  const n = 420;
  const pos = new Float32Array(n * 3);
  const ph = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = Math.random() * 2 - 1;
    pos[i * 3 + 1] = Math.random() * 2 - 1;
    pos[i * 3 + 2] = Math.random();
    ph[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aPhase", new THREE.BufferAttribute(ph, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uScroll: { value: 0 }, uPx: { value: 1 }, uTime: { value: 0 }, uAlpha: { value: 0 }, uExtent: { value: new THREE.Vector2(1, 1) } },
    vertexShader: /* glsl */ `
      attribute float aPhase;
      uniform float uScroll, uPx, uTime, uAlpha;
      uniform vec2 uExtent;
      varying float vA;
      void main() {
        float span = 14.0;
        float z = -mod(position.z * span - uScroll, span) - 0.4;
        float s = (2.0 - z) / 2.0;
        vec3 p = vec3(position.x * uExtent.x * s * 1.1, position.y * uExtent.y * s * 1.1, z);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        float near = clamp(-z / 1.2, 0.0, 1.0);
        gl_PointSize = (1.2 + 3.5 / max(0.6, -z)) * uPx;
        vA = uAlpha * near * (0.55 + 0.45 * sin(uTime * 2.0 + aPhase * 40.0)) * clamp((span + z) / 3.0, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        gl_FragColor = vec4(vec3(1.0, 0.92, 0.8) * exp(-r * r * 9.0) * vA * 1.4, 1.0);
      }
    `,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.renderOrder = -40;
  return p;
}

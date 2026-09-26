// 玻璃界面：输入框、voice、右上角设置。
// 发送时，玻璃上的字飞进空间变成黑洞气泡；按住 voice 说话时，底部长出一个小黑洞。
// 这里只管 DOM 与手势；画面在 ChatView，大脑在服务端或 DemoBrain。

import * as THREE from "three";
import type { ChatView } from "../chat/chatview";
import type { WindowCamera } from "../world/camera";
import type { Bus } from "../runtime/bus";

export interface UIHooks {
  /** 发出一句话（接真大脑或演示大脑） */
  send(text: string): void;
  /** 语音：开始 / 结束（结束时给回调识别结果；null = 取消） */
  voiceStart?(): Promise<boolean>;
  voiceStop?(): Promise<string | null>;
  /** 语音音量 0..1（每帧读） */
  voiceLevel?(): number;
  openSettings?(): void;
}

const TYPING_IDLE_MS = 1800;

export class GlassUI {
  readonly input = document.getElementById("chatInput") as HTMLInputElement;
  readonly form = document.getElementById("chatForm") as HTMLFormElement;
  readonly voiceBtn = document.getElementById("voiceBtn") as HTMLButtonElement;
  readonly settingsBtn = document.getElementById("settingsBtn") as HTMLButtonElement;
  private typingTimer: ReturnType<typeof setTimeout> | null = null;
  private typing = false;
  private recording = false;

  constructor(
    private bus: Bus,
    private chat: ChatView,
    private cam: WindowCamera,
    private hooks: UIHooks
  ) {
    const lang = (navigator.language || "en").toLowerCase();
    const zh = lang.startsWith("zh") || new URLSearchParams(location.search).get("lang") === "zh";
    this.input.placeholder = zh ? "想和月亮说些什么…" : "Say something to the moon…";
    this.input.addEventListener("input", () => {
      if (this.input.value.trim()) this.setTyping(true);
      if (this.typingTimer) clearTimeout(this.typingTimer);
      this.typingTimer = setTimeout(() => this.setTyping(false), TYPING_IDLE_MS);
    });
    this.form.addEventListener("submit", (e) => {
      e.preventDefault();
      this.submit();
    });
    this.input.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === "Return") && !e.isComposing && !e.shiftKey) {
        e.preventDefault();
        this.submit();
      }
    });
    // voice：按住说话，松开结束（点一下也行：再点一下结束）
    const down = async (e: Event) => {
      e.preventDefault();
      if (this.recording) return this.stopVoice();
      await this.startVoice();
    };
    this.voiceBtn.addEventListener("pointerdown", down);
    this.voiceBtn.addEventListener("pointerup", () => {
      if (this.recording && performance.now() - this.voiceAt > 450) void this.stopVoice();
    });
    this.settingsBtn.addEventListener("click", () => this.hooks.openSettings?.());
  }

  private voiceAt = 0;

  private setTyping(active: boolean) {
    if (this.typing === active) return;
    this.typing = active;
    this.bus.emit("user:typing", { active });
  }

  submit(text = this.input.value.trim()) {
    if (!text) return;
    this.input.value = "";
    if (this.typingTimer) clearTimeout(this.typingTimer);
    this.setTyping(false);
    this.chat.startExchange(text);
    this.flyToBubble(text);
    this.bus.emit("user:send", { text });
    this.hooks.send(text);
    this.input.blur();
  }

  /** 玻璃上的字飞进空间：从输入框飞到气泡的位置，缩小、淡出（气泡同时从奇点长出来） */
  private flyToBubble(text: string) {
    const r = this.form.getBoundingClientRect();
    const el = document.createElement("div");
    el.className = "fly-text";
    el.textContent = text.length > 60 ? text.slice(0, 58) + "…" : text;
    el.style.left = `${r.left + 22}px`;
    el.style.top = `${r.top + r.height / 2}px`;
    document.body.appendChild(el);
    // 目标：气泡在屏幕上的位置（下一帧 ChatView 才排好版）
    requestAnimationFrame(() => {
      const b = this.chat.current?.bubble;
      let tx = innerWidth * 0.62;
      let ty = innerHeight * 0.45;
      if (b) {
        const p = b.mesh.getWorldPosition(new THREE.Vector3());
        const s = this.cam.project(p);
        tx = (s.x * 0.5 + 0.5) * innerWidth;
        ty = (-s.y * 0.5 + 0.5) * innerHeight;
      }
      const dx = tx - (r.left + 22 + el.offsetWidth / 2);
      const dy = ty - (r.top + r.height / 2);
      el.animate(
        [
          { transform: "translate(0, -50%) scale(1)", opacity: 1, filter: "blur(0px)" },
          { transform: `translate(${dx * 0.6}px, calc(-50% + ${dy * 0.6}px)) scale(0.8)`, opacity: 0.9, filter: "blur(0px)", offset: 0.55 },
          { transform: `translate(${dx}px, calc(-50% + ${dy}px)) scale(0.35)`, opacity: 0, filter: "blur(2px)" },
        ],
        { duration: 620, easing: "cubic-bezier(0.3, 0.1, 0.2, 1)" }
      ).onfinish = () => el.remove();
    });
  }

  private async startVoice() {
    this.voiceAt = performance.now();
    const ok = (await this.hooks.voiceStart?.()) ?? true;
    if (!ok) return;
    this.recording = true;
    this.voiceBtn.classList.add("live");
    this.chat.startVoice();
    this.bus.emit("user:typing", { active: true });
  }

  private async stopVoice() {
    if (!this.recording) return;
    this.recording = false;
    this.voiceBtn.classList.remove("live");
    this.bus.emit("user:typing", { active: false });
    this.chat.setVoiceLevel(0);
    const text = (await this.hooks.voiceStop?.()) ?? null;
    if (!text) {
      this.chat.cancelVoice();
      return;
    }
    this.chat.finishVoice(text);
    this.bus.emit("user:send", { text });
    this.hooks.send(text);
  }

  get isRecording() {
    return this.recording;
  }

  update() {
    if (this.recording) this.chat.setVoiceLevel(this.hooks.voiceLevel?.() ?? 0);
  }
}

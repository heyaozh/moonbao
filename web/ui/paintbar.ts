// 画月亮的工具栏（G1）：和输入框同一种玻璃；画的时候它替代底部的聊天栏。
// 颜料条 → 三种颜色 · 橡皮 · 手（转）· 撤销 · 清除（点两下）· 好了。颜料用完会晃一下并提示怎么拿回来。

import type { MoonPaint, PaintTool } from "../moon/paint";
import { params } from "../moon/params";

const T = {
  en: {
    ink: "Paint",
    eraser: "Eraser",
    hand: "Turn",
    undo: "Undo",
    clear: "Clear",
    clearAgain: "Tap again",
    done: "Done",
    hintTouch: "One finger paints · two fingers turn and zoom",
    hintMouse: "Drag to paint · ✋ to turn · scroll to zoom",
    empty: "Out of paint. Erase or clear to get it back.",
  },
  zh: {
    ink: "颜料",
    eraser: "橡皮",
    hand: "转",
    undo: "撤销",
    clear: "清除",
    clearAgain: "再点一下",
    done: "好了",
    hintTouch: "一根手指画 · 两根手指转和缩放",
    hintMouse: "拖动来画 · ✋ 转它 · 滚轮缩放",
    empty: "颜料用完了。擦掉或清除，颜料就回来了。",
  },
};

const ICON = {
  eraser: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M14.5 4.5l5 5-8.5 8.5H6.5l-2-2a1.5 1.5 0 0 1 0-2.1z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 9l5 5M11 18h8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  hand: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11m0-5.5a1.5 1.5 0 0 1 3 0V11m0-4a1.5 1.5 0 0 1 3 0v6.5c0 4-2.5 6.5-6 6.5-2.6 0-4.3-1.3-5.6-3.6L4.2 13a1.4 1.4 0 0 1 2.4-1.4L8 13.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  undo: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 7L4.5 11.5 9 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 11.5h9a5 5 0 0 1 0 10h-2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  clear: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

export class PaintBar {
  private el: HTMLElement;
  private hint: HTMLElement;
  private toast: HTMLElement;
  private fill!: HTMLElement;
  private pct!: HTMLElement;
  private armedClear = 0;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private wasOut = false;

  constructor(private paint: MoonPaint, private lang: () => "en" | "zh") {
    this.el = document.createElement("div");
    this.el.id = "paintbar";
    this.el.hidden = true;
    this.hint = document.createElement("div");
    this.hint.className = "paint-hint glass-pill";
    this.hint.hidden = true;
    this.toast = document.createElement("div");
    this.toast.className = "paint-toast glass-pill";
    this.toast.hidden = true;
    const glass = document.getElementById("glass")!;
    glass.append(this.hint, this.toast, this.el);
  }

  show() {
    this.render();
    this.el.hidden = false;
    const t = T[this.lang()];
    this.hint.textContent = matchMedia("(pointer: coarse)").matches ? t.hintTouch : t.hintMouse;
    this.hint.hidden = false;
    this.hint.classList.remove("fade");
    setTimeout(() => this.hint.classList.add("fade"), 3800);
    setTimeout(() => (this.hint.hidden = true), 4600);
  }

  hide() {
    this.el.hidden = true;
    this.hint.hidden = true;
    this.toast.hidden = true;
  }

  /** 颜料条、选中状态、撤销能不能点；颜料刚用完时提示一次 */
  refresh() {
    if (this.el.hidden) return;
    const left = this.paint.left;
    this.fill.style.transform = `scaleX(${left.toFixed(3)})`;
    this.pct.textContent = `${Math.round(left * 100)}%`;
    for (const b of this.el.querySelectorAll<HTMLButtonElement>("[data-c]")) b.classList.toggle("on", this.paint.tool === "brush" && Number(b.dataset.c) === this.paint.color);
    for (const b of this.el.querySelectorAll<HTMLButtonElement>("[data-t]")) b.classList.toggle("on", this.paint.tool === b.dataset.t);
    const undo = this.el.querySelector<HTMLButtonElement>('[data-a="undo"]');
    if (undo) undo.disabled = !this.paint.canUndo;
    const out = this.paint.ranOut && left < 0.005;
    if (out && !this.wasOut) {
      this.el.querySelector(".ink")?.classList.remove("shake");
      void (this.el.querySelector(".ink") as HTMLElement | null)?.offsetWidth;
      this.el.querySelector(".ink")?.classList.add("shake");
      this.showToast(T[this.lang()].empty);
    }
    this.wasOut = out;
  }

  private showToast(text: string) {
    this.toast.textContent = text;
    this.toast.hidden = false;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast.hidden = true), 2600);
  }

  private render() {
    const t = T[this.lang()];
    const colors = params.paint.colors;
    this.el.className = "paintbar";
    this.el.innerHTML = `
      <div class="ink glass-pill" aria-label="${t.ink}"><span class="ink-label">${t.ink}</span><span class="ink-track"><span class="ink-fill"></span></span><span class="ink-pct"></span></div>
      <div class="tools glass-pill" role="toolbar">
        ${colors.map((c, i) => `<button class="swatch" data-c="${i}" style="--c:${c}" aria-label="${c}"></button>`).join("")}
        <span class="sep" aria-hidden="true"></span>
        <button class="tool" data-t="eraser" aria-label="${t.eraser}" title="${t.eraser}">${ICON.eraser}</button>
        <button class="tool" data-t="hand" aria-label="${t.hand}" title="${t.hand}">${ICON.hand}</button>
        <button class="tool" data-a="undo" aria-label="${t.undo}" title="${t.undo}">${ICON.undo}</button>
        <button class="tool" data-a="clear" aria-label="${t.clear}" title="${t.clear}">${ICON.clear}</button>
        <button class="done" data-a="done">${t.done}</button>
      </div>`;
    this.fill = this.el.querySelector(".ink-fill")!;
    this.pct = this.el.querySelector(".ink-pct")!;
    for (const b of this.el.querySelectorAll<HTMLButtonElement>("[data-c]")) {
      b.onclick = () => {
        this.paint.tool = "brush";
        this.paint.color = Number(b.dataset.c);
        this.refresh();
      };
    }
    for (const b of this.el.querySelectorAll<HTMLButtonElement>("[data-t]")) {
      b.onclick = () => {
        this.paint.tool = b.dataset.t as PaintTool;
        this.refresh();
      };
    }
    this.el.querySelector<HTMLButtonElement>('[data-a="undo"]')!.onclick = () => this.paint.undoLast();
    const clear = this.el.querySelector<HTMLButtonElement>('[data-a="clear"]')!;
    clear.onclick = () => {
      // 点两下才清：第一下变成「再点一下」
      if (performance.now() - this.armedClear < 2600) {
        this.armedClear = 0;
        clear.classList.remove("armed");
        this.paint.clear();
        return;
      }
      this.armedClear = performance.now();
      clear.classList.add("armed");
      this.showToast(T[this.lang()].clearAgain);
      setTimeout(() => clear.classList.remove("armed"), 2600);
    };
    this.el.querySelector<HTMLButtonElement>('[data-a="done"]')!.onclick = () => this.paint.exit();
    this.refresh();
  }
}

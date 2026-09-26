// 调试面板：按路径绑定 params 的滑杆 + 场景 / 表情 / 动作按钮 + 工具。
// 目的是让用户不经 agent 就能调观感；「存为默认」把改过的值写进 web/params.overrides.json。

import { diffParams } from "../moon/merge";
import { factoryParams, params } from "../moon/params";

type Getter = () => number;
type Setter = (v: number) => void;

function getPath(obj: any, path: string) {
  return path.split(".").reduce((o, k) => o?.[k], obj);
}
function setPath(obj: any, path: string, v: unknown) {
  const ks = path.split(".");
  const last = ks.pop()!;
  const o = ks.reduce((a, k) => a[k], obj);
  o[last] = v;
}

export class Panel {
  readonly root: HTMLElement;
  private body: HTMLElement;
  private refreshers: (() => void)[] = [];

  constructor() {
    this.root = document.getElementById("panel")!;
    this.body = document.getElementById("panelBody")!;
    (document.getElementById("panelToggle") as HTMLButtonElement).onclick = () => this.root.classList.toggle("collapsed");
  }

  section(title: string, open = false): HTMLElement {
    const d = document.createElement("details");
    d.open = open;
    const s = document.createElement("summary");
    s.textContent = title;
    d.appendChild(s);
    this.body.appendChild(d);
    return d;
  }

  slider(parent: HTMLElement, label: string, min: number, max: number, step: number, get: Getter, set: Setter, fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2))) {
    const row = document.createElement("label");
    row.className = "row";
    const l = document.createElement("span");
    l.textContent = label;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    const out = document.createElement("output");
    const sync = () => {
      const v = get();
      input.value = String(v);
      out.textContent = fmt(v);
    };
    input.addEventListener("input", () => {
      const v = Number(input.value);
      set(v);
      out.textContent = fmt(v);
    });
    row.append(l, input, out);
    parent.appendChild(row);
    sync();
    this.refreshers.push(sync);
    return input;
  }

  /** 绑定 params 里的一个数值（路径如 "moon.radius"）。 */
  param(parent: HTMLElement, label: string, path: string, min: number, max: number, step = (max - min) / 200) {
    return this.slider(parent, label, min, max, step, () => Number(getPath(params, path)), (v) => setPath(params, path, v));
  }

  buttons(parent: HTMLElement, items: [string, () => void][], toggleGroup = false) {
    const wrap = document.createElement("div");
    wrap.className = "btns";
    for (const [label, fn] of items) {
      const b = document.createElement("button");
      b.textContent = label;
      b.onclick = () => {
        if (toggleGroup) for (const x of wrap.querySelectorAll("button")) x.classList.toggle("on", x === b);
        fn();
      };
      wrap.appendChild(b);
    }
    parent.appendChild(wrap);
    return wrap;
  }

  checkbox(parent: HTMLElement, label: string, get: () => boolean, set: (v: boolean) => void) {
    const row = document.createElement("label");
    row.className = "row";
    const l = document.createElement("span");
    l.textContent = label;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = get();
    input.onchange = () => set(input.checked);
    row.append(l, input, document.createElement("span"));
    parent.appendChild(row);
    this.refreshers.push(() => (input.checked = get()));
  }

  refresh() {
    for (const r of this.refreshers) r();
  }

  /** 把改过的参数写进 web/params.overrides.json */
  async saveDefaults(): Promise<string> {
    const diff = diffParams(factoryParams, params) ?? {};
    const r = await fetch("/__params", { method: "POST", body: JSON.stringify(diff) });
    return r.ok ? `已存：${await r.text()}` : `失败：${await r.text()}`;
  }
}

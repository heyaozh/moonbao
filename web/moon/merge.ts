// 参数覆盖：把 overrides 里有的叶子值写进 base（原地），数组按下标合并；类型不同的值忽略。
// diffParams 反过来：算出 cur 相对 base 改了哪些叶子，给面板「存为默认」用。

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export function deepMerge<T>(base: T, over: unknown): T {
  if (Array.isArray(base) && Array.isArray(over)) {
    over.forEach((v, i) => {
      if (i < base.length) (base as unknown[])[i] = mergeValue((base as unknown[])[i], v);
    });
    return base;
  }
  if (isObj(base) && isObj(over)) {
    for (const k of Object.keys(over)) {
      if (k in base) (base as Obj)[k] = mergeValue((base as Obj)[k], over[k]);
    }
  }
  return base;
}

function mergeValue(b: unknown, o: unknown): unknown {
  if (isObj(b) || Array.isArray(b)) return deepMerge(b, o);
  return typeof b === typeof o ? o : b;
}

export function diffParams(base: unknown, cur: unknown): unknown {
  if (Array.isArray(base) && Array.isArray(cur)) {
    const out: unknown[] = [];
    let any = false;
    cur.forEach((v, i) => {
      const d = diffParams(base[i], v);
      out[i] = d === undefined ? {} : d;
      if (d !== undefined) any = true;
    });
    return any ? out : undefined;
  }
  if (isObj(base) && isObj(cur)) {
    const out: Obj = {};
    for (const k of Object.keys(cur)) {
      const d = diffParams(base[k], cur[k]);
      if (d !== undefined) out[k] = d;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return base === cur ? undefined : cur;
}

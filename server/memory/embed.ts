// 本地文本向量化：transformers.js + 中文优化的小模型，零 API key、零费用、数据不出机。
// 首次调用会下载模型（~30MB）到本地缓存。

import { pipeline } from "@huggingface/transformers";

const MODEL = "Xenova/bge-small-zh-v1.5";

let extractor: Promise<any> | null = null;

function getExtractor() {
  extractor ??= pipeline("feature-extraction", MODEL);
  return extractor;
}

export async function embed(text: string): Promise<Float32Array> {
  const ex = await getExtractor();
  const out = await ex(text, { pooling: "mean", normalize: true });
  return new Float32Array(out.data);
}

/** 余弦相似度（输入已归一化 → 点积即可） */
export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

/** 服务启动时预热，首条记忆操作不吃模型冷加载 */
export function warmupEmbedder() {
  getExtractor().catch((e) => console.error("[memory] embedder warmup:", e.message));
}

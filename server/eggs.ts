// 秘密彩蛋（PLAN V9-E，2026-10-04 用户提出）：一句固定的暗号 → 一段固定的回复 + 特别动作（爱心眼）。
// 暗号不进仓库：persona/eggs.json 里只有它的盐化 SHA-256；盐 EGG_SALT 放 .env（不提交，和 API key 同一管理方式）。
// 没有盐，拿到仓库也没法拿字典猜短句；只有带盐的服务器认得。回复用 base64 存（不懂技术的人一眼看不出）。
// 匹配前归一化：NFKC、小写、去掉全部空白与标点（只留字母、数字、汉字）——「I’m Yao, 小月亮！」≡「im yao小月亮」。
// 暗号由用户本机 `npm run egg -- add` 加入：输入不回显、不打印、不进日志，agent 全程看不到。

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Action } from "../shared/protocol.js";

export interface EggEntry {
  id: string;
  /** sha256(EGG_SALT + "\n" + normalizePhrase(暗号)) 的十六进制 */
  hash: string;
  /** base64 的回复；可含 {{moon}}（它的名字）/ {{user}}（对方的名字） */
  reply: string;
  /** 表情（默认 heart，只有彩蛋能触发的爱心眼） */
  expr?: string;
  /** 动作（默认 bounce） */
  action?: Action;
  intensity?: number;
  /** 回复走隆重档远方流星写字（默认 true） */
  grand?: boolean;
  /** 给自己看的备注——别把暗号写进来 */
  note?: string;
}

export const eggsFile = () => process.env.EGGS_FILE ?? path.join(process.cwd(), "persona/eggs.json");

/** 只留字母、数字、汉字：大小写、空格、标点、弯引号都不算数 */
export function normalizePhrase(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export function hashPhrase(salt: string, phrase: string): string {
  return createHash("sha256").update(`${salt}\n${normalizePhrase(phrase)}`).digest("hex");
}

export function loadEggs(file = eggsFile()): EggEntry[] {
  if (!existsSync(file)) return [];
  try {
    const j = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(j) ? j.filter((e) => e && typeof e.id === "string" && typeof e.hash === "string" && typeof e.reply === "string") : [];
  } catch (e: any) {
    console.warn(`[eggs] ${file} 读不了：${e.message}`);
    return [];
  }
}

export function saveEggs(eggs: EggEntry[], file = eggsFile()) {
  writeFileSync(file, JSON.stringify(eggs, null, 2) + "\n");
}

export const encodeReply = (text: string) => Buffer.from(text, "utf8").toString("base64");
export const decodeReply = (b64: string) => Buffer.from(b64, "base64").toString("utf8");

/** 服务端用：启动时读一次，之后每句话都来问一下 */
export class EggBook {
  private eggs: EggEntry[];
  constructor(
    private salt = process.env.EGG_SALT ?? "",
    eggs?: EggEntry[]
  ) {
    this.eggs = eggs ?? loadEggs();
    if (this.eggs.length && !this.salt) console.warn("[eggs] persona/eggs.json 有条目但没有 EGG_SALT：秘密彩蛋不会触发（npm run egg -- salt）");
    else if (this.eggs.length) console.log(`[eggs] ${this.eggs.length} 条秘密彩蛋就位`);
  }
  get count() {
    return this.eggs.length;
  }
  match(text: string): EggEntry | null {
    if (!this.salt || !this.eggs.length) return null;
    const n = normalizePhrase(text);
    if (!n) return null;
    const h = createHash("sha256").update(`${this.salt}\n${n}`).digest("hex");
    return this.eggs.find((e) => e.hash === h) ?? null;
  }
}

// 情节/语义记忆存储与检索（SQLite 本地文件）。
// 设计要点（见 PLAN §4.4）：
// - 记忆不删除，只降低被想起的概率（active=0 表示被纠正失效，仍保留历史）
// - 检索打分 = 语义相关性 + 时近性 + 重要性 + 情绪权重 + 强化 − 近期过度使用惩罚
// - 置信度随时间衰减（不同 kind 衰减速度不同），影响表达方式（"清楚记得"vs"模糊记得"）
// - follow_up_at：到期后它会主动提起（"面试怎么样呀"）；proactive_log 做频控（每天 ≤N 次）
// - meta：last_seen_at 等会话级状态（久别归来判定）

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { cosine, embed } from "./embed.js";

export type MemoryKind =
  | "episode" // 情节：某天发生了什么
  | "fact" // 语义：用户的稳定事实/偏好
  | "reflection" // 反思：整理阶段提炼的认识
  | "pinned"; // 用户明确要求记住的——不衰减

export interface MemoryRow {
  id: number;
  kind: MemoryKind;
  content: string;
  importance: number; // 0..1
  emotional: number; // 0..1 情绪强度
  created_at: number;
  last_recalled_at: number | null;
  recall_count: number;
  active: number;
  source: string;
  /** 到期时间（ms）；null=无需主动提起 */
  follow_up_at: number | null;
  /** 提起时的提示（"问问面试怎么样"） */
  follow_up_hint: string | null;
  /** 0=待提起 1=已提起 2=过期作废 */
  follow_up_done: number;
}

export interface RecalledMemory extends MemoryRow {
  score: number;
  /** 当前置信度 0..1（随时间衰减、随强化回升） */
  confidence: number;
}

// 各类记忆的置信度半衰期（天）
const HALF_LIFE_DAYS: Record<MemoryKind, number> = {
  episode: 30,
  fact: 120,
  reflection: 90,
  pinned: Infinity,
};

const DAY = 86400_000;

const ROW_COLS = `id, kind, content, importance, emotional, created_at, last_recalled_at,
                  recall_count, active, source, follow_up_at, follow_up_hint, follow_up_done`;

export class MemoryStore {
  private db: Database.Database;
  private vecCache = new Map<number, Float32Array>();

  constructor(dbPath = process.env.MEMORY_DB ?? "data/memory.db") {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        importance REAL NOT NULL DEFAULT 0.5,
        emotional REAL NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_recalled_at INTEGER,
        recall_count INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        source TEXT NOT NULL DEFAULT '',
        embedding BLOB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS proactive_log (
        id INTEGER PRIMARY KEY,
        ts INTEGER NOT NULL,
        reason TEXT NOT NULL,
        memory_id INTEGER
      );
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    // 老库迁移：补 follow-up 三列（已存在则忽略）
    const cols = new Set(
      (this.db.prepare(`PRAGMA table_info(memories)`).all() as { name: string }[]).map((c) => c.name)
    );
    if (!cols.has("follow_up_at")) this.db.exec(`ALTER TABLE memories ADD COLUMN follow_up_at INTEGER`);
    if (!cols.has("follow_up_hint")) this.db.exec(`ALTER TABLE memories ADD COLUMN follow_up_hint TEXT`);
    if (!cols.has("follow_up_done"))
      this.db.exec(`ALTER TABLE memories ADD COLUMN follow_up_done INTEGER NOT NULL DEFAULT 0`);
  }

  async add(m: {
    kind: MemoryKind;
    content: string;
    importance?: number;
    emotional?: number;
    source?: string;
    followUpAt?: number | null;
    followUpHint?: string | null;
  }): Promise<number | null> {
    const vec = await embed(m.content);
    // 去重：与现存活跃记忆高度相似 → 视为强化而不是新增
    const dup = await this.findSimilar(vec, 0.92);
    if (dup) {
      this.db
        .prepare(
          `UPDATE memories SET recall_count = recall_count + 1,
           importance = MAX(importance, ?), last_recalled_at = ? WHERE id = ?`
        )
        .run(m.importance ?? 0.5, Date.now(), dup.id);
      // 重复提到同一件事但这次带了到期时间 → 补上 follow-up
      if (m.followUpAt) {
        this.db
          .prepare(
            `UPDATE memories SET follow_up_at = ?, follow_up_hint = ?, follow_up_done = 0
             WHERE id = ? AND (follow_up_at IS NULL OR follow_up_done <> 0)`
          )
          .run(m.followUpAt, m.followUpHint ?? null, dup.id);
      }
      return null;
    }
    const info = this.db
      .prepare(
        `INSERT INTO memories (kind, content, importance, emotional, created_at, source, embedding,
                               follow_up_at, follow_up_hint)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        m.kind,
        m.content,
        m.importance ?? 0.5,
        m.emotional ?? 0,
        Date.now(),
        m.source ?? "",
        Buffer.from(vec.buffer),
        m.followUpAt ?? null,
        m.followUpHint ?? null
      );
    return Number(info.lastInsertRowid);
  }

  /** 用户纠正：旧记忆失效但保留，新事实入库 */
  async correct(oldId: number, newContent: string) {
    this.db.prepare(`UPDATE memories SET active = 0 WHERE id = ?`).run(oldId);
    await this.add({ kind: "fact", content: newContent, importance: 0.7, source: `corrects:${oldId}` });
  }

  private confidence(row: MemoryRow, now: number): number {
    const half = HALF_LIFE_DAYS[row.kind as MemoryKind] ?? 60;
    if (!isFinite(half)) return 0.98;
    const ageDays = (now - row.created_at) / DAY;
    const base = Math.pow(0.5, ageDays / half);
    // 每次被想起/强化都提升置信度上限
    const boost = Math.min(0.3, row.recall_count * 0.05);
    return Math.min(0.98, base * (1 - 0.2) + 0.2 + boost * base);
  }

  async recall(query: string, k = 5, minScore = 0.35): Promise<RecalledMemory[]> {
    const qv = await embed(query);
    const now = Date.now();
    const rows = this.db
      .prepare(`SELECT * FROM memories WHERE active = 1`)
      .all() as (MemoryRow & { embedding: Buffer })[];

    const scored: RecalledMemory[] = rows.map((r) => {
      let vec = this.vecCache.get(r.id);
      if (!vec) {
        vec = new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4);
        this.vecCache.set(r.id, vec);
      }
      const sim = cosine(qv, vec); // bge 相似度大致 0.3~0.9
      const recency = Math.exp(-((now - (r.last_recalled_at ?? r.created_at)) / DAY) / 45);
      const overuse =
        r.last_recalled_at && now - r.last_recalled_at < 10 * 60_000 ? 0.15 : 0;
      const score =
        sim * 1.0 + recency * 0.15 + r.importance * 0.2 + r.emotional * 0.15 - overuse;
      const { embedding: _e, ...rest } = r;
      return { ...rest, score, confidence: this.confidence(r, now) };
    });

    return scored
      .filter((s) => s.score > minScore + 0.35) // sim 基线 ~0.35，叠加权重后阈值上移
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  /** 标记这些记忆刚被想起（强化 + 短期防复读） */
  markRecalled(ids: number[]) {
    const stmt = this.db.prepare(
      `UPDATE memories SET last_recalled_at = ?, recall_count = recall_count + 1 WHERE id = ?`
    );
    const now = Date.now();
    for (const id of ids) stmt.run(now, id);
  }

  private async findSimilar(vec: Float32Array, threshold: number) {
    const rows = this.db
      .prepare(`SELECT id, embedding FROM memories WHERE active = 1`)
      .all() as { id: number; embedding: Buffer }[];
    for (const r of rows) {
      const v = new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4);
      if (cosine(vec, v) > threshold) return r;
    }
    return null;
  }

  count(): number {
    return (this.db.prepare(`SELECT COUNT(*) c FROM memories WHERE active = 1`).get() as any).c;
  }

  /** 最近的记忆（调试用） */
  recent(n = 20): MemoryRow[] {
    return this.db
      .prepare(`SELECT ${ROW_COLS} FROM memories WHERE active = 1 ORDER BY created_at DESC LIMIT ?`)
      .all(n) as MemoryRow[];
  }

  // ---------- follow-up / 主动性 ----------

  /** 到期且未处理的 follow-up，按重要性排序 */
  dueFollowUps(now = Date.now()): MemoryRow[] {
    return this.db
      .prepare(
        `SELECT ${ROW_COLS} FROM memories
         WHERE active = 1 AND follow_up_done = 0 AND follow_up_at IS NOT NULL AND follow_up_at <= ?
         ORDER BY importance DESC, follow_up_at ASC`
      )
      .all(now) as MemoryRow[];
  }

  /** 尚未提起的全部 follow-up（含未到期；调试面板/CLI 用） */
  pendingFollowUps(): MemoryRow[] {
    return this.db
      .prepare(
        `SELECT ${ROW_COLS} FROM memories
         WHERE active = 1 AND follow_up_done = 0 AND follow_up_at IS NOT NULL
         ORDER BY follow_up_at ASC`
      )
      .all() as MemoryRow[];
  }

  markFollowUpDone(id: number) {
    this.db
      .prepare(
        `UPDATE memories SET follow_up_done = 1, last_recalled_at = ?, recall_count = recall_count + 1 WHERE id = ?`
      )
      .run(Date.now(), id);
  }

  /** 过期太久的 follow-up 直接作废：不翻旧账 */
  expireStaleFollowUps(maxAgeMs: number, now = Date.now()) {
    this.db
      .prepare(
        `UPDATE memories SET follow_up_done = 2
         WHERE follow_up_done = 0 AND follow_up_at IS NOT NULL AND follow_up_at < ?`
      )
      .run(now - maxAgeMs);
  }

  /** 手动设置/改期一条 follow-up（CLI/调试） */
  setFollowUp(id: number, at: number | null, hint?: string | null) {
    this.db
      .prepare(`UPDATE memories SET follow_up_at = ?, follow_up_hint = COALESCE(?, follow_up_hint), follow_up_done = 0 WHERE id = ?`)
      .run(at, hint ?? null, id);
  }

  /** 清掉今天的主动计数（调试） */
  resetProactiveToday(now = Date.now()) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    this.db.prepare(`DELETE FROM proactive_log WHERE ts >= ?`).run(d.getTime());
  }

  logProactive(reason: string, memoryId: number | null) {
    this.db
      .prepare(`INSERT INTO proactive_log (ts, reason, memory_id) VALUES (?, ?, ?)`)
      .run(Date.now(), reason, memoryId);
  }

  /** 从本地时间"今天 0 点"起已主动开口几次 */
  proactiveCountToday(now = Date.now()): number {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return (
      this.db.prepare(`SELECT COUNT(*) c FROM proactive_log WHERE ts >= ?`).get(d.getTime()) as any
    ).c;
  }

  getMeta(key: string): string | null {
    const r = this.db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as
      | { value: string }
      | undefined;
    return r?.value ?? null;
  }

  setMeta(key: string, value: string) {
    this.db
      .prepare(
        `INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, value);
  }

  /** 最近一次见到用户的时间（ms）；从未见过 → null */
  get lastSeenAt(): number | null {
    const v = this.getMeta("last_seen_at");
    return v ? Number(v) : null;
  }

  touchSeen(now = Date.now()) {
    this.setMeta("last_seen_at", String(now));
  }
}

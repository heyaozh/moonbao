// 记忆/主动性调试 CLI（服务端不必运行；共用同一个 SQLite）。
//   npm run memory -- list
//   npm run memory -- add "用户明天下午有面试" "问问面试怎么样" 30      # 30 分钟后到期
//   npm run memory -- due <id>          # 把某条 follow-up 改成立刻到期（然后刷新页面看它主动开口）
//   npm run memory -- done <id>
//   npm run memory -- seen <daysAgo>    # 伪造"上次见面"在 N 天前（测久别归来）
//   npm run memory -- reset-proactive   # 清掉今天的主动计数

import "dotenv/config";
import { MemoryStore } from "../server/memory/store.js";

const [cmd, ...rest] = process.argv.slice(2);
const store = new MemoryStore();
const fmt = (t: number | null) => (t ? new Date(t).toLocaleString("zh-CN", { hour12: false }) : "—");

switch (cmd) {
  case "list": {
    console.log(`上次见面：${fmt(store.lastSeenAt)}   今日主动：${store.proactiveCountToday()} 次   记忆 ${store.count()} 条\n`);
    const pending = store.pendingFollowUps();
    console.log(`待提起 follow-up（${pending.length}）：`);
    for (const m of pending) {
      const due = (m.follow_up_at ?? Infinity) <= Date.now();
      console.log(`  #${m.id} ${due ? "⏰到期" : "⏳"} ${fmt(m.follow_up_at)}  ${m.content}  → ${m.follow_up_hint ?? ""}`);
    }
    console.log(`\n最近记忆：`);
    for (const m of store.recent(15)) console.log(`  #${m.id} [${m.kind}] ${fmt(m.created_at)}  ${m.content}`);
    break;
  }
  case "add": {
    const [content, hint, minutes] = rest;
    if (!content) throw new Error("add <content> [hint] [minutesFromNow]");
    const at = Date.now() + Number(minutes ?? 30) * 60_000;
    const id = await store.add({ kind: "fact", content, importance: 0.8, emotional: 0.5, source: "cli", followUpAt: at, followUpHint: hint ?? null });
    console.log(id === null ? "（与已有记忆重复，已合并）" : `#${id} 已加入，${fmt(at)} 到期`);
    break;
  }
  case "due": {
    const id = Number(rest[0]);
    store.setFollowUp(id, Date.now() - 60_000);
    console.log(`#${id} 已设为到期`);
    break;
  }
  case "done": {
    store.markFollowUpDone(Number(rest[0]));
    console.log("ok");
    break;
  }
  case "seen": {
    const days = Number(rest[0] ?? 0);
    store.touchSeen(Date.now() - days * 86400_000);
    console.log(`上次见面 → ${fmt(store.lastSeenAt)}`);
    break;
  }
  case "reset-proactive": {
    store.resetProactiveToday();
    console.log("ok");
    break;
  }
  default:
    console.log("用法：list | add <content> [hint] [minutes] | due <id> | done <id> | seen <daysAgo> | reset-proactive");
}

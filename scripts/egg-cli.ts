// 秘密彩蛋 CLI（PLAN V9-E）。暗号只在你的终端里出现一次：输入不回显、不打印、不进日志；仓库里只有盐化哈希。
//   npm run egg -- salt           # 没有 EGG_SALT 时生成一个，追加到 .env（.env 不提交）
//   npm run egg -- add            # 交互：暗号（隐藏输入）→ 回复 → 表情 / 动作 → 写进 persona/eggs.json
//   npm run egg -- test           # 输入一句话（隐藏），看会不会命中
//   npm run egg -- list           # 只列 id / 表情 / 动作 / 备注（不显示回复、更没有暗号）
//   npm run egg -- remove <id>

import "dotenv/config";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { ACTIONS, isAction } from "../shared/protocol.js";
import { EggBook, encodeReply, eggsFile, hashPhrase, loadEggs, saveEggs, type EggEntry } from "../server/eggs.js";

function ask(q: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const anyRl = rl as any;
    const write = anyRl._writeToOutput;
    rl.question(q, (a) => {
      anyRl._writeToOutput = write;
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(a);
    });
    // 问题已经打出来了；之后的回显（你敲的字）一律不写到屏幕上
    if (hidden) anyRl._writeToOutput = () => undefined;
  });
}

async function ensureSalt(): Promise<string> {
  if (process.env.EGG_SALT) return process.env.EGG_SALT;
  const env = path.join(process.cwd(), ".env");
  console.log("还没有 EGG_SALT（暗号的盐）。");
  const ok = (await ask(`生成一个并追加到 ${env}？[y/N] `)).trim().toLowerCase();
  if (ok !== "y") process.exit(1);
  const salt = randomBytes(24).toString("base64url");
  const lead = existsSync(env) && !readFileSync(env, "utf8").endsWith("\n") ? "\n" : "";
  appendFileSync(env, `${lead}# 秘密彩蛋的盐（PLAN V9-E）：不要提交、不要改，改了已有的暗号就全失效\nEGG_SALT=${salt}\n`);
  process.env.EGG_SALT = salt;
  console.log("已写入 .env（.env 在 .gitignore 里）。");
  return salt;
}

const [cmd, ...rest] = process.argv.slice(2);

switch (cmd) {
  case "salt": {
    await ensureSalt();
    break;
  }
  case "add": {
    const salt = await ensureSalt();
    const p1 = await ask("暗号（输入不显示）：", true);
    const p2 = await ask("再输一遍：", true);
    if (!p1.trim() || p1 !== p2) {
      console.log("两次不一样（或为空），没有保存。");
      process.exit(1);
    }
    const hash = hashPhrase(salt, p1);
    const eggs = loadEggs();
    if (eggs.some((e) => e.hash === hash)) {
      console.log(`这句暗号已经有了（${eggs.find((e) => e.hash === hash)!.id}），没有重复加。`);
      process.exit(1);
    }
    const reply = (await ask("回复（可用 {{moon}} = 它的名字、{{user}} = 对方的名字）：")).trim();
    if (!reply) {
      console.log("回复为空，没有保存。");
      process.exit(1);
    }
    const id = (await ask(`id（默认 egg-${eggs.length + 1}）：`)).trim() || `egg-${eggs.length + 1}`;
    const expr = (await ask("表情（默认 heart = 爱心眼）：")).trim() || "heart";
    const actionIn = (await ask(`动作（默认 bounce；可选 ${ACTIONS.join(" / ")}）：`)).trim() || "bounce";
    if (!isAction(actionIn)) {
      console.log(`没有这个动作：${actionIn}`);
      process.exit(1);
    }
    const note = (await ask("备注（给自己看的，别写暗号）：")).trim();
    const entry: EggEntry = { id, hash, reply: encodeReply(reply), expr, action: actionIn, intensity: 0.8, grand: true };
    if (note) entry.note = note;
    eggs.push(entry);
    saveEggs(eggs);
    console.log(`已加入 ${id} → ${eggsFile()}（存的是哈希和 base64 的回复，暗号本身没有保存）。重启服务端生效。`);
    break;
  }
  case "test": {
    const salt = process.env.EGG_SALT ?? "";
    if (!salt) {
      console.log("没有 EGG_SALT，什么都不会命中。");
      process.exit(1);
    }
    const phrase = await ask("输入一句话（不显示）：", true);
    const hit = new EggBook(salt).match(phrase);
    console.log(hit ? `命中 ${hit.id}（表情 ${hit.expr ?? "heart"}，动作 ${hit.action ?? "bounce"}）` : "没命中");
    break;
  }
  case "list": {
    const eggs = loadEggs();
    if (!eggs.length) console.log("没有彩蛋。npm run egg -- add 加一条。");
    for (const e of eggs) console.log(`${e.id}  表情 ${e.expr ?? "heart"}  动作 ${e.action ?? "bounce"}  隆重 ${e.grand ?? true}  ${e.note ?? ""}`);
    break;
  }
  case "remove": {
    const id = rest[0];
    const eggs = loadEggs();
    const left = eggs.filter((e) => e.id !== id);
    if (left.length === eggs.length) {
      console.log(`没有 ${id}`);
      process.exit(1);
    }
    saveEggs(left);
    console.log(`已删除 ${id}`);
    break;
  }
  default:
    console.log("用法：npm run egg -- salt | add | test | list | remove <id>");
}

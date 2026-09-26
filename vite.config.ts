import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig, type Plugin } from "vite";

// 开发期截图落盘：页面 POST dataURL 到 /__snap，写进 snaps/（gitignore）。
// 无头验收管线的一环——agent 用它"看"月亮长什么样。
function snapEndpoint(): Plugin {
  return {
    name: "snap-endpoint",
    configureServer(server) {
      // /api/health 不走 http-proxy：服务端没起时 http-proxy 会每次打一整段 ECONNREFUSED 堆栈。
      // 这里自己探一下，探不到就安静地回 503，前端据此决定要不要开 WebSocket。
      server.middlewares.use("/api/health", async (_req, res) => {
        try {
          const r = await fetch("http://localhost:8787/api/health", { signal: AbortSignal.timeout(1500) });
          res.statusCode = r.status;
          res.setHeader("content-type", "application/json");
          res.end(await r.text());
        } catch {
          res.statusCode = 503;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ ok: false, reason: "brain server not running (npm run dev:server)" }));
        }
      });
      // 概念图（画面对照标准）：assets/ui-concept/ 不在 vite root 里，这里单独开一个只读口子给对照页用
      server.middlewares.use("/__concept", (req, res) => {
        const name = decodeURIComponent((req.url ?? "/").split("?")[0]).replace(/^\/+/, "");
        const file = path.join(process.cwd(), "assets/ui-concept", path.basename(name));
        if (!/\.(jpg|txt)$/.test(file) || !existsSync(file)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader("content-type", file.endsWith(".jpg") ? "image/jpeg" : "text/plain; charset=utf-8");
        res.end(readFileSync(file));
      });
      // 面板「存为默认」：把改过的参数写进 web/params.overrides.json（启动时合并进 params）
      server.middlewares.use("/__params", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          try {
            const json = JSON.parse(body);
            const file = path.join(process.cwd(), "web/params.overrides.json");
            writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
            res.end(file);
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e));
          }
        });
      });
      server.middlewares.use("/__snap", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          const b64 = body.replace(/^data:image\/\w+;base64,/, "");
          // ?dir=seq-name&name=frame-0001 → snaps/seq-name/frame-0001.jpg（录 GIF 逐帧用）
          const q = new URL(req.url ?? "/", "http://x").searchParams;
          const sub = (q.get("dir") ?? "").replace(/[^\w.-]/g, "");
          const name = (q.get("name") ?? `snap-${Date.now()}`).replace(/[^\w.-]/g, "");
          const dir = path.join(process.cwd(), "snaps", sub);
          mkdirSync(dir, { recursive: true });
          const file = path.join(dir, `${name}.jpg`);
          writeFileSync(file, Buffer.from(b64, "base64"));
          res.end(file);
        });
      });
    },
  };
}

export default defineConfig({
  root: "web",
  // CHARACTER_NAME 前后端共用（服务端读 process.env，前端读 import.meta.env）
  envPrefix: ["VITE_", "CHARACTER_"],
  envDir: path.resolve(__dirname),
  server: {
    port: 5176,
    proxy: {
      // 服务端没起时 http-proxy 会每次重连都打一整段 ECONNREFUSED 堆栈；这里收成一行、60s 内只报一次
      "/ws": { target: "ws://localhost:8787", ws: true },
      "/api": { target: "http://localhost:8787" },
    },
  },
  // 手机真机：MOON_HTTPS=1 时开自签 HTTPS（陀螺仪授权和麦克风都要安全上下文），配合 --host 走局域网
  plugins: [snapEndpoint(), ...(process.env.MOON_HTTPS ? [basicSsl()] : [])],
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "web/index.html"),
        compare: path.resolve(__dirname, "web/compare.html"),
      },
    },
  },
});

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

// 开发期截图落盘：页面 POST dataURL 到 /__snap，写进 snaps/（gitignore）。
// 无头验收管线的一环——agent 用它"看"月亮长什么样。
function snapEndpoint(): Plugin {
  return {
    name: "snap-endpoint",
    configureServer(server) {
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
          const dir = path.join(process.cwd(), "snaps");
          mkdirSync(dir, { recursive: true });
          const file = path.join(dir, `snap-${Date.now()}.jpg`);
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
      "/ws": { target: "ws://localhost:8787", ws: true },
      "/api": { target: "http://localhost:8787" },
    },
  },
  plugins: [snapEndpoint()],
});

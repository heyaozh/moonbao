// 前端的角色身份：与服务端共用 CHARACTER_NAME（vite.config 里 envPrefix 放行了它）。
export const CHARACTER_NAME: string =
  (import.meta.env.CHARACTER_NAME as string | undefined)?.trim() || "小满";

// 角色的可切换身份：名字还在候选中（小满 / 皎皎），用环境变量切换，人格文件里用 {{NAME}} 占位。
// 前端同名变量经 vite envPrefix 暴露为 import.meta.env.CHARACTER_NAME。

export const CHARACTER_NAME = process.env.CHARACTER_NAME?.trim() || "小满";

/** 把人格/提示词里的占位符替换成当前名字 */
export function withName(text: string): string {
  return text.replaceAll("{{NAME}}", CHARACTER_NAME);
}

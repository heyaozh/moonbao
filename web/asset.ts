// 静态资源的地址：按站点的 base（vite 的 BASE_URL）拼，app 放在子目录里（介绍网站的 /app/）也找得到
export const asset = (p: string) => import.meta.env.BASE_URL + p.replace(/^\/+/, "");

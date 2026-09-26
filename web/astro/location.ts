// 用户在哪：默认按系统时区估算（不弹权限），可选定位授权，或设置里手填。
// 只用来算天色、月相朝向和星空朝向——差几百公里看不出来。

export interface GeoLocation {
  lat: number; // 度，北正
  lon: number; // 度，东正
  source: "timezone" | "offset" | "geolocation" | "manual";
  label: string;
}

// 常见时区的代表城市坐标（度）。不在表里的按 UTC 偏移估经度、按洲估纬度。
const ZONES: Record<string, [number, number]> = {
  "Europe/Berlin": [52.52, 13.4], "Europe/Amsterdam": [52.37, 4.9], "Europe/Brussels": [50.85, 4.35], "Europe/Paris": [48.86, 2.35],
  "Europe/London": [51.51, -0.13], "Europe/Dublin": [53.35, -6.26], "Europe/Lisbon": [38.72, -9.14], "Europe/Madrid": [40.42, -3.7],
  "Europe/Rome": [41.9, 12.5], "Europe/Zurich": [47.38, 8.54], "Europe/Vienna": [48.21, 16.37], "Europe/Prague": [50.08, 14.44],
  "Europe/Warsaw": [52.23, 21.01], "Europe/Stockholm": [59.33, 18.07], "Europe/Oslo": [59.91, 10.75], "Europe/Copenhagen": [55.68, 12.57],
  "Europe/Helsinki": [60.17, 24.94], "Europe/Athens": [37.98, 23.73], "Europe/Istanbul": [41.01, 28.98], "Europe/Kiev": [50.45, 30.52],
  "Europe/Kyiv": [50.45, 30.52], "Europe/Moscow": [55.76, 37.62], "Europe/Budapest": [47.5, 19.04], "Europe/Luxembourg": [49.61, 6.13],
  "Asia/Shanghai": [31.23, 121.47], "Asia/Chongqing": [29.56, 106.55], "Asia/Harbin": [45.8, 126.53], "Asia/Urumqi": [43.83, 87.62],
  "Asia/Hong_Kong": [22.32, 114.17], "Asia/Macau": [22.2, 113.54], "Asia/Taipei": [25.03, 121.57], "Asia/Tokyo": [35.68, 139.69],
  "Asia/Seoul": [37.57, 126.98], "Asia/Singapore": [1.35, 103.82], "Asia/Kuala_Lumpur": [3.14, 101.69], "Asia/Bangkok": [13.76, 100.5],
  "Asia/Ho_Chi_Minh": [10.82, 106.63], "Asia/Jakarta": [-6.2, 106.85], "Asia/Manila": [14.6, 120.98], "Asia/Kolkata": [22.57, 88.36],
  "Asia/Calcutta": [22.57, 88.36], "Asia/Dubai": [25.2, 55.27], "Asia/Jerusalem": [31.77, 35.21], "Asia/Tel_Aviv": [32.09, 34.78],
  "America/New_York": [40.71, -74.0], "America/Toronto": [43.65, -79.38], "America/Chicago": [41.88, -87.63], "America/Denver": [39.74, -104.99],
  "America/Phoenix": [33.45, -112.07], "America/Los_Angeles": [34.05, -118.24], "America/Vancouver": [49.28, -123.12], "America/Anchorage": [61.22, -149.9],
  "America/Mexico_City": [19.43, -99.13], "America/Sao_Paulo": [-23.55, -46.63], "America/Buenos_Aires": [-34.6, -58.38],
  "America/Argentina/Buenos_Aires": [-34.6, -58.38], "America/Santiago": [-33.45, -70.67], "America/Bogota": [4.71, -74.07], "America/Lima": [-12.05, -77.04],
  "Pacific/Honolulu": [21.31, -157.86], "Pacific/Auckland": [-36.85, 174.76], "Australia/Sydney": [-33.87, 151.21], "Australia/Melbourne": [-37.81, 144.96],
  "Australia/Brisbane": [-27.47, 153.03], "Australia/Perth": [-31.95, 115.86], "Australia/Adelaide": [-34.93, 138.6], "Africa/Cairo": [30.04, 31.24],
  "Africa/Johannesburg": [-26.2, 28.05], "Africa/Lagos": [6.52, 3.38], "Africa/Nairobi": [-1.29, 36.82], "Atlantic/Reykjavik": [64.15, -21.94],
};

export function estimateLocation(): GeoLocation {
  let tz = "";
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    /* 老浏览器 */
  }
  const hit = ZONES[tz];
  if (hit) return { lat: hit[0], lon: hit[1], source: "timezone", label: tz };
  // 按 UTC 偏移估经度；纬度按洲粗估
  const offsetH = -new Date().getTimezoneOffset() / 60;
  const south = /^(Australia|Antarctica|Pacific\/(Auckland|Fiji|Tongatapu)|America\/(Sao_Paulo|Argentina|Santiago|Montevideo|Asuncion|La_Paz|Lima)|Africa\/(Johannesburg|Maputo|Harare|Windhoek))/.test(tz);
  return { lat: south ? -30 : 40, lon: offsetH * 15, source: "offset", label: tz || `UTC${offsetH >= 0 ? "+" : ""}${offsetH}` };
}

const KEY = "moonbao.location";

/** 读用户存过的位置（手填或定位），没有就按时区估。 */
export function loadLocation(): GeoLocation {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const j = JSON.parse(raw);
      if (Number.isFinite(j.lat) && Number.isFinite(j.lon)) return j as GeoLocation;
    }
  } catch {
    /* 隐私模式 / 存储被禁 */
  }
  return estimateLocation();
}

export function saveLocation(loc: GeoLocation | null) {
  try {
    if (loc) localStorage.setItem(KEY, JSON.stringify(loc));
    else localStorage.removeItem(KEY);
  } catch {
    /* 忽略 */
  }
}

/** 请求一次定位授权（只在用户在设置里点了之后调用）。 */
export function requestGeolocation(): Promise<GeoLocation | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, source: "geolocation", label: "定位" }),
      () => resolve(null),
      { maximumAge: 6 * 3600_000, timeout: 8000, enableHighAccuracy: false }
    );
  });
}

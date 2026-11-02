// Ссылки на сайт из бота (TG-08, NOTIF-05): куда ведёт «Показать» по виду объекта уведомления и можно ли дать адрес
// URL-кнопкой. Telegram отвергает в кнопке локальные и частные адреса (`127.0.0.1`, `192.168.…` — BUTTON_URL_INVALID), а с
// телефона они и не открываются без LAN-доступа (NFR-24): такой адрес идёт в сообщение текстом.

/** Раздел сайта по виду объекта уведомления (как `OBJECT_HREF` сайта); неизвестный вид — ссылки нет. */
const OBJECT_PATH: Readonly<Record<string, (id: string) => string>> = {
  transaction: (id) => `/operations?open=${encodeURIComponent(id)}`,
  receipt: (id) => `/documents?open=${encodeURIComponent(id)}`,
  "statement-import": () => "/documents",
  limit: () => "/budget",
  goal: () => "/budget",
  deduction: () => "/deductions",
  "calendar-event": () => "/calendar",
  recurring: () => "/recurring",
  "data-export": () => "/settings?tab=my-data",
};

export function objectPath(
  ref: { readonly entity: string; readonly id: string } | null,
): string | undefined {
  return ref === null ? undefined : OBJECT_PATH[ref.entity]?.(ref.id);
}

/** Частный или локальный адрес: loopback, `.local`, диапазоны RFC 1918, link-local, IPv6 в скобках, имя без точки. */
function isPrivateHost(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host.startsWith("[") || !host.includes(".")) return true;
  const octets = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/u.exec(host);
  if (octets === null) return false;
  const first = Number(octets[1]);
  const second = Number(octets[2]);
  return (
    first === 10 ||
    first === 127 ||
    first === 0 ||
    (first === 192 && second === 168) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 169 && second === 254)
  );
}

/** Годится ли адрес для URL-кнопки Telegram: http(s) и публичное имя или адрес. */
export function isButtonUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      !isPrivateHost(parsed.hostname)
    );
  } catch {
    return false;
  }
}

export function siteUrl(origin: string, path: string): string {
  return new URL(path, origin).href;
}

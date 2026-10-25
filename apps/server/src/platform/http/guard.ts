// Охрана входа HTTP (SEC-01, NFR-24, R40, ADR-0016): заголовки безопасности, проверка Host против DNS-rebinding,
// защита изменяющих запросов от CSRF по Origin и Sec-Fetch-Site, request-id. Чистые функции: решение принимается
// по заголовкам и имени слушателя, а не по IP — в контейнере IP клиента всегда адрес шлюза Docker (ADR-0016).
// X-Forwarded-* не читаются вовсе: прокси перед сервером нет (без trustProxy), подделать их может любой клиент.
import { randomUUID } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";

/** Слушатель: local — только этот компьютер (127.0.0.1:8140), lan — сеть (8141, открывается настройкой). */
export type ListenerName = "local" | "lan";

/**
 * Заголовки безопасности на каждом ответе — и на ошибках, и на статике (SEC-01). Без HSTS и
 * upgrade-insecure-requests: сайт работает по HTTP на localhost и в домашней сети, они бы его сломали.
 * Камера и микрофон — только свой origin: фото чека и голосовой ввод (RCPT, CHAT).
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
    "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; " +
    "form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(self), microphone=(self)",
};

/** Имена этого компьютера, которые принимает любой слушатель. */
const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Имя хоста из заголовка Host без порта, в нижнем регистре; IPv6 — в скобках. Неразборчивый — undefined. */
export function hostName(host: string | undefined): string | undefined {
  if (host === undefined || host === "") return undefined;
  const match = /^(\[[0-9a-fA-F:.]+\]|[^:[\]]+)(?::(\d{1,5}))?$/.exec(host);
  return match?.[1]?.toLowerCase();
}

/**
 * Host допустим для слушателя: local — только имена этого компьютера; lan — они же и IP-адреса (так открывают
 * сайт с телефона: http://192.168.1.5:8141). Доменные имена отвергаются всегда: иначе страница чужого сайта,
 * чьё имя перепривязали на 127.0.0.1 (DNS-rebinding), читала бы ответы как свои.
 */
export function isAllowedHost(host: string | undefined, listener: ListenerName): boolean {
  const name = hostName(host);
  if (name === undefined) return false;
  if (LOOPBACK_NAMES.has(name)) return true;
  if (listener === "local") return false;
  return isIPv4(name) || (name.startsWith("[") && isIPv6(name.slice(1, -1)));
}

/** Методы, которые ничего не меняют: CSRF-проверка их не касается. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface CsrfInput {
  readonly method: string;
  readonly host: string | undefined;
  readonly origin: string | undefined;
  readonly secFetchSite: string | undefined;
  readonly trustedOrigins: readonly string[];
}

/**
 * Изменяющий запрос пришёл со своего сайта (SEC-01, ADR-0016). Порядок: Sec-Fetch-Site первым — его выставляет
 * браузер, и TRUSTED_ORIGINS его не отменяет; затем Origin — свой (http://<Host с портом>) или из TRUSTED_ORIGINS.
 * Оба заголовка пусты — запрос не из браузера (curl, тесты): cookie сессии у него нет — нечего подделывать.
 */
export function isSameSiteRequest(input: CsrfInput): boolean {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return true;
  const site = input.secFetchSite?.toLowerCase();
  if (site === "cross-site" || site === "same-site") return false;
  if (input.origin === undefined) return true;
  if (input.host !== undefined && input.origin === `http://${input.host.toLowerCase()}`)
    return true;
  return input.trustedOrigins.includes(input.origin);
}

/** Формат request-id клиента: иначе в лог и ответ попал бы произвольный текст. */
const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/** request-id клиента, если он по шаблону, иначе новый (OBS-01: сквозной id запроса). */
export function requestIdFrom(header: string | undefined): string {
  return header !== undefined && REQUEST_ID.test(header) ? header : randomUUID();
}

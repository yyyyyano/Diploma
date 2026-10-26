// Поля записи лога — белый список (OBS-04, ADR-0010): и типом, и во время выполнения. Разрешены:
// - id: ключ `<что-то>Id` со значением uuid (receiptId, userId) — внутренние id, не email и не номер счёта;
// - числа: длительность, счётчики, размеры, порт, HTTP-статус;
// - машинные токены: коды ошибок, имена настроек, правил, задач, таблиц — латиница без пробелов;
// - err: ошибка (serialize-error.ts).
// Чужое поле, значение не той формы — отбрасываются, в строку попадает только их число (droppedFields).
// requestId, uid, source здесь нет: их подмешивает контекст (context.ts), подменить их полем нельзя.
import { serializeError } from "./serialize-error.ts";

const NUMBER_FIELDS = [
  "ms",
  "count",
  "total",
  "size",
  "bytes",
  "limit",
  "attempt",
  "port",
  "httpStatus",
  "version",
] as const;
const TOKEN_FIELDS = [
  "code",
  "reason",
  "status",
  "role",
  "job",
  "event",
  "setting",
  "secret",
  "rule",
  "table",
  "method",
  "route",
  "listener",
  "template",
  "transport",
] as const;

type NumberField = (typeof NUMBER_FIELDS)[number];
type TokenField = (typeof TOKEN_FIELDS)[number];

/** Поля, которые можно передать в запись лога. */
export type LogFields = { readonly [K in `${string}Id`]?: string } & {
  readonly [K in NumberField]?: number;
} & { readonly [K in TokenField]?: string } & { readonly err?: unknown };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_KEY = /^[a-z][A-Za-z0-9]*Id$/;
const TOKEN = /^[A-Za-z0-9_][A-Za-z0-9_.:/-]{0,99}$/;
/** Ключи контекста: только из AsyncLocalStorage. */
const CONTEXT_KEYS = new Set(["requestId", "uid", "source"]);
const NUMBERS = new Set<string>(NUMBER_FIELDS);
const TOKENS = new Set<string>(TOKEN_FIELDS);

/** Поля для записи: только из белого списка и только нужной формы. */
export function pickFields(fields: object): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (allowed(key, value)) {
      picked[key] = key === "err" ? serializeError(value) : value;
    } else {
      dropped += 1;
    }
  }
  if (dropped > 0) picked["droppedFields"] = dropped;
  return picked;
}

function allowed(key: string, value: unknown): boolean {
  if (key === "err") return true;
  if (CONTEXT_KEYS.has(key)) return false;
  if (NUMBERS.has(key)) return typeof value === "number" && Number.isFinite(value);
  if (TOKENS.has(key)) return typeof value === "string" && TOKEN.test(value);
  return ID_KEY.test(key) && typeof value === "string" && UUID.test(value);
}

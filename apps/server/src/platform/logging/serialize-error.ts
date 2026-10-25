// Ошибка в логе (OBS-02, OBS-04): стек и контекст без данных. Три формы:
// - ошибка Postgres (есть code из 5 символов и severity): code, constraint, table, column, schema и кадры стека.
//   message, detail, where, hint не пишутся: в них значения строк («Key (name)=(Молоко 2,49) already exists»),
//   которых scrub не узнаёт;
// - DrizzleQueryError: в сообщении — параметры запроса (значения), пишутся только кадры стека и причина;
// - прочие: имя, код, reason и table (если это машинные токены), scrub(message) и кадры стека (первая строка стека — то же
//   сообщение, поэтому стек пишется без неё).
import { scrub } from "./scrub.ts";

export interface SerializedError {
  readonly type: string;
  readonly code?: string;
  readonly message?: string;
  readonly constraint?: string;
  readonly table?: string;
  readonly column?: string;
  readonly schema?: string;
  /** Причина отказа аудитора SQL (IsolationViolation) и подобные машинные коды. */
  readonly reason?: string;
  readonly stack: readonly string[];
  readonly cause?: SerializedError;
}

const PG_CODE = /^[0-9A-Z]{5}$/;
/** Имена и коды — машинные токены; иное (текст, значение) не пишется. */
const TOKEN = /^[A-Za-z_][A-Za-z0-9_.:-]{0,79}$/;
const MAX_MESSAGE = 500;
/**
 * Сколько текста видит scrub: его regexp email на длинной строке без «@» работает за квадратичное время (200 тыс.
 * символов — ~20 с). Обрезок на границе (часть email или карты) в лог не попадёт: замены сокращают текст не больше
 * чем в 9 раз (IBAN BY с пробелом между каждым знаком, 52 → 6 символов), и граница 8000 после scrub остаётся
 * дальше MAX_MESSAGE, — поэтому и сообщение, и кадр стека режутся до MAX_MESSAGE после scrub.
 */
const MAX_SCRUB_INPUT = 8_000;
const MAX_FRAMES = 30;
const MAX_DEPTH = 3;

/** Ошибка или любое брошенное значение → объект для лога. */
export function serializeError(thrown: unknown, depth = 0): SerializedError {
  if (!(thrown instanceof Error)) {
    // Брошена не ошибка (строка, объект): её содержимое — потенциальные данные, пишется только вид.
    return { type: thrown === null ? "null" : typeof thrown, stack: [] };
  }
  const record = thrown as Error & Record<string, unknown>;
  const type = token(thrown.name) ?? "Error";
  const stack = frames(thrown.stack);
  const cause =
    depth < MAX_DEPTH && record["cause"] !== undefined
      ? { cause: serializeError(record["cause"], depth + 1) }
      : {};
  const code = typeof record["code"] === "string" ? record["code"] : undefined;
  if (code !== undefined && PG_CODE.test(code) && typeof record["severity"] === "string") {
    return {
      type,
      code,
      ...tokens(record, ["constraint", "table", "column", "schema"]),
      stack,
      ...cause,
    };
  }
  if (thrown.name === "DrizzleQueryError") return { type, stack, ...cause };
  const safeCode = code === undefined ? undefined : token(code);
  return {
    type,
    ...(safeCode === undefined ? {} : { code: safeCode }),
    ...tokens(record, ["reason", "table"]),
    message: scrub(thrown.message.slice(0, MAX_SCRUB_INPUT)).slice(0, MAX_MESSAGE),
    stack,
    ...cause,
  };
}

/** Кадры стека («at …»), без строки сообщения. */
function frames(stack: string | undefined): string[] {
  return (stack ?? "")
    .split("\n")
    .filter((line) => /^\s+at\s/.test(line))
    .slice(0, MAX_FRAMES)
    .map((line) => scrub(line.trim().slice(0, MAX_SCRUB_INPUT)).slice(0, MAX_MESSAGE));
}

function token(value: unknown): string | undefined {
  return typeof value === "string" && TOKEN.test(value) ? value : undefined;
}

function tokens(record: Record<string, unknown>, keys: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of keys) {
    const value = token(record[key]);
    if (value !== undefined) result[key] = value;
  }
  return result;
}

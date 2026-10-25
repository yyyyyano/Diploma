// Ошибка в логе (OBS-02, OBS-04): стек и контекст без данных. Три формы:
// - ошибка Postgres (есть code из 5 символов и severity): code, constraint, table, column, schema и кадры стека.
//   message, detail, where, hint не пишутся: в них значения строк («Key (name)=(Молоко 2,49) already exists»),
//   которых scrub не узнаёт;
// - DrizzleQueryError: в сообщении — параметры запроса (значения), пишутся только кадры стека и причина;
// - прочие: имя, код, reason и table (если это машинные токены), scrub(message) (длиннее 1 млн символов — не пишется)
//   и кадры стека (первая строка стека — то же сообщение, поэтому стек пишется без неё).
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
 * Текст длиннее — не пишется вовсе (OBS-04). Срезать его до scrub нельзя: обрезок на границе (`ivan.petrov@mai`,
 * `4111 1111 1111 1`, `BY13 NBRB 3600`) scrub уже не узнаёт, а замены сжимают текст без предела (email любой длины →
 * `[email]`), так что обрезок попадает в первые MAX_MESSAGE символов. Поэтому scrub видит текст целиком (он линеен:
 * 1 млн символов — десятки мс), а потерять сообщение длиной в мегабайт дешевле, чем записать ПД.
 */
const MAX_SCRUB_INPUT = 1_000_000;
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
    ...(thrown.message.length > MAX_SCRUB_INPUT ? {} : { message: scrubbed(thrown.message) }),
    stack,
    ...cause,
  };
}

/** Кадры стека («at …»), без строки сообщения. */
function frames(stack: string | undefined): string[] {
  return (stack ?? "")
    .split("\n")
    .filter((line) => /^\s+at\s/.test(line) && line.length <= MAX_SCRUB_INPUT)
    .slice(0, MAX_FRAMES)
    .map((line) => scrubbed(line.trim()));
}

/** scrub по всему тексту, затем обрезка: замены уже сделаны, обрывается только безопасный текст. */
function scrubbed(text: string): string {
  return scrub(text).slice(0, MAX_MESSAGE);
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

// Локальная NER для маскирования (PRIV-03, ADR-0009): русская модель имён и адресов (onnx-community/
// bert-base-NER-Russian-ONNX, int8, ~178 МБ, MIT) на @huggingface/transformers + onnxruntime-node, без сети: файлы
// лежат в `<DATA_DIR>/models/ner/` (скачивает загрузчик, NFR-25). Модель размечает токены метками BIOUL по типам
// (FIRST_NAME, LAST_NAME, MIDDLE_NAME, CITY, STREET, HOUSE…); здесь токены собираются в отрезки текста: имена — в `name`,
// улица и дом (с примыкающим городом) — в `address`. Порог уверенности ≥ 0,8: ниже — «Немиге» (0,42) и подобное — шум.
// Модели нет — режим деградации: возвращается пусто, а маскируют правила и словарь пользователя; об этом — строка лога.
// Лёгкий вызов: библиотека грузится лениво, при первом тексте и только если файлы на месте.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "../../../../platform/logging/logger.ts";
import type { NameRecognizer } from "../../application/ports.ts";
import type { Span } from "../../domain/masking/rules.ts";

/** Токен в виде, который отдаёт конвейер token-classification: метка BIOUL, уверенность, кусок слова. */
export interface NerToken {
  readonly entity: string;
  readonly score: number;
  readonly word: string;
}

export type TokenClassifier = (text: string) => Promise<readonly NerToken[]>;

/** Файлы модели относительно `<папка моделей>/ner/` — без любого из них NER не работает. */
export const NER_REQUIRED_FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "onnx/model_int8.onnx",
] as const;

export const NER_THRESHOLD = 0.8;
/** Длина куска текста: модель читает не больше 512 токенов; русскому тексту хватает ~1500 знаков. */
const CHUNK = 1500;

const NAME_TYPES = new Set(["FIRST_NAME", "LAST_NAME", "MIDDLE_NAME"]);
const ADDRESS_CORE = new Set(["STREET", "HOUSE"]);
const ADDRESS_NEIGHBOUR = new Set(["CITY", "DISTRICT"]);

interface Group {
  kind: "name" | "address";
  start: number;
  end: number;
  core: boolean;
}

/** Метка `B-FIRST_NAME` → тип `FIRST_NAME`; `O` и неизвестное — undefined. */
function typeOf(entity: string): string | undefined {
  const match = /^[BILU]-([A-Z_]+)$/.exec(entity);
  return match?.[1];
}

/** Токены → отрезки текста. Смещения ищутся по самим кускам слов по порядку (конвейер их не отдаёт). */
export function spansFromTokens(
  text: string,
  tokens: readonly NerToken[],
  threshold = NER_THRESHOLD,
): Span[] {
  const lower = text.toLowerCase();
  let cursor = 0;
  const groups: Group[] = [];
  let open: Group | undefined;
  for (const token of tokens) {
    const word = token.word.replace(/^##/, "").toLowerCase();
    if (word === "" || word.startsWith("[")) continue;
    const start = lower.indexOf(word, cursor);
    if (start === -1) continue;
    const end = start + word.length;
    cursor = end;
    const type = typeOf(token.entity);
    const kind = type === undefined ? undefined : NAME_TYPES.has(type) ? "name" : "address";
    const relevant =
      type !== undefined &&
      token.score >= threshold &&
      (NAME_TYPES.has(type) || ADDRESS_CORE.has(type) || ADDRESS_NEIGHBOUR.has(type));
    if (!relevant || kind === undefined || type === undefined) {
      open = undefined;
      continue;
    }
    const gap = open === undefined ? "" : text.slice(open.end, start);
    const joins =
      open !== undefined &&
      open.kind === kind &&
      (kind === "name" ? /^\s{0,2}$/.test(gap) : /^[\s,.\p{L}]{0,6}$/u.test(gap));
    if (open !== undefined && joins) {
      open.end = end;
      open.core ||= ADDRESS_CORE.has(type);
    } else {
      open = { kind, start, end, core: ADDRESS_CORE.has(type) };
      groups.push(open);
    }
  }
  // Город или район сам по себе — не адрес: без улицы и дома такая группа отбрасывается.
  return groups
    .filter((group) => group.kind === "name" || group.core)
    .map(({ kind, start, end }) => ({ start, end, kind }));
}

/** Кусками по ~1500 знаков по границам пробелов: смещение куска прибавляется к смещениям внутри. */
export function chunksOf(text: string, size = CHUNK): { start: number; text: string }[] {
  const chunks: { start: number; text: string }[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) {
      const space = text.lastIndexOf(" ", end);
      if (space > start) end = space + 1;
    }
    chunks.push({ start, text: text.slice(start, end) });
    start = end;
  }
  return chunks;
}

/** В лог — только класс ошибки: сообщение onnxruntime может содержать кусок обрабатываемого текста (OBS-04). */
const nameOf = (error: unknown): string =>
  error instanceof Error && /^[A-Za-z]+$/.test(error.name) ? error.name : "UNKNOWN";

export interface NerDeps {
  /** Загрузить классификатор; нет модели — undefined (режим деградации). */
  readonly load: () => Promise<TokenClassifier | undefined>;
  readonly log: Logger;
  readonly now: () => number;
  /** Через сколько повторять поиск модели, если её не было (докачалась после старта), мс. */
  readonly retryMs?: number;
  readonly threshold?: number;
}

export interface Ner extends NameRecognizer {
  /** Модель на месте и загружена (для админки: «NER скачана»). */
  available(): Promise<boolean>;
}

export function createNerRecognizer(d: NerDeps): Ner {
  let loaded: Promise<TokenClassifier | undefined> | undefined;
  let checkedAt = Number.NEGATIVE_INFINITY;
  let warned = false;
  // Один и тот же текст (системная подсказка, история диалога) приходит на каждом шаге агента: разбор запоминается.
  const memo = new Map<string, readonly Span[]>();
  const MEMO_LIMIT = 200;

  async function classifier(): Promise<TokenClassifier | undefined> {
    if (loaded !== undefined) {
      const current = await loaded;
      if (current !== undefined || d.now() - checkedAt < (d.retryMs ?? 30_000)) return current;
    }
    checkedAt = d.now();
    loaded = d.load().catch((error: unknown) => {
      d.log.warn({ code: "NER_LOAD", reason: nameOf(error) }, "llm.ner-load-failed");
      return undefined;
    });
    const result = await loaded;
    if (result === undefined && !warned) {
      warned = true;
      d.log.warn({ reason: "model-absent" }, "llm.ner-absent");
    }
    return result;
  }

  return {
    available: async () => (await classifier()) !== undefined,
    async recognize(text) {
      const classify = await classifier();
      if (classify === undefined || text.trim() === "") return [];
      const known = memo.get(text);
      if (known !== undefined) return known;
      const spans: Span[] = [];
      for (const chunk of chunksOf(text)) {
        try {
          const found = spansFromTokens(chunk.text, await classify(chunk.text), d.threshold);
          spans.push(
            ...found.map((span) => ({
              ...span,
              start: span.start + chunk.start,
              end: span.end + chunk.start,
            })),
          );
        } catch (error) {
          // Сбой NER не останавливает вызов: правила и словарь всё равно сработают; сам сбой — в лог.
          d.log.warn({ code: "NER_RUN", reason: nameOf(error) }, "llm.ner-failed");
        }
      }
      if (memo.size >= MEMO_LIMIT) memo.delete(memo.keys().next().value ?? "");
      memo.set(text, spans);
      return spans;
    },
  };
}

/** Классификатор на transformers.js из папки моделей; файлов нет — undefined, библиотека не загружается. */
export async function loadTransformersClassifier(
  modelsDir: string,
): Promise<TokenClassifier | undefined> {
  if (!NER_REQUIRED_FILES.every((file) => existsSync(join(modelsDir, "ner", file))))
    return undefined;
  const { env, pipeline } = await import("@huggingface/transformers");
  // Только локальные файлы: ни одного запроса в интернет (NFR-11, NFR-16).
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = `${modelsDir}/`;
  const run = await pipeline("token-classification", "ner", { dtype: "int8" });
  return async (text) => (await run(text)) as NerToken[];
}

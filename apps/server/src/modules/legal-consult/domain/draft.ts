// Разбор черновика ответа модели (LEGAL-03, CHAT-10): метки `[[F<id версии фрагмента>]]` и `[[A<id акта на pravo.by>]]`, вольные
// цитаты в кавычках и их привязка к меткам. Формат цитирования для модели — «цитата» [[F…]]: цитата прямо перед меткой проверяется
// на дословность (verbatim.ts), метка без цитаты подставляет текст фрагмента целиком. Чистая функция, без БД и модели.

const MARK = /\[\[([^[\]\n]{0,80})\]\]/gu;
const FRAGMENT_ID = /^F([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/iu;
const ACT_ID = /^A([A-Za-z][A-Za-z0-9]{5,11})$/u;
// «…» (с одним уровнем вложенных «ёлочек»), „…“ / „…”, “…”, "…".
const QUOTE = /«((?:[^«»]|«[^«»]*»)*)»|„([^„“”]*)[“”]|“([^“”]*)”|"([^"]*)"/gu;
/** Между закрывающей кавычкой и меткой допустимы пробелы и знаки препинания: «…», [[F]] / «…»: [[F]]. */
const GLUE = /^[\s.,;:)\]]{0,4}$/u;
/** Между метками одной цитаты: «…» [[F1]], [[F2]]. */
const BETWEEN_MARKS = /^[\s,;]*$/u;

export type ScanItem =
  | { readonly type: "text"; readonly text: string }
  /** Вольная цитата: `text` — без внешних кавычек, `raw` — как в черновике; `markIndexes` — метки, к которым она привязана. */
  | {
      readonly type: "quote";
      readonly text: string;
      readonly raw: string;
      readonly markIndexes: readonly number[];
    }
  /** `invalid` — метка не того вида (`[[F12.2]]`, не uuid): в ответ не попадает, но считается (нельзя проверить). */
  | {
      readonly type: "mark";
      readonly index: number;
      readonly kind: "fragment" | "act" | "invalid";
      readonly id: string;
    };

type Token =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "mark"; readonly kind: "fragment" | "act" | "invalid"; readonly id: string };

function classify(inner: string): { kind: "fragment" | "act" | "invalid"; id: string } {
  const fragment = FRAGMENT_ID.exec(inner);
  if (fragment?.[1] !== undefined) return { kind: "fragment", id: fragment[1].toLowerCase() };
  const act = ACT_ID.exec(inner);
  if (act?.[1] !== undefined) return { kind: "act", id: act[1] };
  return { kind: "invalid", id: "" };
}

function tokenize(draft: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of draft.matchAll(MARK)) {
    if (match.index > last) tokens.push({ type: "text", text: draft.slice(last, match.index) });
    tokens.push({ type: "mark", ...classify(match[1] ?? "") });
    last = match.index + match[0].length;
  }
  if (last < draft.length) tokens.push({ type: "text", text: draft.slice(last) });
  return tokens;
}

interface Span {
  readonly start: number;
  readonly end: number;
  readonly inner: string;
}

function quoteSpans(text: string): Span[] {
  return [...text.matchAll(QUOTE)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    inner: m[1] ?? m[2] ?? m[3] ?? m[4] ?? "",
  }));
}

/**
 * Метка внутри кавычек («вычет 217 рублей [[F…]]») — та же цитата с меткой: выносим метку за закрывающую кавычку, иначе слова
 * модели остались бы в ответе непроверенными.
 */
function hoistMarks(draft: string): string {
  return draft.replace(QUOTE, (whole) => {
    const marks = [...whole.matchAll(MARK)].map((m) => m[0]);
    if (marks.length === 0) return whole;
    const open = whole.slice(0, 1);
    const close = whole.slice(-1);
    const inner = whole.slice(1, -1).replace(MARK, "").replace(/\s+/gu, " ").trim();
    return `${open}${inner}${close} ${marks.join("")}`;
  });
}

/** Разобрать черновик на текст, цитаты и метки; номера меток — сквозные, по порядку появления. */
export function scanDraft(rawDraft: string): ScanItem[] {
  const draft = hoistMarks(rawDraft);
  const tokens = tokenize(draft);
  // Номер метки по позиции токена.
  const markAt = new Map<number, number>();
  tokens.forEach((token, at) => {
    if (token.type === "mark") markAt.set(at, markAt.size);
  });
  const items: ScanItem[] = [];
  tokens.forEach((token, at) => {
    if (token.type === "mark") {
      items.push({
        type: "mark",
        index: markAt.get(at) ?? 0,
        kind: token.kind,
        id: token.id,
      });
      return;
    }
    const spans = quoteSpans(token.text);
    // Привязана только последняя цитата токена: она стоит прямо перед меткой, дальше — другое предложение.
    const lastSpan = spans[spans.length - 1];
    const next = tokens[at + 1];
    const attached =
      lastSpan !== undefined && next?.type === "mark" && GLUE.test(token.text.slice(lastSpan.end))
        ? collectMarks(tokens, at + 1, markAt)
        : [];
    let cursor = 0;
    for (const span of spans) {
      if (span.start > cursor) {
        items.push({ type: "text", text: token.text.slice(cursor, span.start) });
      }
      items.push({
        type: "quote",
        text: span.inner,
        raw: token.text.slice(span.start, span.end),
        markIndexes: span === lastSpan ? attached : [],
      });
      cursor = span.end;
    }
    if (cursor < token.text.length) items.push({ type: "text", text: token.text.slice(cursor) });
  });
  return items;
}

/** Метки, идущие подряд с токена `from` (через пробелы, запятые и точки с запятой). */
function collectMarks(tokens: readonly Token[], from: number, markAt: ReadonlyMap<number, number>) {
  const indexes: number[] = [];
  for (let at = from; at < tokens.length; at += 1) {
    const token = tokens[at];
    if (token?.type === "mark") {
      indexes.push(markAt.get(at) ?? 0);
    } else if (token !== undefined && !BETWEEN_MARKS.test(token.text)) {
      break;
    }
  }
  return indexes;
}

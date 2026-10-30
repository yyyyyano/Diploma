// Разбор акта на фрагменты (LAW-20): из последовательности абзацев страницы pravo.by — в дерево «раздел → глава →
// статья → пункт → подпункт» и плоский список цитируемых единиц. Чистая функция: HTML читает infrastructure/pravo-by
// (cheerio), здесь только правила разреза. Вёрстка страниц — экспорт из Word/ЭТАЛОН: классы `article` и `point` есть, но
// главы, подпункты и приложения опознаются ещё и по тексту (LAW-39: вёрстка меняется, правила не должны на неё опираться).
import { createHash } from "node:crypto";

/** Вид фрагмента (LAW-20). */
export const FRAGMENT_KINDS = [
  "norm",
  "definitions",
  "transitional",
  "effective-date",
  "appendix",
] as const;
export type FragmentKind = (typeof FRAGMENT_KINDS)[number];

/** Абзац страницы: класс вёрстки и видимый текст (надстрочные цифры уже в Юникоде: «216¹»). */
export interface RawParagraph {
  readonly cls: string;
  readonly text: string;
}

export interface ParsedFragment {
  /** Ключ пути, стабильный между редакциями: `a216.1/p3/s2` (LAW-31). */
  readonly pathKey: string;
  /** Номер статьи с ключом `216.1` для надстрочных (ADR-0007); у указов без статей — null. */
  readonly articleNo: string | null;
  readonly position: number;
  readonly kind: FragmentKind;
  /** «НК › Глава 16 › Статья 209 › п. 1»: приписывается к тексту для поиска, цитаты проверяются по `body`. */
  readonly searchPath: string;
  readonly heading: string | null;
  readonly body: string;
  readonly excluded: boolean;
  readonly textHash: string;
}

export interface ParsedAct {
  readonly fragments: readonly ParsedFragment[];
  /** Сколько статей (у актов без статей — пунктов верхнего уровня): сверка канарейки (LAW-39). */
  readonly articleCount: number;
  /** Статья или пункт верхнего уровня найдены хотя бы раз. */
  readonly hasStructure: boolean;
}

/** Длиннее — режем по пунктам и подпунктам (в НК есть статьи длиной 65 тыс. знаков, LAW-20). */
export const FRAGMENT_LIMIT_CHARS = 3000;

const SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const ARTICLE = /^Статья\s+(\d+(?:[⁰¹²³⁴⁵⁶⁷⁸⁹]+|\.\d+)?)\.?\s*(.*)$/su;
const CHAPTER = /^ГЛАВА\s+(\d+(?:[⁰¹²³⁴⁵⁶⁷⁸⁹]+)?)\.?\s*(.*)$/isu;
const SECTION = /^(РАЗДЕЛ|ПОДРАЗДЕЛ)\s+([IVXLCDM\d]+(?:[⁰¹²³⁴⁵⁶⁷⁸⁹]+)?)\.?\s*(.*)$/su;
const PART = /^(ОБЩАЯ|ОСОБЕННАЯ)\s+ЧАСТЬ\s*$/su;
// \b в JS не видит кириллицу как слово: границу задаём явно.
const APPENDIX = /^ПРИЛОЖЕНИЕ(?:\s|$)/u;
const POINT = /^(\d+(?:\.\d+)*)\.\s+(.*)$/su;
const SUBPOINT = /^(\d+)\)\s+(.*)$/su;
const EXCLUDED = /^(?:исключен[аоы]?|утратил[аои]? силу)\.?$/iu;
/** Вспомогательные абзацы шапки: название, номер и дата, гриф — не тело акта. */
const HEADER_CLASSES = new Set([
  "titlek",
  "titlep",
  "title",
  "datepr",
  "number",
  "capr",
  "zagrazdel",
]);

/** «216¹» → «216.1»: ключ статьи с надстрочным номером (ADR-0007). */
export function articleKey(raw: string): string {
  let out = "";
  let sup = false;
  for (const ch of raw) {
    const at = SUPERSCRIPT.indexOf(ch);
    if (at >= 0) {
      if (!sup) out += ".";
      out += String(at);
      sup = true;
    } else {
      out += ch;
      sup = false;
    }
  }
  return out;
}

/** Хэш чистого текста версии: по нему узнают неизменённый фрагмент (LAW-31). */
export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

interface SubPoint {
  readonly no: string;
  lines: string[];
}
interface Point {
  readonly no: string;
  lines: string[];
  readonly subs: SubPoint[];
}
interface Article {
  readonly no: string;
  readonly heading: string;
  readonly lead: string[];
  readonly points: Point[];
  readonly trail: string;
}

export interface ActLabels {
  /** Как акт назван в пути поиска: «НК (Особенная часть)», «Закон № 90-З». */
  readonly label: string;
}

/** Разрезать абзацы акта на фрагменты. */
export function buildFragments(paragraphs: readonly RawParagraph[], act: ActLabels): ParsedAct {
  const out: ParsedFragment[] = [];
  const used = new Set<string>();
  let articleCount = 0;
  let part: string | undefined;
  let section: string | undefined;
  let chapter: string | undefined;
  let article: Article | undefined;
  let standalone: Point | undefined;
  let intro: string[] = [];
  let seenStructure = false;
  let appendix: { title: string; lines: string[] } | undefined;
  let appendixNo = 0;

  const trailOf = (): string =>
    [act.label, part, section, chapter].filter((x): x is string => x !== undefined).join(" › ");

  function push(
    key: string,
    f: {
      articleNo: string | null;
      kind: FragmentKind;
      searchPath: string;
      heading: string | null;
      body: string;
      excluded?: boolean;
    },
  ): void {
    let unique = key;
    for (let n = 2; used.has(unique); n += 1) unique = `${key}~${String(n)}`;
    used.add(unique);
    out.push({
      pathKey: unique,
      articleNo: f.articleNo,
      position: out.length,
      kind: f.kind,
      searchPath: f.searchPath,
      heading: f.heading,
      body: f.body,
      excluded: f.excluded ?? false,
      textHash: hashText(f.body),
    });
  }

  /** Разделить длинный текст на куски по абзацам, не длиннее предела (приложения, преамбула). */
  function chunk(lines: readonly string[]): string[] {
    const chunks: string[] = [];
    let current = "";
    for (const line of lines) {
      if (current !== "" && current.length + line.length + 1 > FRAGMENT_LIMIT_CHARS) {
        chunks.push(current);
        current = "";
      }
      current = current === "" ? line : `${current}\n${line}`;
    }
    if (current !== "") chunks.push(current);
    return chunks;
  }

  function pointText(p: Point): string {
    return [...p.lines, ...p.subs.flatMap((s) => s.lines)].join("\n");
  }

  /** Пункт — одним фрагментом или, если длинный, пунктом без подпунктов и подпунктами. */
  function emitPoint(p: Point, keyBase: string, path: string, articleNo: string | null): void {
    const full = pointText(p);
    const split = full.length > FRAGMENT_LIMIT_CHARS && p.subs.length > 0;
    const label = `п. ${p.no}`;
    push(keyBase, {
      articleNo,
      kind: "norm",
      searchPath: `${path} › ${label}`,
      heading: null,
      body: split ? p.lines.join("\n") : full,
    });
    if (!split) return;
    for (const sub of p.subs) {
      push(`${keyBase}/s${sub.no}`, {
        articleNo,
        kind: "norm",
        searchPath: `${path} › ${label} › пп. ${sub.no})`,
        heading: null,
        body: sub.lines.join("\n"),
      });
    }
  }

  function kindOf(heading: string, firstLine: string): FragmentKind {
    const h = heading.toLowerCase();
    if (h.includes("основные понятия") || h.includes("основные термины")) return "definitions";
    if (/используются\s+(?:следующие\s+)?(?:основные\s+)?(?:термины|понятия)/iu.test(firstLine)) {
      return "definitions";
    }
    if (h.includes("вступлен") && h.includes("сил")) return "effective-date";
    if (h.includes("переходн")) return "transitional";
    return "norm";
  }

  function flushArticle(): void {
    if (article === undefined) return;
    const a = article;
    article = undefined;
    const headingLine = `Статья ${a.no}. ${a.heading}`.trimEnd();
    const key = articleKey(a.no);
    const path = `${a.trail} › Статья ${a.no}`;
    const lines = [headingLine, ...a.lead, ...a.points.map((p) => pointText(p))];
    const full = lines.join("\n");
    const excluded =
      a.points.length === 0 && a.lead.length === 0 && EXCLUDED.test(a.heading.trim().toLowerCase());
    const kind = kindOf(a.heading, a.lead[0] ?? a.points[0]?.lines[0] ?? "");
    if (full.length <= FRAGMENT_LIMIT_CHARS || a.points.length === 0) {
      // Одна статья — один фрагмент, если короткая (или без пунктов: резать нечем, режем по абзацам).
      const bodies = full.length <= FRAGMENT_LIMIT_CHARS ? [full] : chunk(lines);
      bodies.forEach((body, i) =>
        push(i === 0 ? `a${key}` : `a${key}/c${String(i + 1)}`, {
          articleNo: key,
          kind,
          searchPath: path,
          heading: a.heading === "" ? null : a.heading,
          body,
          excluded,
        }),
      );
      return;
    }
    push(`a${key}`, {
      articleNo: key,
      kind,
      searchPath: path,
      heading: a.heading === "" ? null : a.heading,
      body: [headingLine, ...a.lead].join("\n"),
    });
    for (const p of a.points) emitPoint(p, `a${key}/p${p.no}`, path, key);
  }

  function flushStandalone(): void {
    if (standalone === undefined) return;
    const p = standalone;
    standalone = undefined;
    emitPoint(p, `p${p.no}`, trailOf(), null);
  }

  function flushIntro(): void {
    chunk(intro).forEach((body, i) =>
      push(i === 0 ? "intro" : `intro/c${String(i + 1)}`, {
        articleNo: null,
        kind: "norm",
        searchPath: `${trailOf()} › Вступление`,
        heading: null,
        body,
      }),
    );
    intro = [];
  }

  function flushAppendix(): void {
    if (appendix === undefined) return;
    const app = appendix;
    appendix = undefined;
    appendixNo += 1;
    chunk([app.title, ...app.lines]).forEach((body, i) =>
      push(`app${String(appendixNo)}/c${String(i + 1)}`, {
        articleNo: null,
        kind: "appendix",
        searchPath: `${act.label} › ${app.title}`,
        heading: app.title,
        body,
      }),
    );
  }

  function startStructure(): void {
    if (!seenStructure) {
      seenStructure = true;
      flushIntro();
    }
  }

  for (const raw of paragraphs) {
    const text = raw.text;
    if (text === "") continue;
    if (appendix !== undefined && !APPENDIX.test(text)) {
      appendix.lines.push(text);
      continue;
    }
    if (APPENDIX.test(text)) {
      flushArticle();
      flushStandalone();
      startStructure();
      flushAppendix();
      appendix = { title: text, lines: [] };
      continue;
    }
    const isArticle = raw.cls === "article" || ARTICLE.test(text);
    const articleMatch = isArticle ? ARTICLE.exec(text) : null;
    if (articleMatch !== null) {
      flushArticle();
      flushStandalone();
      startStructure();
      articleCount += 1;
      article = {
        no: articleMatch[1] ?? "",
        heading: (articleMatch[2] ?? "").trim(),
        lead: [],
        points: [],
        trail: trailOf(),
      };
      continue;
    }
    const partMatch = PART.exec(text);
    if (partMatch !== null) {
      flushArticle();
      flushStandalone();
      startStructure();
      part = text.charAt(0) + text.slice(1).toLowerCase();
      section = undefined;
      chapter = undefined;
      continue;
    }
    const sectionMatch = SECTION.exec(text);
    if (sectionMatch !== null) {
      flushArticle();
      flushStandalone();
      startStructure();
      section = `${(sectionMatch[1] ?? "").charAt(0)}${(sectionMatch[1] ?? "").slice(1).toLowerCase()} ${sectionMatch[2] ?? ""}`;
      chapter = undefined;
      continue;
    }
    const chapterMatch = CHAPTER.exec(text);
    if (chapterMatch !== null) {
      flushArticle();
      flushStandalone();
      startStructure();
      chapter = `Глава ${chapterMatch[1] ?? ""}`;
      continue;
    }
    if (!seenStructure && HEADER_CLASSES.has(raw.cls)) continue;
    const pointMatch = POINT.exec(text);
    const subMatch = SUBPOINT.exec(text);
    if (article !== undefined) {
      const last = article.points.at(-1);
      if (pointMatch !== null) {
        article.points.push({ no: pointMatch[1] ?? "", lines: [text], subs: [] });
      } else if (subMatch !== null && last !== undefined) {
        last.subs.push({ no: subMatch[1] ?? "", lines: [text] });
      } else if (last === undefined) {
        article.lead.push(text);
      } else {
        (last.subs.at(-1)?.lines ?? last.lines).push(text);
      }
      continue;
    }
    // Акты без статей (указы, постановления): единица — пункт.
    if (pointMatch !== null) {
      flushStandalone();
      startStructure();
      standalone = { no: pointMatch[1] ?? "", lines: [text], subs: [] };
      articleCount += 1;
      continue;
    }
    if (standalone !== undefined) {
      if (subMatch !== null) standalone.subs.push({ no: subMatch[1] ?? "", lines: [text] });
      else (standalone.subs.at(-1)?.lines ?? standalone.lines).push(text);
      continue;
    }
    if (!seenStructure) intro.push(text);
  }
  flushArticle();
  flushStandalone();
  flushAppendix();
  if (!seenStructure) flushIntro();
  return { fragments: out, articleCount, hasStructure: articleCount > 0 };
}

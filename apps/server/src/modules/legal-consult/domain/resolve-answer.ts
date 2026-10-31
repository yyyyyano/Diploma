// Подстановка меток и проверка вольных цитат (LEGAL-03…06, CHAT-10, P3). Чистое ядро: версии фрагментов и акты приходят готовыми
// (их читает application через legal-base), здесь нет ни БД, ни моделей, ни текстов для человека — только коды причин.
// Главное свойство: в ответ не попадает ни одного слова «из закона», которого нет в тексте версии. Блок цитаты — всегда текст
// версии как он сохранён; слова модели в кавычках остаются, только если прошли isVerbatim; непрошедшие заменяются ссылкой.
import type { ScanItem } from "./draft.ts";
import { isVerbatim, wordCount } from "./verbatim.ts";

/** Версия фрагмента для цитаты (структурно совпадает с `CitationSource` legal-base). */
export interface SourceVersion {
  readonly versionId: string;
  readonly pravoId: string;
  readonly actTitle: string;
  readonly pathKey: string;
  readonly articleNo: string | null;
  readonly path: string;
  readonly text: string;
  readonly excluded: boolean;
  readonly isCurrent: boolean;
  readonly actStatus: "active" | "repealed" | "excluded";
  readonly repealedOn: string | null;
  readonly hasText: boolean;
  readonly editionOn: string | null;
  readonly url: string;
}

/** Акт каталога для метки `[[A…]]`. */
export interface SourceAct {
  readonly pravoId: string;
  readonly title: string;
  readonly hasText: boolean;
  readonly status: "active" | "repealed" | "excluded";
  readonly repealedOn: string | null;
  readonly url: string;
}

/** Принятое, но не вступившее изменение акта (LAW-32). */
export interface PendingChange {
  readonly description: string;
  readonly inForceOn: string | null;
  readonly articles: readonly string[];
}

export type LinkReason =
  /** Акта нет текстом в базе: назвать и дать ссылку, не цитировать (LEGAL-06). */
  | "no-text"
  /** Цитата модели не прошла проверку на дословность: показана ссылка, а не цитата (LEGAL-03). */
  | "quote-unverified"
  | "excluded"
  | "repealed"
  /** Акт назван, но нормой в этом ответе не обоснован. */
  | "named";

export type Citation =
  | {
      readonly n: number;
      readonly kind: "quote";
      readonly versionId: string;
      readonly pravoId: string;
      readonly actTitle: string;
      readonly pathKey: string;
      readonly path: string;
      /** Дословный текст версии, как сохранён. */
      readonly text: string;
      readonly editionOn: string | null;
      readonly url: string;
      /** Версия с тех пор заменена новой редакцией (CHAT-10). */
      readonly changedSince: boolean;
      readonly warnings: readonly PendingChange[];
    }
  | {
      readonly n: number;
      readonly kind: "link";
      readonly reason: LinkReason;
      readonly pravoId: string;
      readonly actTitle: string;
      readonly pathKey: string | null;
      readonly path: string | null;
      readonly url: string;
      readonly repealedOn: string | null;
    };

export type ResolvedPart =
  | { readonly type: "text"; readonly text: string }
  /** Ссылка на блок цитаты `citations[n - 1]` в этом месте текста. */
  | { readonly type: "cite"; readonly n: number }
  /** Здесь стояла цитата, которую проверить нельзя: показывается пометка. */
  | { readonly type: "removed" };

export interface Resolved {
  readonly parts: readonly ResolvedPart[];
  readonly citations: readonly Citation[];
  /** Меток, которые не удалось подставить (нет версии, акт исключён, не тот вид). */
  readonly unresolved: number;
  /** Цитат, не прошедших проверку на дословность. */
  readonly droppedQuotes: number;
  /** Есть ли в ответе норма из базы: блок цитаты или ссылка на конкретную статью, акт без текста, исключённая/утратившая силу. */
  readonly grounded: boolean;
}

export interface ResolveInput {
  readonly items: readonly ScanItem[];
  readonly versions: ReadonlyMap<string, SourceVersion>;
  readonly acts: ReadonlyMap<string, SourceAct>;
  /** Принятые изменения по ID акта pravo.by. */
  readonly pending: ReadonlyMap<string, readonly PendingChange[]>;
  /** Цитата без метки рядом короче этого числа слов — не цитата закона (название, термин): остаётся как есть. */
  readonly minFreeWords: number;
}

/** Части ключа пути `a216.1/p3/s2/c2`: статья, пункт, подпункт, часть — подпись «ст. 216.1, п. 3, пп. 2». */
export function labelParts(pathKey: string): {
  article: string | null;
  point: string | null;
  subpoint: string | null;
  part: string | null;
} {
  const out = {
    article: null as string | null,
    point: null as string | null,
    subpoint: null as string | null,
    part: null as string | null,
  };
  for (const segment of pathKey.split("/")) {
    if (segment.startsWith("app") || segment === "intro") continue;
    const key = segment.slice(1);
    if (segment.startsWith("a")) out.article = key;
    else if (segment.startsWith("p")) out.point = key;
    else if (segment.startsWith("s")) out.subpoint = key;
    else if (segment.startsWith("c")) out.part = key;
  }
  return out;
}

/**
 * Изменения, относящиеся к статье (LAW-32): с разобранным перечнем статей — только названные, без перечня (не разбирали или
 * акт без статей) — ко всему акту: лучше лишнее предупреждение, чем молчание.
 */
export function pendingFor(
  changes: readonly PendingChange[],
  articleNo: string | null,
): PendingChange[] {
  return changes.filter(
    (c) => c.articles.length === 0 || (articleNo !== null && c.articles.includes(articleNo)),
  );
}

type MarkResolution =
  | { readonly type: "gone" }
  | {
      readonly type: "link";
      readonly reason: LinkReason;
      readonly subject: SourceVersion | SourceAct;
    }
  | { readonly type: "quotable"; readonly version: SourceVersion };

function resolveMark(
  item: Extract<ScanItem, { type: "mark" }>,
  input: ResolveInput,
): MarkResolution {
  if (item.kind === "fragment") {
    const version = input.versions.get(item.id);
    if (version === undefined || version.actStatus === "excluded") return { type: "gone" };
    if (version.actStatus === "repealed")
      return { type: "link", reason: "repealed", subject: version };
    if (version.excluded) return { type: "link", reason: "excluded", subject: version };
    return { type: "quotable", version };
  }
  if (item.kind === "act") {
    const act = input.acts.get(item.id);
    if (act === undefined || act.status === "excluded") return { type: "gone" };
    if (act.status === "repealed") return { type: "link", reason: "repealed", subject: act };
    return { type: "link", reason: act.hasText ? "named" : "no-text", subject: act };
  }
  return { type: "gone" };
}

const titleOf = (r: MarkResolution): string | null =>
  r.type === "gone"
    ? null
    : r.type === "quotable"
      ? r.version.actTitle
      : "title" in r.subject
        ? r.subject.title
        : r.subject.actTitle;

/** Дословна ли цитата хотя бы в одной из версий; название акта в кавычках — не цитата нормы. */
function quoteHolds(quote: string, among: readonly MarkResolution[]): boolean {
  return among.some((r) => {
    if (r.type === "quotable" && isVerbatim(quote, r.version.text)) return true;
    const title = titleOf(r);
    return title !== null && isVerbatim(quote, title);
  });
}

const GLUE = /^[\s.,;:)\]]{0,4}$/u;

export function resolveAnswer(input: ResolveInput): Resolved {
  const marks = input.items.flatMap((i) => (i.type === "mark" ? [i] : []));
  const resolutions = new Map<number, MarkResolution>(
    marks.map((m) => [m.index, resolveMark(m, input)]),
  );
  const all = [...resolutions.values()];

  // Вердикт по каждой цитате: оставить как есть или заменить ссылкой.
  const keep = new Map<ScanItem, boolean>();
  const failedQuoteOfMark = new Set<number>();
  for (const item of input.items) {
    if (item.type !== "quote") continue;
    const attached = item.markIndexes.map((i) => resolutions.get(i) ?? ({ type: "gone" } as const));
    let ok: boolean;
    if (attached.length > 0) ok = quoteHolds(item.text, attached);
    else ok = wordCount(item.text) < input.minFreeWords || quoteHolds(item.text, all);
    keep.set(item, ok);
    if (!ok) for (const i of item.markIndexes) failedQuoteOfMark.add(i);
  }

  const citations: Citation[] = [];
  const numbers = new Map<string, number>();
  const cite = (key: string, make: (n: number) => Citation): number => {
    const known = numbers.get(key);
    if (known !== undefined) return known;
    const n = citations.length + 1;
    citations.push(make(n));
    numbers.set(key, n);
    return n;
  };
  const link = (reason: LinkReason, subject: SourceVersion | SourceAct): number => {
    const isVersion = "versionId" in subject;
    const pravoId = subject.pravoId;
    const key = `l:${reason}:${isVersion ? subject.versionId : pravoId}`;
    return cite(key, (n) => ({
      n,
      kind: "link",
      reason,
      pravoId,
      actTitle: isVersion ? subject.actTitle : subject.title,
      pathKey: isVersion ? subject.pathKey : null,
      path: isVersion ? subject.path : null,
      url: subject.url,
      repealedOn: subject.repealedOn,
    }));
  };

  const parts: ResolvedPart[] = [];
  const pushText = (text: string) => {
    if (text === "") return;
    const last = parts[parts.length - 1];
    if (last?.type === "text") parts[parts.length - 1] = { type: "text", text: last.text + text };
    else parts.push({ type: "text", text });
  };

  let unresolved = 0;
  let droppedQuotes = 0;
  let skipGlue = false;
  for (const item of input.items) {
    const dropGlue = skipGlue;
    skipGlue = false;
    if (item.type === "text") {
      if (!(dropGlue && GLUE.test(item.text))) pushText(item.text);
    } else if (item.type === "quote") {
      if (keep.get(item) === true) {
        pushText(item.raw);
        continue;
      }
      droppedQuotes += 1;
      const gives = item.markIndexes.some((i) => resolutions.get(i)?.type !== "gone");
      if (item.markIndexes.length > 0) skipGlue = true;
      if (!gives) parts.push({ type: "removed" });
    } else {
      const res = resolutions.get(item.index) ?? ({ type: "gone" } as const);
      if (res.type === "gone") {
        unresolved += 1;
      } else if (res.type === "link") {
        parts.push({ type: "cite", n: link(res.reason, res.subject) });
      } else if (failedQuoteOfMark.has(item.index)) {
        parts.push({ type: "cite", n: link("quote-unverified", res.version) });
      } else {
        const v = res.version;
        const n = cite(`q:${v.versionId}`, (n) => ({
          n,
          kind: "quote",
          versionId: v.versionId,
          pravoId: v.pravoId,
          actTitle: v.actTitle,
          pathKey: v.pathKey,
          path: v.path,
          text: v.text,
          editionOn: v.editionOn,
          url: v.url,
          changedSince: !v.isCurrent,
          warnings: pendingFor(input.pending.get(v.pravoId) ?? [], v.articleNo),
        }));
        parts.push({ type: "cite", n });
      }
    }
  }

  return {
    parts,
    citations,
    unresolved,
    droppedQuotes,
    grounded: citations.some((c) => c.kind === "quote" || c.reason !== "named"),
  };
}

// Карантин снимка и канарейки (LAW-39): снимок, где пропало больше 5% фрагментов, нет статей или шапки или сломана
// кодировка, не применяется — остаётся прежняя редакция, администратор получает уведомление. Чистые проверки:
// решение «применить или в карантин» принимает сценарий загрузки, ничего автоматически не удаляется.
import type { ParsedAct } from "./build-fragments.ts";

/** Доля пропавших фрагментов, выше которой снимок не применяется (LAW-39). */
export const MAX_LOST_SHARE = 0.05;

/** Канарейка: известный акт с известным числом статей и заголовком — сверяется в каждом цикле. */
export interface Canary {
  readonly pravoId: string;
  readonly articleCount: number;
  /** Часть заголовка в любом регистре. */
  readonly titleIncludes: string;
}

/** Закон № 90-З «О защите прав потребителей» — 51 статья (LAW-39). */
export const CANARIES: readonly Canary[] = [
  { pravoId: "H10200090", articleCount: 51, titleIncludes: "защите прав потребителей" },
];

export type QuarantineReason =
  | "no-header"
  | "no-structure"
  | "broken-encoding"
  | "fragments-lost"
  | "canary-mismatch";

export interface SnapshotCheck {
  readonly title: string;
  readonly parsed: ParsedAct;
  /** Весь текст страницы после декодирования — для проверки кодировки. */
  readonly pageText: string;
  /** Действующие версии (путь и хэш текста); нет — акт грузится впервые. Перенумерованный фрагмент не считается пропавшим. */
  readonly previous?: readonly { readonly pathKey: string; readonly textHash: string }[];
  readonly canary?: Canary;
}

const MOJIBAKE = /[ÐÑ][\u0080-¿ŒœŠšŸŽžƒˆ˜–-›€]/gu;

/** Причины, по которым снимок нельзя применять; пусто — можно. */
export function assessSnapshot(check: SnapshotCheck): readonly QuarantineReason[] {
  const reasons: QuarantineReason[] = [];
  if (check.title.trim() === "") reasons.push("no-header");
  if (!check.parsed.hasStructure) reasons.push("no-structure");
  const replacement = check.pageText.split("\u{FFFD}").length - 1;
  const mojibake = check.pageText.match(MOJIBAKE)?.length ?? 0;
  if (replacement / Math.max(1, check.pageText.length) > 0.0005 || mojibake >= 5) {
    reasons.push("broken-encoding");
  }
  const previous = check.previous;
  if (previous !== undefined && previous.length > 0) {
    const paths = new Set(check.parsed.fragments.map((f) => f.pathKey));
    const hashes = new Set(check.parsed.fragments.map((f) => f.textHash));
    const lost = previous.filter((p) => !paths.has(p.pathKey) && !hashes.has(p.textHash)).length;
    if (lost / previous.length > MAX_LOST_SHARE) reasons.push("fragments-lost");
  }
  const { canary } = check;
  if (
    canary !== undefined &&
    (check.parsed.articleCount !== canary.articleCount ||
      !check.title.toLowerCase().includes(canary.titleIncludes.toLowerCase()))
  ) {
    reasons.push("canary-mismatch");
  }
  return reasons;
}

/** Канарейка акта, если он в списке. */
export function canaryOf(pravoId: string): Canary | undefined {
  return CANARIES.find((c) => c.pravoId === pravoId);
}

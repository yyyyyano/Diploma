// Новая редакция против действующих версий (LAW-31): сопоставление по пути и по тексту. Совпал путь и текст — версия
// продлевается; путь тот же, текст другой — новая версия; путь пропал, а такой же текст нашёлся под другим путём —
// перенумерация (то же содержание, новый ключ); нового пути нет — добавлен; прежнего пути нет и текст не нашёлся —
// «исключён» (хранится, чтобы честно отвечать). Чистая функция: запись в БД — repo.
import type { ParsedFragment } from "./build-fragments.ts";

export interface CurrentVersion {
  readonly fragmentId: string;
  readonly versionId: string;
  readonly pathKey: string;
  readonly textHash: string;
  readonly excluded: boolean;
}

export interface EditionPlan {
  /** Текст и путь те же: продлить `last_snapshot`. */
  readonly keep: readonly { current: CurrentVersion; next: ParsedFragment }[];
  /** Тот же путь, другой текст: закрыть версию, открыть новую. */
  readonly changed: readonly { current: CurrentVersion; next: ParsedFragment }[];
  /** Тот же текст под другим путём: фрагмент получает новый ключ, версия продлевается. */
  readonly renumbered: readonly { current: CurrentVersion; next: ParsedFragment }[];
  /** Нового фрагмента раньше не было. */
  readonly added: readonly ParsedFragment[];
  /** Прежнего фрагмента в редакции нет: «исключён». */
  readonly missing: readonly CurrentVersion[];
}

export function matchVersions(
  current: readonly CurrentVersion[],
  next: readonly ParsedFragment[],
): EditionPlan {
  const taken = new Set<string>();
  const used = new Set<ParsedFragment>();
  const keep: { current: CurrentVersion; next: ParsedFragment }[] = [];
  const renumbered: { current: CurrentVersion; next: ParsedFragment }[] = [];
  const changed: { current: CurrentVersion; next: ParsedFragment }[] = [];
  // Проход 1: путь и текст те же. Проход 2: текст тот же под другим путём (перенумерация — раньше «замены по пути»,
  // иначе сдвиг номеров на единицу выглядел бы как «изменены все статьи»). Проход 3: путь тот же, текст другой.
  const passes: [
    (c: CurrentVersion, n: ParsedFragment) => boolean,
    { current: CurrentVersion; next: ParsedFragment }[],
  ][] = [
    [
      (c, n) => c.pathKey === n.pathKey && c.textHash === n.textHash && c.excluded === n.excluded,
      keep,
    ],
    [(c, n) => c.textHash === n.textHash && !c.excluded && !n.excluded, renumbered],
    [(c, n) => c.pathKey === n.pathKey, changed],
  ];
  for (const [fits, into] of passes) {
    for (const n of next) {
      if (used.has(n)) continue;
      const c = current.find((x) => !taken.has(x.versionId) && fits(x, n));
      if (c === undefined) continue;
      taken.add(c.versionId);
      used.add(n);
      into.push({ current: c, next: n });
    }
  }
  return {
    keep,
    changed,
    renumbered,
    added: next.filter((n) => !used.has(n)),
    missing: current.filter((c) => !taken.has(c.versionId) && !c.excluded),
  };
}

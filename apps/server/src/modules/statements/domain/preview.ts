// Итоги предпросмотра (STMT-04, STMT-07): «Нашёл 47 операций, 12 из них уже были загружены» — числа считает код, а не
// модель и не сайт. Строка, не пошедшая в запись (чужая валюта), — «ошибка»; дубль — найденная, но не новая.
export interface CountedRow {
  readonly duplicate: boolean;
  readonly doubtful: boolean;
  readonly skipped?: boolean | undefined;
}

export interface PreviewCounts {
  /** Найдено операций: все строки выписки, которые можно записать (дубли — в том числе). */
  readonly found: number;
  readonly duplicates: number;
  /** Будет импортировано. */
  readonly newCount: number;
  /** Спорные переводы среди новых — пакет «Да/Нет» после импорта. */
  readonly doubtful: number;
  /** Строки, которые не записать (ошибки разбора). */
  readonly skipped: number;
}

export function summarize(rows: readonly CountedRow[]): PreviewCounts {
  const skipped = rows.filter((row) => row.skipped === true).length;
  const usable = rows.filter((row) => row.skipped !== true);
  const duplicates = usable.filter((row) => row.duplicate).length;
  return {
    found: usable.length,
    duplicates,
    newCount: usable.length - duplicates,
    doubtful: usable.filter((row) => !row.duplicate && row.doubtful).length,
    skipped,
  };
}

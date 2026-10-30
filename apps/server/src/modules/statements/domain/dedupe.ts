// Дубли между выписками (STMT-07). Внутри одного файла строки сохраняются как есть: два одинаковых кофе за 3 BYN в один
// день — две операции. Между файлами операция — дубль, если совпал банковский идентификатор операции (когда он есть)
// или набор «счёт + день (и время) + сумма + нормализованное описание + порядковый номер среди одинаковых за этот день».
import { normalizeText } from "./classify.ts";

export interface KeyedRow {
  readonly date: string;
  readonly time?: string | undefined;
  readonly minor: number;
  readonly currency: string;
  readonly description: string;
  readonly operationId?: string | undefined;
}

export interface RowKeys {
  /** Ключ «счёт + день + время + сумма + описание + порядковый номер». */
  readonly dedupeKey: string;
  /** Банковский идентификатор операции в пределах счёта; нет у выписки — undefined. */
  readonly externalId?: string;
}

/** Ключи строк одного файла для счёта `accountKey` (id счёта или «банк·маска·валюта», пока счёта нет): порядок строк сохраняется. */
export function rowKeys(accountKey: string, rows: readonly KeyedRow[]): RowKeys[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const base = [
      accountKey,
      row.date,
      row.time ?? "",
      String(row.minor),
      row.currency,
      normalizeText(row.description),
    ].join("|");
    const ordinal = (seen.get(base) ?? 0) + 1;
    seen.set(base, ordinal);
    const external =
      row.operationId === undefined || row.operationId === ""
        ? {}
        : { externalId: `${accountKey}|${row.operationId}` };
    return { dedupeKey: `${base}|#${ordinal}`, ...external };
  });
}

/** Какие строки уже загружены: совпал ключ дубля или идентификатор операции. */
export function duplicateFlags(
  keys: readonly RowKeys[],
  knownDedupe: ReadonlySet<string>,
  knownExternal: ReadonlySet<string>,
): boolean[] {
  return keys.map(
    (key) =>
      knownDedupe.has(key.dedupeKey) ||
      (key.externalId !== undefined && knownExternal.has(key.externalId)),
  );
}

// Строка статуса импорта и предпросмотра → DTO контракта (ARCHITECTURE §9: DTO ≠ строка БД). Без путей к файлам,
// служебных полей и токенов: токен «Отменить» остаётся на сервере.
import { StatementImportId, type ImportDetail, type ImportSummary } from "@kosht/contract";
import { LocalDate, Money } from "@kosht/kernel";
import type { PreviewRow } from "../infrastructure/db/schema.ts";
import type { ImportRow } from "../infrastructure/db/statement-imports.repo.ts";

type Summarized = Omit<ImportRow, "payload" | "schemaOverride">;

export function toSummary(row: Summarized): ImportSummary {
  const currency = row.currency ?? "BYN";
  return {
    id: StatementImportId.parse(row.id),
    fileId: row.fileId,
    status: row.status,
    bank: row.bank,
    mask: row.mask,
    currency: row.currency,
    period:
      row.periodFrom === null || row.periodTo === null
        ? null
        : { from: LocalDate.parse(row.periodFrom), to: LocalDate.parse(row.periodTo) },
    found: row.found,
    newCount: row.newCount,
    duplicates: row.duplicates,
    doubtful: row.doubtful,
    skipped: row.skipped,
    method: row.method as ImportSummary["method"],
    formatChanged: row.formatChanged,
    balance:
      row.balanceStatus === null
        ? null
        : {
            status: row.balanceStatus as "ok" | "mismatch" | "unknown",
            difference:
              row.balanceDifferenceMinor === null
                ? null
                : Money.of(row.balanceDifferenceMinor, currency),
          },
    warnings: row.warnings,
    errorCode: row.errorCode,
    accountId: row.accountId,
    createdAt: row.createdAt.toISOString(),
    importedAt: row.importedAt?.toISOString() ?? null,
  };
}

function toPreviewRow(row: PreviewRow): ImportDetail["rows"][number] {
  return {
    date: LocalDate.parse(row.date),
    time: row.time ?? null,
    amount: Money.of(row.minor, row.currency),
    description: row.description,
    merchantName: row.merchantName,
    category:
      row.category === null
        ? null
        : row.category.code !== undefined
          ? ({ type: "system", code: row.category.code } as never)
          : ({ type: "custom", id: row.category.id } as never),
    kind: row.kind,
    duplicate: row.duplicate,
    doubtful: row.doubtful,
  };
}

/** Предпросмотр: итоги, первые `limit` строк и образец колонок с текущими ролями. */
export function toDetail(row: ImportRow, limit: number): ImportDetail {
  const payload = row.payload;
  const sample = payload?.sample ?? null;
  const width =
    sample === null ? 0 : Math.max(sample.header.length, ...sample.rows.map((r) => r.length));
  const roles = Array.from({ length: width }, (_, index) => {
    const found = payload?.schema?.columns.find((column) => column.index === index);
    return found?.role ?? "ignore";
  });
  return {
    summary: toSummary(row),
    rows: (payload?.rows ?? [])
      .filter((r) => r.skipped !== true)
      .slice(0, limit)
      .map(toPreviewRow),
    columns:
      sample === null
        ? null
        : { header: [...sample.header], rows: sample.rows.map((r) => [...r]), roles },
  };
}

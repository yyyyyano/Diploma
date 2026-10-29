// Запоминание формата (STMT-05): после успешного импорта сохраняется «отпечаток» — вид файла, названия колонок — и
// схема разбора; следующая выписка того же формата разбирается без модели. Вызывает T-026 в транзакции импорта;
// скан формата не имеет. Банк и его нормализованное имя — чтобы заметить, что формат того же банка изменился.
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import { normalizeHeader } from "../domain/column-roles.ts";
import type { ParsedStatement } from "../domain/types.ts";
import { upsertFormat } from "../infrastructure/db/statement-formats.repo.ts";

export function makeRememberFormat(d: Pick<Platform, "clock">) {
  /** Запомнить формат разобранной выписки; у скана и у выписки без схемы запоминать нечего. */
  return async function rememberFormat(s: ScopedDb, parsed: ParsedStatement): Promise<boolean> {
    if (
      parsed.fingerprint === undefined ||
      parsed.schema === undefined ||
      parsed.sourceKind === "scan"
    ) {
      return false;
    }
    await upsertFormat(
      s,
      {
        fingerprint: parsed.fingerprint,
        sourceKind: parsed.sourceKind,
        bank: parsed.bank ?? null,
        bankKey: parsed.bank === undefined ? null : normalizeHeader(parsed.bank),
        schema: parsed.schema,
      },
      d.clock.now(),
    );
    return true;
  };
}

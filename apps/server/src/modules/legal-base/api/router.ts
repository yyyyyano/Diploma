// Процедуры legal-base (contract.legalBase.*): прогресс стартового каталога для экрана первого запуска. Тонко: вход
// контрактом → сценарий. Публичная «База законов» — T-038.
import { localOnly } from "../../../platform/http/procedures.ts";
import type { StartCatalog } from "../application/start-catalog.ts";

export function legalBaseRouter(catalog: Pick<StartCatalog, "progress">) {
  return {
    // AUTH-10: прогресс на экране первого запуска — до входа и только с этого компьютера (localOnly), как у моделей.
    startupProgress: localOnly.legalBase.startupProgress.handler(() => catalog.progress()),
  };
}

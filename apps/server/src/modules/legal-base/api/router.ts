// Процедуры legal-base (contract.legalBase.*): прогресс стартового каталога для экрана первого запуска (localOnly) и
// публичная «База законов» (publicProc, LEGAL-11: каталог, акт, часть текста, разбор «ст. 210 НК»). Тонко: вход контрактом →
// сценарий; данных пользователя нет — гость читает так же, как вошедший.
import { localOnly } from "../../../platform/http/procedures.ts";
import { publicProc } from "../../../platform/http/procedures.ts";
import type { Reader } from "../application/reader.ts";
import type { StartCatalog } from "../application/start-catalog.ts";

export function legalBaseRouter(catalog: Pick<StartCatalog, "progress">, reader: Reader) {
  return {
    // AUTH-10: прогресс на экране первого запуска — до входа и только с этого компьютера (localOnly), как у моделей.
    startupProgress: localOnly.legalBase.startupProgress.handler(() => catalog.progress()),
    catalog: publicProc.legalBase.catalog.handler(() => reader.catalog()),
    act: publicProc.legalBase.act.handler(({ input }) => reader.act(input.pravoId)),
    fragments: publicProc.legalBase.fragments.handler(async ({ input }) => ({
      fragments: await reader.fragments(input.pravoId, input.key),
    })),
    resolve: publicProc.legalBase.resolve.handler(async ({ input }) => ({
      target: await reader.resolve(input.q),
    })),
  };
}

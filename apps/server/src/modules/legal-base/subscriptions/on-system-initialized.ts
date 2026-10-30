// identity.system-initialized → загрузка стартового каталога законов (AUTH-10, LAW-10): контакт загрузчика с экрана
// первого запуска сохраняется в настройке модуля (в событии его нет — нагрузка только id, OBS-04), каталог из 28 актов
// заводится сразу (экран первого запуска видит «0 из 28»), задача загрузки ставится, если автозагрузка включена.
// Повторная доставка события безопасна: контакт не перетирает уже заданный, акты не дублируются, задача схлопывается.
import { defineSubscription } from "../../../platform/events/define-subscription.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import { systemInitialized, type IdentityFacade } from "../../identity/index.ts";
import type { StartCatalog } from "../application/start-catalog.ts";
import type { loadStartCatalogJob } from "../jobs/load-start-catalog.job.ts";
import { LEGAL_AUTOLOAD, LOADER_CONTACT } from "../settings.ts";

export function onSystemInitialized(
  platform: Pick<Platform, "jobs" | "settings">,
  deps: {
    readonly identity: Pick<IdentityFacade, "loaderContact">;
    readonly catalog: Pick<StartCatalog, "seed">;
    readonly job: ReturnType<typeof loadStartCatalogJob>;
  },
) {
  return defineSubscription({
    event: systemInitialized,
    module: "legal-base",
    handle: async (ctx) => {
      const contact = await deps.identity.loaderContact();
      if (contact !== null && (await platform.settings.get(LOADER_CONTACT)).trim() === "") {
        await platform.settings.set(LOADER_CONTACT, contact);
      }
      await deps.catalog.seed();
      if (!(await platform.settings.get(LEGAL_AUTOLOAD))) return;
      await ctx.s.transaction((tx) => platform.jobs.enqueue(tx, deps.job, {}));
    },
  });
}

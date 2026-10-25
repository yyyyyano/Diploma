// Модуль mail (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.
// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.
import {
  defineModule,
  type ModuleDeps,
  type NoFacades,
  type SystemPlatform,
} from "../../platform/module/define-module.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export type MailFacades = NoFacades;

export function createMailModule(_deps: ModuleDeps<MailFacades, SystemPlatform>) {
  return defineModule({ id: "mail" });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type MailFacade = ReturnType<typeof createMailModule>["facade"];

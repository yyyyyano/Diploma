// Модуль profile (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.
// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { IdentityFacade } from "../identity/index.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface ProfileFacades {
  readonly identity: IdentityFacade;
}

export function createProfileModule(_deps: ModuleDeps<ProfileFacades, Platform>) {
  return defineModule({ id: "profile" });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type ProfileFacade = ReturnType<typeof createProfileModule>["facade"];

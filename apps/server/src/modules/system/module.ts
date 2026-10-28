// Модуль system (паспорт — CLAUDE.md): экран «Система» админки — фоновые задачи, часовой пояс, доступ с других
// устройств, Langfuse (ADM-60). Соседям (admin) — фасад; своих процедур нет: их собирает admin.
import {
  defineModule,
  type ModuleDeps,
  type NoFacades,
  type SystemPlatform,
} from "../../platform/module/define-module.ts";
import { makeSystemSettings } from "./application/system-settings.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export type SystemFacades = NoFacades;

export function createSystemModule({ platform }: ModuleDeps<SystemFacades, SystemPlatform>) {
  return defineModule({ id: "system", facade: makeSystemSettings(platform) });
}

/** Что модуль даёт соседям (admin): view() — обзор «Системы», setTimeZone(пояс), setLan({ allowed, address }). */
export type SystemFacade = ReturnType<typeof createSystemModule>["facade"];

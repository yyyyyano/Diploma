// Модуль files (паспорт — CLAUDE.md): файлы домохозяйства — хранение data/files/<householdId>/<fileId>, выдача
// владельцу, удаление; владелец данных для «Мои данные» и удаления аккаунта (PRIV-05/06). Приём файлов с проверкой
// типа по содержимому и лимитами — T-025.
import {
  defineModule,
  type ModuleDeps,
  type NoFacades,
  type Platform,
} from "../../platform/module/define-module.ts";
import { filesRouter } from "./api/router.ts";
import { makeFiles } from "./application/files.ts";
import { filesUserData } from "./user-data.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export type FilesFacades = NoFacades;

export function createFilesModule({ platform }: ModuleDeps<FilesFacades, Platform>) {
  const files = makeFiles(platform);
  return defineModule({
    id: "files",
    facade: { save: files.save, open: files.open, remove: files.remove },
    router: filesRouter(files),
    userData: filesUserData(files),
  });
}

/** Что модуль даёт соседям: save(s, файл) → { id, size }, open(s, id), remove(s, id) — только своё домохозяйство. */
export type FilesFacade = ReturnType<typeof createFilesModule>["facade"];

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
import { makeAcceptUpload } from "./application/accept-upload.ts";
import { makeFiles } from "./application/files.ts";
import {
  FILES_MAX_PER_UPLOAD,
  FILES_MAX_PHOTO_BYTES,
  FILES_MAX_STATEMENT_BYTES,
} from "./settings.ts";
import { filesUserData } from "./user-data.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export type FilesFacades = NoFacades;

export function createFilesModule({ platform }: ModuleDeps<FilesFacades, Platform>) {
  const files = makeFiles(platform);
  const accept = makeAcceptUpload({ files, settings: platform.settings });
  return defineModule({
    id: "files",
    facade: { save: files.save, open: files.open, remove: files.remove, accept },
    router: filesRouter({ open: files.open, accept }),
    settings: [FILES_MAX_PHOTO_BYTES, FILES_MAX_STATEMENT_BYTES, FILES_MAX_PER_UPLOAD],
    userData: filesUserData(files),
  });
}

/**
 * Что модуль даёт соседям (только своё домохозяйство): save(s, файл) → { id, size }, open(s, id), remove(s, id) и
 * accept(s, вид, файлы) — приём с проверкой типа по содержимому, лимитами и белым списком (SEC-03).
 */
export type FilesFacade = ReturnType<typeof createFilesModule>["facade"];

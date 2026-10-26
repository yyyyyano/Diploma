// Владелец данных модуля files (PRIV-05/06): строки files выгружает и удаляет privacy по реестру; сами файлы — хуки:
// исходные файлы — в архив «Мои данные», после удаления строк — весь каталог файлов домохозяйства.
import { defineUserData } from "../../platform/db/user-data.ts";
import type { Files } from "./application/files.ts";
import { files } from "./infrastructure/db/schema.ts";

export function filesUserData(uc: Pick<Files, "exportFiles" | "removeHousehold">) {
  return defineUserData({
    tables: [files],
    export: uc.exportFiles,
    afterDelete: uc.removeHousehold,
  });
}

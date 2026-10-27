// Удаление аккаунта (PRIV-06): письма локального ящика на адрес пользователя — его данные в системной таблице mail.
// Зовёт identity при удалении аккаунта; в лог — только число писем, без адреса (OBS-04).
import type { SystemPlatform } from "../../../platform/module/define-module.ts";
import { deleteMailTo } from "../infrastructure/db/mail.repo.ts";

export function makeForgetRecipient(d: Pick<SystemPlatform, "system" | "log">) {
  return async function forgetRecipient(email: string): Promise<void> {
    const count = await deleteMailTo(d.system, email);
    d.log.info({ count }, "mail.recipient-forgotten");
  };
}

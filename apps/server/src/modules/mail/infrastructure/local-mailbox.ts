// Локальный почтовый ящик (AUTH-06): «доставка» письма — строка в mail_messages; читает её страница ящика.
import type { Clock } from "@kosht/kernel";
import type { SystemDb } from "../../../platform/db/system-db.ts";
import type { MailTransport } from "../application/ports.ts";
import { insertMail } from "./db/mail.repo.ts";

export function createLocalMailbox(d: {
  readonly system: SystemDb;
  readonly clock: Pick<Clock, "now">;
}): MailTransport {
  return {
    async send(message) {
      await insertMail(d.system, message, d.clock.now());
    },
  };
}

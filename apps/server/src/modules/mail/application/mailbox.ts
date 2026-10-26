// Страница локального ящика (AUTH-06): письма видны, только пока SMTP не настроен; доступ «только с этого
// компьютера» ставит процедура (localOnly).
import { createT } from "@kosht/i18n";
import type { SystemPlatform } from "../../../platform/module/define-module.ts";
import type { StoredMail } from "../domain/message.ts";
import { listMail } from "../infrastructure/db/mail.repo.ts";
import { smtpConfig } from "./send-mail.ts";

export type MailboxDeps = Pick<SystemPlatform, "system" | "settings" | "secrets">;

/** Ящик включён: почта не настроена. */
export function makeMailboxEnabled(d: Pick<SystemPlatform, "settings" | "secrets">) {
  const t = createT();
  return async function mailboxEnabled(): Promise<boolean> {
    return (await smtpConfig(d, t)) === undefined;
  };
}

export function makeMailbox(d: MailboxDeps) {
  const enabled = makeMailboxEnabled(d);
  return async function mailbox(): Promise<{ enabled: boolean; messages: StoredMail[] }> {
    if (!(await enabled())) return { enabled: false, messages: [] };
    return { enabled: true, messages: await listMail(d.system) };
  };
}

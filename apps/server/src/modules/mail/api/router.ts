// Процедуры mail (contract.mail.*): status — publicProc (гость на странице регистрации или входа), mailbox — localOnly
// (AUTH-06, R40: на сетевом входе процедуры нет — NOT_FOUND).
import type { MailboxMessage } from "@kosht/contract";
import { localOnly, publicProc } from "../../../platform/http/procedures.ts";
import type { makeMailbox, makeMailboxEnabled } from "../application/mailbox.ts";
import type { StoredMail } from "../domain/message.ts";

export interface MailUseCases {
  readonly mailbox: ReturnType<typeof makeMailbox>;
  readonly mailboxEnabled: ReturnType<typeof makeMailboxEnabled>;
}

function toDto(mail: StoredMail): MailboxMessage {
  return {
    id: mail.id,
    to: mail.to,
    subject: mail.subject,
    preview: mail.preview,
    title: mail.title,
    paragraphs: [...mail.paragraphs],
    action: mail.action ?? null,
    note: mail.note ?? null,
    sentAt: mail.sentAt.toISOString(),
  };
}

export function mailRouter(uc: MailUseCases) {
  return {
    status: publicProc.mail.status.handler(async ({ context }) => ({
      mailboxAvailable: context.listener === "local" && (await uc.mailboxEnabled()),
    })),
    mailbox: localOnly.mail.mailbox.handler(async () => {
      const { enabled, messages } = await uc.mailbox();
      return { enabled, messages: messages.map(toDto) };
    }),
  };
}

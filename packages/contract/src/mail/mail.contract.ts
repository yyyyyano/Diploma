// Почта (AUTH-06, NFR-24): локальный почтовый ящик для демо и разработки. status — publicProc (сайт решает, показывать
// ли ссылку «Открыть локальный ящик»), mailbox — localOnly (на сетевом входе процедуры «нет»). Письма — готовые поля,
// без HTML: страница ящика рисует их сама.
import { oc } from "@orpc/contract";
import { z } from "zod";
import { pickErrors } from "../errors.ts";

export const MailNoteKind = z.enum(["info", "warn"]);

export const MailboxMessage = z.strictObject({
  id: z.uuid(),
  to: z.string(),
  subject: z.string(),
  preview: z.string(),
  title: z.string(),
  paragraphs: z.array(z.string()),
  action: z.strictObject({ label: z.string(), url: z.string() }).nullable(),
  note: z.strictObject({ kind: MailNoteKind, text: z.string() }).nullable(),
  /** Момент отправки, ISO UTC. */
  sentAt: z.iso.datetime(),
});
export type MailboxMessage = z.infer<typeof MailboxMessage>;

export const mailContract = {
  /** Ящик доступен этому запросу: почта не настроена и вход локальный. */
  status: oc
    .route({ method: "GET", path: "/mail/status" })
    .output(z.strictObject({ mailboxAvailable: z.boolean() })),
  /** Письма ящика, новые сверху; почта настроена — enabled: false и писем нет. */
  mailbox: oc
    .route({ method: "GET", path: "/mail/mailbox" })
    .output(z.strictObject({ enabled: z.boolean(), messages: z.array(MailboxMessage) }))
    .errors(pickErrors("NOT_FOUND")),
};

// Локальный почтовый ящик (AUTH-06): без входа, только на этом компьютере — на сетевом входе сервер отвечает
// NOT_FOUND, и страница показывает это. Страница — features/mailbox.
import { createFileRoute } from "@tanstack/react-router";
import { MailboxPage } from "../../features/mailbox/index.ts";

export const Route = createFileRoute("/_local/mailbox")({
  staticData: { page: "mailbox" },
  component: MailboxPage,
});

// Дерево процедур контракта (ADR-0005): сервер реализует его (`implement(contract)` в main/router.ts), сайт строит по
// нему клиент. Процедуры модулей добавляют их задачи: `<модуль>/<модуль>.contract.ts` и ветка здесь.
import { accountsContract } from "./accounts/accounts.contract.ts";
import { adminContract } from "./admin/admin.contract.ts";
import { actionsContract } from "./actions/actions.contract.ts";
import { chatContract } from "./chat/chat.contract.ts";
import { eventsContract } from "./events/events.contract.ts";
import { explainContract } from "./explain/explain.contract.ts";
import { filesContract } from "./files/files.contract.ts";
import { identityContract } from "./identity/identity.contract.ts";
import { notificationsContract } from "./notifications/notifications.contract.ts";
import { mailContract } from "./mail/mail.contract.ts";
import { privacyContract } from "./privacy/privacy.contract.ts";
import { systemContract } from "./system/system.contract.ts";

export const contract = {
  system: systemContract,
  events: eventsContract,
  mail: mailContract,
  identity: identityContract,
  privacy: privacyContract,
  actions: actionsContract,
  explain: explainContract,
  files: filesContract,
  notifications: notificationsContract,
  accounts: accountsContract,
  chat: chatContract,
  admin: adminContract,
};

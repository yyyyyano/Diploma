// Дерево процедур контракта (ADR-0005): сервер реализует его (`implement(contract)` в main/router.ts), сайт строит по
// нему клиент. Процедуры модулей добавляют их задачи: `<модуль>/<модуль>.contract.ts` и ветка здесь.
import { accountsContract } from "./accounts/accounts.contract.ts";
import { eventsContract } from "./events/events.contract.ts";
import { identityContract } from "./identity/identity.contract.ts";
import { systemContract } from "./system/system.contract.ts";

export const contract = {
  system: systemContract,
  events: eventsContract,
  identity: identityContract,
  accounts: accountsContract,
};

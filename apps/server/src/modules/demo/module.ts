// Модуль demo (паспорт — CLAUDE.md): демо-пользователь и связный набор данных от текущей даты (DEMO-01…04). Своих таблиц нет:
// пользователя и его scope отдаёт identity, данные пишутся фасадами соседей (без модели, воспроизводимо). Вход демо-пользователем —
// contract.demo.signIn (localOnly), «Пересоздать демо-данные» — через admin, `make demo-reset` — тем же `recreate`.
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { IdentityFacade } from "../identity/index.ts";
import type { PrivacyFacade } from "../privacy/index.ts";
import type { ProfileFacade } from "../profile/index.ts";
import type { FilesFacade } from "../files/index.ts";
import type { AccountsFacade } from "../accounts/index.ts";
import type { TransactionsFacade } from "../transactions/index.ts";
import type { ReceiptsFacade } from "../receipts/index.ts";
import type { CategoriesFacade } from "../categories/index.ts";
import type { MerchantsFacade } from "../merchants/index.ts";
import type { RecurringFacade } from "../recurring/index.ts";
import type { BudgetsFacade } from "../budgets/index.ts";
import type { CalendarFacade } from "../calendar/index.ts";
import type { WeeklyFacade } from "../weekly/index.ts";
import { demoRouter } from "./api/router.ts";
import { makeDemo } from "./application/demo.ts";
import { makeGenerate } from "./application/generate.ts";
import { DEMO_AUTOSTART } from "./settings.ts";
import { onSystemInitialized } from "./subscriptions/on-system-initialized.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface DemoFacades {
  readonly identity: IdentityFacade;
  readonly privacy: PrivacyFacade;
  readonly profile: ProfileFacade;
  readonly files: FilesFacade;
  readonly accounts: AccountsFacade;
  readonly transactions: TransactionsFacade;
  readonly receipts: ReceiptsFacade;
  readonly categories: CategoriesFacade;
  readonly merchants: MerchantsFacade;
  readonly recurring: RecurringFacade;
  readonly budgets: BudgetsFacade;
  readonly calendar: CalendarFacade;
  readonly weekly: WeeklyFacade;
}

export function createDemoModule({ platform, facades }: ModuleDeps<DemoFacades, Platform>) {
  const generate = makeGenerate({ platform, ...facades });
  const demo = makeDemo({ platform, ...facades, generate });
  return defineModule({
    id: "demo",
    // Соседям (admin, entrypoints/demo-reset): создать, если нет, и пересоздать данные демо-пользователя.
    facade: { ensure: demo.ensure, recreate: demo.recreate },
    router: demoRouter({ demo, identity: facades.identity }),
    settings: [DEMO_AUTOSTART],
    subscriptions: [onSystemInitialized(platform, demo)],
  });
}

/** Что модуль даёт соседям: `ensure()` — демо есть и готово; `recreate()` → число записанного (DEMO-03). */
export type DemoFacade = ReturnType<typeof createDemoModule>["facade"];

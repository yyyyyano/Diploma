// Модуль telegram (паспорт — CLAUDE.md): бот «Кошт» — привязка с согласием (TG-02, PRIV-08), фото чеков и файлы выписок
// (TG-03, TG-04), вопросы ассистенту текстом и голосом (TG-05, VOICE-01), группы не поддерживаются (TG-11). grammY — только
// в infrastructure/bot; опрос — в процессе `bot` под консультативным замком Postgres (TG-10).
import { createTelegramT } from "@kosht/i18n";
import {
  defineModule,
  type ModuleDeps,
  type SystemPlatform,
} from "../../platform/module/define-module.ts";
import { resolveLinkOrigin } from "../../platform/http/link-origin.ts";
import type { ChatFacade } from "../chat/index.ts";
import type { AgentFacade } from "../agent/index.ts";
import type { FilesFacade } from "../files/index.ts";
import type { IdentityFacade } from "../identity/index.ts";
import type { PrivacyFacade } from "../privacy/index.ts";
import type { NotificationsFacade } from "../notifications/index.ts";
import type { ActionsFacade } from "../actions/index.ts";
import type { ReceiptsFacade } from "../receipts/index.ts";
import type { StatementsFacade } from "../statements/index.ts";
import type { VoiceFacade } from "../voice/index.ts";
import type { DashboardFacade } from "../dashboard/index.ts";
import type { BudgetsFacade } from "../budgets/index.ts";
import type { WeeklyFacade } from "../weekly/index.ts";
import { telegramRouter } from "./api/router.ts";
import type { TelegramDeps } from "./application/deps.ts";
import { makeBotHandler } from "./application/handler.ts";
import { makeLinkOps } from "./application/link.ts";
import { createBotRuntime } from "./infrastructure/bot/bot-runtime.ts";
import { createSenderProvider } from "./infrastructure/bot/sender.ts";
import { scopedForOwner } from "./infrastructure/scope.ts";
import { TELEGRAM_SETTINGS, TELEGRAM_TOKEN } from "./settings.ts";
import { onReceiptReady } from "./subscriptions/on-receipt-ready.ts";
import { telegramUserData } from "./user-data.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface TelegramFacades {
  readonly files: FilesFacade;
  readonly chat: ChatFacade;
  readonly agent: AgentFacade;
  readonly identity: IdentityFacade;
  readonly privacy: PrivacyFacade;
  readonly notifications: NotificationsFacade;
  readonly actions: ActionsFacade;
  readonly receipts: ReceiptsFacade;
  readonly statements: StatementsFacade;
  readonly voice: VoiceFacade;
  readonly dashboard: DashboardFacade;
  readonly budgets: BudgetsFacade;
  readonly weekly: WeeklyFacade;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createTelegramModule({
  platform,
  facades,
}: ModuleDeps<TelegramFacades, SystemPlatform>) {
  const sender = createSenderProvider({ secrets: platform.secrets, log: platform.log });
  const deps: TelegramDeps = {
    system: platform.system,
    platform,
    neighbours: facades,
    scopedFor: scopedForOwner(platform),
    t: createTelegramT(),
    siteOrigin: () => resolveLinkOrigin(platform.settings, platform.localOrigin),
    sender,
    sleep,
  };
  const links = makeLinkOps(deps);
  const handler = makeBotHandler(deps, links);
  const runtime = createBotRuntime({
    system: platform.system,
    secrets: platform.secrets,
    settings: platform.settings,
    log: platform.log,
    handler,
    now: () => platform.clock.now(),
  });
  return defineModule({
    id: "telegram",
    facade: { links, handler },
    router: telegramRouter(links),
    subscriptions: onReceiptReady({ sender, deliver: handler.deliverReceipt }),
    userData: telegramUserData(platform.system),
    settings: TELEGRAM_SETTINGS,
    secrets: [TELEGRAM_TOKEN],
    // TG-10: опрашивает только процесс bot.
    start: { bot: () => runtime.start() },
    stop: async () => {
      await runtime.stop();
      await handler.drain();
    },
  });
}

/** Что модуль даёт соседям и корню композиции: сценарии привязки и обработчик обновлений бота. */
export type TelegramFacade = ReturnType<typeof createTelegramModule>["facade"];

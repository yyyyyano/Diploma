// Зависимости сценариев бота: платформа, фасады соседей и то, что даёт infrastructure (scope из привязки, отправка без
// опроса). Сценарии не импортируют grammY и не собирают Scope сами — только `scopedFor` (ARCHITECTURE §6.4).
import type { TelegramT } from "@kosht/i18n";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { SystemDb } from "../../../platform/db/system-db.ts";
import type { SystemPlatform } from "../../../platform/module/define-module.ts";
import type { ActionsFacade } from "../../actions/index.ts";
import type { ChatFacade } from "../../chat/index.ts";
import type { FilesFacade } from "../../files/index.ts";
import type { IdentityFacade } from "../../identity/index.ts";
import type { PrivacyFacade } from "../../privacy/index.ts";
import type { ReceiptsFacade } from "../../receipts/index.ts";
import type { StatementsFacade } from "../../statements/index.ts";
import type { VoiceFacade } from "../../voice/index.ts";
import type { Sender } from "./ports.ts";

/** Что сценариям бота нужно от соседей (подмножество фасадов из dependsOn). */
export interface TelegramNeighbours {
  readonly files: Pick<FilesFacade, "accept">;
  readonly chat: Pick<ChatFacade, "ask" | "startNew">;
  readonly identity: Pick<IdentityFacade, "memberState">;
  readonly privacy: Pick<PrivacyFacade, "setTelegramConsent" | "telegramConsentGiven">;
  readonly actions: Pick<ActionsFacade, "answer">;
  readonly receipts: Pick<ReceiptsFacade, "start" | "card" | "confirm" | "cancel">;
  readonly statements: Pick<StatementsFacade, "start" | "summary" | "confirm" | "cancel">;
  readonly voice: Pick<VoiceFacade, "transcribe">;
}

export interface TelegramDeps {
  readonly system: SystemDb;
  readonly platform: Pick<
    SystemPlatform,
    "clock" | "log" | "settings" | "secrets" | "consent" | "events"
  >;
  readonly neighbours: TelegramNeighbours;
  /** ScopedDb владельца привязки — собирает infrastructure (вход Telegram, ARCHITECTURE §6.4). */
  readonly scopedFor: (owner: { userId: string; householdId: string }) => ScopedDb;
  readonly t: TelegramT;
  /** Адрес сайта для ссылок «Изменить» / «Открыть на сайте»: LAN-адрес, если включён, иначе локальный вход. */
  readonly siteOrigin: () => Promise<string>;
  /** Отправка без опроса (любой процесс): `undefined` — токена нет. */
  readonly sender: () => Promise<Sender | undefined>;
  /** Пауза между проверками разбора выписки (таймер — в infrastructure; в тестах — мгновенная). */
  readonly sleep: (ms: number) => Promise<void>;
}

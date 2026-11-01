// Привязка бота к аккаунту (TG-02, PRIV-08, SEC-04): кнопка на сайте → согласие и одноразовая ссылка → «Старт» в боте → строка
// `telegram_links`. «Чьи данные» бот узнаёт только отсюда: scope строится из привязки по `chat.id` личного чата. Отключение
// (сайт, /unlink, удаление аккаунта) снимает привязку и отзывает согласие.
import type { TelegramStatus } from "@kosht/contract";
import { CONSENT_VERSIONS } from "@kosht/i18n";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { codeFromStart, deepLink, hashLinkCode, newLinkCode } from "../domain/link-code.ts";
import {
  claimCode,
  deleteCodesOfUser,
  deleteExpiredCodes,
  deleteLinkByUser,
  findLinkByChat,
  findLinkByUser,
  insertLink,
  issueCode,
  pendingCode,
  readBotName,
  type LinkRow,
} from "../infrastructure/db/telegram.repo.ts";
import { LINK_CODE_TTL_MIN, TELEGRAM_TOKEN } from "../settings.ts";
import type { TelegramDeps } from "./deps.ts";
import type { BotApi, Origin } from "./ports.ts";

export function makeLinkOps(d: TelegramDeps) {
  const { system, platform, neighbours } = d;

  /** Бот настроен: токен задан (админка или env) и процесс `bot` уже узнал своё имя (`getMe`). */
  async function botName(): Promise<string | undefined> {
    if ((await platform.secrets.status(TELEGRAM_TOKEN)) !== "set") return undefined;
    return readBotName(system);
  }

  /** Вкладка «Telegram»: настроен ли бот, подключён ли аккаунт, ждёт ли выданная ссылка. */
  async function status(s: ScopedDb): Promise<TelegramStatus> {
    const name = await botName();
    const link = await findLinkByUser(system, s.scope.userId);
    const pending =
      link === undefined
        ? await pendingCode(system, s.scope.userId, platform.clock.now())
        : undefined;
    return {
      configured: name !== undefined,
      botName: name ?? null,
      linked:
        link === undefined
          ? null
          : { since: link.createdAt.toISOString(), username: link.username },
      pending: pending === undefined ? null : { expiresAt: pending.toISOString() },
    };
  }

  /** «Подключить Telegram»: согласие PRIV-08 → код ≥ 128 бит (в базе — хэш) → ссылка на бота. */
  async function beginLink(
    s: ScopedDb,
    input: { readonly version: string },
  ): Promise<{ url: string; expiresAt: string }> {
    const name = await botName();
    if (name === undefined) throw new AppError("UNAVAILABLE", { reason: "bot-not-configured" });
    if ((await findLinkByUser(system, s.scope.userId)) !== undefined) {
      throw new AppError("CONFLICT", { reason: "already-linked" });
    }
    // Согласие — первым: устаревшая версия текста даёт CONFLICT до выдачи кода.
    await neighbours.privacy.setTelegramConsent(s, { granted: true, version: input.version });
    const now = platform.clock.now();
    const ttlMin = await platform.settings.get(LINK_CODE_TTL_MIN);
    const code = newLinkCode();
    const expiresAt = new Date(now.getTime() + ttlMin * 60_000);
    await deleteExpiredCodes(system, now);
    await issueCode(system, {
      codeHash: hashLinkCode(code),
      userId: s.scope.userId,
      householdId: s.scope.householdId,
      expiresAt,
      at: now,
    });
    platform.log.info({ userId: s.scope.userId }, "telegram.link-issued");
    return { url: deepLink(name, code), expiresAt: expiresAt.toISOString() };
  }

  async function revokeConsent(s: ScopedDb): Promise<void> {
    if (await neighbours.privacy.telegramConsentGiven(s)) {
      await neighbours.privacy.setTelegramConsent(s, {
        granted: false,
        version: CONSENT_VERSIONS.telegram,
      });
    }
  }

  /** «Отмена» до нажатия «Старт»: код гаснет, согласие отзывается. */
  async function cancelLink(s: ScopedDb): Promise<void> {
    await deleteCodesOfUser(system, s.scope.userId);
    if ((await findLinkByUser(system, s.scope.userId)) === undefined) await revokeConsent(s);
  }

  /** Отключить: привязка и коды удалены, согласие отозвано; чат — по возможности уведомить (`message`). */
  async function unlink(s: ScopedDb, message: string | undefined): Promise<void> {
    const chatId = await deleteLinkByUser(system, s.scope.userId);
    await deleteCodesOfUser(system, s.scope.userId);
    await revokeConsent(s);
    platform.log.info({ userId: s.scope.userId }, "telegram.unlinked");
    if (chatId === undefined || message === undefined) return;
    const sender = await d.sender();
    try {
      await sender?.send(chatId, message);
    } catch (error) {
      // Чат мог заблокировать бота: отключение уже сделано, сообщение — любезность.
      platform.log.warn({ err: error }, "telegram.unlink-notice-failed");
    }
  }

  /** `/start <код>` в боте: привязать этот чат к аккаунту того, кто нажал «Подключить» на сайте. */
  async function linkFromStart(origin: Origin, argument: string, api: BotApi): Promise<void> {
    const { t } = d;
    const code = codeFromStart(argument);
    if (code === undefined) {
      await api.send(origin.chatId, t("bot.start.invalid"));
      return;
    }
    const now = platform.clock.now();
    const claim = await claimCode(system, hashLinkCode(code), now);
    if (claim.kind === "unknown")
      return void (await api.send(origin.chatId, t("bot.start.invalid")));
    if (claim.kind === "used") return void (await api.send(origin.chatId, t("bot.start.used")));
    if (claim.kind === "expired") {
      const minutes = await platform.settings.get(LINK_CODE_TTL_MIN);
      return void (await api.send(origin.chatId, t("bot.start.expired", { minutes })));
    }
    const owner = { userId: claim.userId, householdId: claim.householdId };
    const s = d.scopedFor(owner);
    const state = await neighbours.identity.memberState(s.scope);
    if (state !== "active") {
      return void (await api.send(
        origin.chatId,
        state === "blocked" ? t("bot.blocked") : t("bot.start.invalid"),
      ));
    }
    // Согласие могли отозвать между «Подключить» и «Старт» (отмена на сайте).
    if (!(await neighbours.privacy.telegramConsentGiven(s))) {
      return void (await api.send(origin.chatId, t("bot.start.noConsent")));
    }
    const taken = await findLinkByChat(system, origin.chatId);
    if (taken !== undefined) {
      const same = taken.userId === owner.userId;
      return void (await api.send(
        origin.chatId,
        same ? t("bot.start.already") : t("bot.start.chatTaken"),
      ));
    }
    const link: LinkRow = {
      ...owner,
      chatId: origin.chatId,
      username: origin.username,
      createdAt: now,
    };
    if (!(await insertLink(system, link))) {
      return void (await api.send(origin.chatId, t("bot.start.chatTaken")));
    }
    platform.log.info({ userId: owner.userId }, "telegram.linked");
    await api.send(origin.chatId, t("bot.start.linked"));
  }

  return { botName, status, beginLink, cancelLink, unlink, linkFromStart };
}

export type LinkOps = ReturnType<typeof makeLinkOps>;

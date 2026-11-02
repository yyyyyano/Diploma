// Обработчик обновлений бота (TG-01…05, TG-11, AUTH-11, SEC-04). Вход — нормализованное событие и порт BotApi; grammY сюда не
// заходит. Порядок: группа → «Старт» с кодом → привязка чата (непривязанному — «Подключите аккаунт») → состояние владельца
// (заблокированному — понятный отказ) → сценарий. Scope строит только `scopedFor` из привязки по `chat.id` личного чата при
// `from.id === chat.id`; в данных кнопок — только id сущностей, владельца проверяют сценарии через `s` (чужой id — NOT_FOUND).
// Работа идёт в очереди по чатам и не держит опрос Telegram.
import { randomUUID } from "node:crypto";
import { AppError } from "../../../platform/errors/app-error.ts";
import { withLogContext } from "../../../platform/logging/context.ts";
import { decodeCallback, encodeCallback } from "../domain/callback-data.ts";
import { findLinkByChat } from "../infrastructure/db/telegram.repo.ts";
import { createChatQueue } from "./chat-queue.ts";
import type { TelegramDeps } from "./deps.ts";
import { makeCommands } from "./commands.ts";
import { makeConversation } from "./conversation.ts";
import { makeDocuments } from "./documents.ts";
import { makeLinkOps, type LinkOps } from "./link.ts";
import { FileTooLargeError, type BotApi, type BotCommand, type Incoming } from "./ports.ts";
import { MAX_FILE_MB } from "../settings.ts";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";

const GROUP_CHATS = new Set(["group", "supergroup", "channel"]);

export function makeBotHandler(d: TelegramDeps, linkOps: LinkOps = makeLinkOps(d)) {
  const { t, platform, neighbours, system } = d;
  const background = new Set<Promise<void>>();
  const queue = createChatQueue((error) =>
    platform.log.error({ err: error }, "telegram.queue-failed"),
  );

  /** Фоновая работа процесса (ожидание карточек): ошибка — в лог, остановка процесса её дожидается. */
  function spawn(work: () => Promise<void>): void {
    const running = work().catch((error: unknown) => {
      platform.log.error({ err: error }, "telegram.background-failed");
    });
    background.add(running);
    void running.finally(() => background.delete(running));
  }

  const documents = makeDocuments(d, spawn);
  const conversation = makeConversation(d);
  const commands = makeCommands(d);

  /** Ошибка сценария → одна фраза пользователю; программные сбои — в лог без текстов (OBS-04). */
  async function failureText(error: unknown): Promise<string> {
    if (error instanceof FileTooLargeError) {
      return t("bot.tooLarge", { mb: await platform.settings.get(MAX_FILE_MB) });
    }
    if (error instanceof AppError) {
      switch (error.code) {
        case "NOT_FOUND":
          return t("bot.notFound");
        case "RATE_LIMITED":
          return t("bot.rateLimited", { minutes: Number(error.params["retryAfterMinutes"] ?? 1) });
        case "FILE_TOO_LARGE":
          return t("bot.tooLarge", { mb: Number(error.params["limitMb"] ?? 20) });
        case "FILE_TYPE_NOT_ALLOWED":
          return t("bot.unsupported");
        default:
          break;
      }
    }
    platform.log.error({ err: error }, "telegram.update-failed");
    return t("bot.failed");
  }

  async function dispatch(incoming: Incoming, api: BotApi): Promise<void> {
    const { origin, event } = incoming;
    const { chatId } = origin;
    // TG-11: только личные чаты, и пишет в них сам владелец чата.
    if (
      GROUP_CHATS.has(origin.chatType) ||
      origin.chatType !== "private" ||
      origin.fromId !== chatId
    ) {
      if (GROUP_CHATS.has(origin.chatType)) {
        await api.send(chatId, t("bot.group"));
        await api.leave(chatId);
      }
      return;
    }
    if (event.kind === "start" && event.argument.trim() !== "") {
      await linkOps.linkFromStart(origin, event.argument, api);
      return;
    }
    const link = await findLinkByChat(system, chatId);
    if (link === undefined) {
      await api.send(chatId, t("bot.notLinked"));
      return;
    }
    const s = d.scopedFor(link);
    const state = await neighbours.identity.memberState(s.scope);
    if (state === "absent") {
      await api.send(chatId, t("bot.notLinked"));
      return;
    }
    // AUTH-11: заблокированному — понятное сообщение; данные его аккаунта не читаются.
    if (state === "blocked") {
      await api.send(chatId, t("bot.blocked"));
      return;
    }
    await withLogContext({ requestId: randomUUID(), uid: link.userId, source: "bot" }, () =>
      route(s, incoming, api),
    );
  }

  async function route(s: ScopedDb, incoming: Incoming, api: BotApi): Promise<void> {
    const { origin, event } = incoming;
    const { chatId } = origin;
    switch (event.kind) {
      case "start":
        await api.send(chatId, t("bot.start.already"));
        return;
      case "command":
        await command(s, incoming, event.name, api);
        return;
      case "text":
        await conversation.ask(s, origin, event.text, api);
        return;
      case "voice":
        await conversation.voice(s, origin, event, api);
        return;
      case "photo":
        await documents.acceptReceipt(
          s,
          origin,
          { fileId: event.fileId, name: "telegram-photo.jpg", size: event.size },
          api,
        );
        return;
      case "document":
        // Документ-картинка — тот же чек, что и фото (файл без сжатия); прочее — выписка.
        if (event.mime?.startsWith("image/") === true) {
          await documents.acceptReceipt(s, origin, event, api);
        } else await documents.acceptStatement(s, origin, event, api);
        return;
      case "callback":
        await callback(s, incoming, event, api);
        return;
      case "unsupported":
        await api.send(chatId, t("bot.unsupported"));
        return;
    }
  }

  /** Команда меню (TG-07, TG-09) — из текста «/…» или кнопки: одна функция на обе дороги. */
  async function command(
    s: ScopedDb,
    incoming: Incoming,
    name: BotCommand,
    api: BotApi,
  ): Promise<void> {
    const { origin } = incoming;
    switch (name) {
      case "help":
        await api.send(origin.chatId, t("bot.help"), [
          [
            {
              text: t("bot.buttons.resetPassword"),
              data: encodeCallback({ action: "command", id: "password" }),
            },
          ],
        ]);
        return;
      case "new":
        await neighbours.chat.startNew(s, "telegram", origin.sentAt);
        await api.send(origin.chatId, t("bot.newConversation"));
        return;
      case "unlink":
        await linkOps.unlink(s, undefined);
        await api.send(origin.chatId, t("bot.unlinked"));
        return;
      case "balance":
        return commands.balance(s, origin, api);
      case "week":
        return commands.week(s, origin, api);
      case "limits":
        return commands.limits(s, origin, api);
      case "undo":
        return commands.undo(s, origin, api);
      case "model":
        return commands.model(s, origin, api);
      case "password":
        return commands.resetPassword(s, origin, api);
    }
  }

  async function callback(
    s: ScopedDb,
    incoming: Incoming,
    event: Extract<Incoming["event"], { kind: "callback" }>,
    api: BotApi,
  ): Promise<void> {
    const { chatId } = incoming.origin;
    const parsed = decodeCallback(event.data);
    if (parsed === undefined) return;
    const finish = (status: string) =>
      api.edit(chatId, event.messageId, `${event.text}\n\n${status}`);
    switch (parsed.action) {
      case "receipt-confirm":
        await neighbours.receipts.confirm(s, parsed.id as never);
        await finish(t("bot.receipt.confirmed"));
        return;
      case "receipt-cancel":
        await neighbours.receipts.cancel(s, parsed.id as never);
        await finish(t("bot.receipt.cancelled"));
        return;
      case "receipt-edit": {
        // Карточку своего чека читаем через s: чужой id — NOT_FOUND ещё до ссылки.
        await neighbours.receipts.card(s, parsed.id as never);
        const url = `${await d.siteOrigin()}/documents?open=${parsed.id}`;
        await api.send(chatId, t("bot.receipt.edit", { url }));
        return;
      }
      case "statement-import": {
        const result = await neighbours.statements.confirm(s, parsed.id as never);
        await finish(t("bot.statement.imported", { count: result.imported }));
        return;
      }
      case "statement-cancel":
        await neighbours.statements.cancel(s, parsed.id as never);
        await finish(t("bot.statement.cancelled"));
        return;
      case "decision-yes":
      case "decision-no": {
        const yes = parsed.action === "decision-yes";
        const result = await neighbours.actions.answer(
          s,
          parsed.id,
          yes ? "yes" : "no",
          "telegram",
        );
        const status = t(yes ? "bot.decision.yes" : "bot.decision.no");
        // «Да» могло оставить отмену (удаление операций — «Отменить» сразу после, TXN-03): кнопка вместо прежних.
        if (result.undoToken === null) await finish(status);
        else {
          await api.edit(chatId, event.messageId, `${event.text}\n\n${status}`, [
            [
              {
                text: t("bot.buttons.undo"),
                data: encodeCallback({ action: "undo", id: result.undoToken }),
              },
            ],
          ]);
        }
        return;
      }
      case "undo":
        // Кнопки у сообщения убираем сразу: повторное нажатие всё равно безвредно (`already-undone`), но зачем звать его.
        await api.edit(chatId, event.messageId, event.text);
        await commands.undoToken(s, chatId, parsed.id, api);
        return;
      case "command":
        if (parsed.id === "balance") return commands.balance(s, incoming.origin, api);
        if (parsed.id === "week") return commands.week(s, incoming.origin, api);
        if (parsed.id === "limits") return commands.limits(s, incoming.origin, api);
        if (parsed.id === "model") return commands.model(s, incoming.origin, api);
        return commands.resetPassword(s, incoming.origin, api);
      case "model":
        return commands.chooseModel(s, incoming.origin, event.messageId, parsed.id, api);
    }
  }

  return {
    /**
     * Принять обновление: кнопка отвечает сразу, остальное — в очередь чата (не держит опрос). Результат — когда работа
     * выполнена (опросу его ждать не нужно; тестам — нужно).
     */
    handle(incoming: Incoming, api: BotApi): Promise<void> {
      if (incoming.event.kind === "callback") {
        void api.answerCallback(incoming.event.callbackId).catch((error: unknown) => {
          platform.log.warn({ err: error }, "telegram.callback-answer-failed");
        });
      }
      return queue.run(incoming.origin.chatId, async () => {
        try {
          await dispatch(incoming, api);
        } catch (error) {
          const text = await failureText(error);
          try {
            await api.send(incoming.origin.chatId, text);
          } catch (sendError) {
            platform.log.error({ err: sendError }, "telegram.reply-failed");
          }
        }
      });
    },
    deliverReceipt: documents.deliverReceipt,
    /** Дождаться начатого: очередь чатов и фоновое ожидание карточек (остановка процесса, тесты). */
    async drain(): Promise<void> {
      do {
        await queue.drain();
        await Promise.all(background);
      } while (background.size > 0);
    },
  };
}

export type BotHandler = ReturnType<typeof makeBotHandler>;

// Чат (CHAT-01, CHAT-02, NFR-21, ARCHITECTURE §8.3): поток ответа ассистента — итератор событий oRPC. Тела событий —
// куски UI-сообщения AI SDK (UIMessageChunk), сохранённые сообщения — его части (UIMessage.parts). Контракт не
// импортирует `ai` (ADR-0005: только zod, @orpc/contract, kernel), поэтому куски и части AI SDK (текст, вызовы
// инструментов, шаги) здесь слабые — «объект с type»: их форму проверяет AI SDK на сайте (useChat). Данные-части нашего
// реестра (`DATA_PARTS`) — строгие: тип и схема данных вместе, неизвестный `data-…` не проходит (CHAT-04).
// Запуск агента не привязан к соединению: закрыли вкладку — ответ дописывается и сохраняется; «Стоп» — stop(runId).
import { eventIterator, oc } from "@orpc/contract";
import { z } from "zod";
import { pickErrors } from "../errors.ts";
import { AnswerMetadata, ChatAttachment, DATA_PARTS, MAX_ATTACHMENTS } from "./agent-parts.ts";
import { PageContext } from "./page-context.ts";

export const ConversationId = z.uuid().brand<"ConversationId">();
export type ConversationId = z.infer<typeof ConversationId>;

/** Запуск агента (ответ на одно сообщение): его id приходит в метаданных первого куска потока. */
export const RunId = z.uuid().brand<"RunId">();
export type RunId = z.infer<typeof RunId>;

/** Кусок потока UI-сообщения AI SDK (`text-delta`, `tool-output-available`…) — слабая схема, см. шапку. */
export const UiMessageChunk = z.looseObject({ type: z.string().min(1).max(64) });

/** Данные-часть реестра: `{ type: "data-<вид>", id?, data }` с настоящей схемой данных (по одной на вид). */
const registeredDataParts = Object.entries(DATA_PARTS).map(([type, data]) =>
  z.strictObject({ type: z.literal(type), id: z.string().max(100).optional(), data }),
);

/**
 * Часть сохранённого сообщения (UIMessage.parts): данные-части реестра — строго, остальное — как строит AI SDK (текст,
 * `tool-<имя>`, `step-start`); `data-…` вне реестра не проходит.
 */
export const UiMessagePart = z.union([
  ...(registeredDataParts as [(typeof registeredDataParts)[number], ...typeof registeredDataParts]),
  z
    .looseObject({ type: z.string().min(1).max(64) })
    .refine((part) => !part.type.startsWith("data-")),
]);

/** Состояние ответа: идёт, готов или оборван («Стоп», остановка сервера). */
export const MessageStatus = z.enum(["streaming", "complete", "interrupted"]);

export const ChatMessage = z.strictObject({
  id: z.uuid(),
  role: z.enum(["user", "assistant"]),
  parts: z.array(UiMessagePart).max(500),
  status: MessageStatus,
  /** Кто ответил (LLM-10): сохраняется с ответом, чтобы пометка «Модель X недоступна, ответила Y» пережила перезагрузку. */
  answeredBy: AnswerMetadata.shape.answeredBy.optional(),
  /** CHAT-10: версии статей ответа, которые с тех пор заменены новой редакцией; пусто — поле нет. */
  changedVersionIds: z.array(z.string().max(64)).max(200).optional(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

/** Метаданные первого куска (start) потока ответа: чем остановить запуск и в какой он диалог. */
export const RunMetadata = z.strictObject({ runId: RunId, conversationId: ConversationId });
export type RunMetadata = z.infer<typeof RunMetadata>;

/** Название диалога (CHAT-01): по первому сообщению без модели, пользователь может переименовать. */
export const ConversationTitle = z.string().trim().min(1).max(100);

/** Строка списка диалогов: название, время последнего сообщения и его начало. */
export const ConversationItem = z.strictObject({
  id: ConversationId,
  title: z.string().nullable(),
  /** Время последнего сообщения, ISO UTC; день и час сайт показывает по поясу пользователя. */
  updatedAt: z.iso.datetime(),
  /** Начало последнего сообщения (текст без разметки) для строки списка. */
  preview: z.string().max(120),
});
export type ConversationItem = z.infer<typeof ConversationItem>;

export const SendInput = z
  .strictObject({
    /** Нет — новый диалог. */
    conversationId: ConversationId.optional(),
    /** Пустой текст — только вложения (CHAT-03): тогда модель не зовётся, ответ — карточки вложений. */
    text: z.string().trim().max(4000),
    /** Что пользователь видит сейчас (CHAT-08): агент получает это блоком данных, а не инструкцией. */
    page: PageContext.optional(),
    /** Чек или выписка, уже принятые конвейером раздела «Чеки и документы» (CHAT-03). */
    attachments: z.array(ChatAttachment).max(MAX_ATTACHMENTS).optional(),
  })
  .refine((input) => input.text !== "" || (input.attachments?.length ?? 0) > 0, {
    message: "empty-message",
    path: ["text"],
  });

export const chatContract = {
  /** Диалог и его сообщения; без `conversationId` — последний. Чужой или несуществующий — NOT_FOUND. */
  history: oc
    .route({ method: "GET", path: "/chat/history" })
    .input(z.strictObject({ conversationId: ConversationId.optional() }))
    .output(
      z.strictObject({
        conversationId: ConversationId.nullable(),
        title: z.string().nullable(),
        messages: z.array(ChatMessage).max(500),
      }),
    )
    .errors(pickErrors("UNAUTHORIZED", "NOT_FOUND")),
  /** Список диалогов, свежие сверху (CHAT-01). */
  conversations: oc
    .route({ method: "GET", path: "/chat/conversations" })
    .output(z.strictObject({ items: z.array(ConversationItem).max(200) }))
    .errors(pickErrors("UNAUTHORIZED")),
  /** Переименовать диалог. */
  rename: oc
    .route({ method: "POST", path: "/chat/rename" })
    .input(z.strictObject({ conversationId: ConversationId, title: ConversationTitle }))
    .output(z.strictObject({ ok: z.literal(true) }))
    .errors(pickErrors("UNAUTHORIZED", "VALIDATION", "NOT_FOUND")),
  /** Удалить диалог с сообщениями; идущий в нём ответ останавливается. */
  remove: oc
    .route({ method: "POST", path: "/chat/remove" })
    .input(z.strictObject({ conversationId: ConversationId }))
    .output(z.strictObject({ ok: z.literal(true) }))
    .errors(pickErrors("UNAUTHORIZED", "NOT_FOUND")),
  /** Сообщение ассистенту: поток ответа (куски UI-сообщения); первый кусок несёт RunMetadata. */
  send: oc
    .route({ method: "POST", path: "/chat/send" })
    .input(SendInput)
    .output(eventIterator(UiMessageChunk))
    .errors(pickErrors("UNAUTHORIZED", "VALIDATION", "NOT_FOUND", "UNAVAILABLE", "RATE_LIMITED")),
  /** «Стоп»: запуск своего домохозяйства останавливается, модель освобождается; чужой или законченный — NOT_FOUND. */
  stop: oc
    .route({ method: "POST", path: "/chat/stop" })
    .input(z.strictObject({ runId: RunId }))
    .output(z.strictObject({ ok: z.literal(true) }))
    .errors(pickErrors("UNAUTHORIZED", "NOT_FOUND")),
};

// Данные-части ответа агента (AGT-04, AGT-05, AGT-07, LEGAL-03, CHAT-03, CHAT-04, ARCHITECTURE §8.2): `data-law-answer`
// (правовой ответ с дословными цитатами), `data-action-result` (итог «Да»/«Нет» без модели), `data-chart` (мини-график),
// `data-attachment` (вложенный чек или выписка: карточку рисует сайт по id). Сервер пишет
// их в поток и сохраняет в `chat_messages.parts`, сайт рисует по `type`. Схемы строгие: что не описано здесь, в часть не
// попадает. Поля только добавляются (.claude/rules/api-contract.md). Схема `LawAnswer` — зеркало результата
// `legal-consult.finalizeAnswer`; тип рядом с ней — в модуле legal-consult.
import { z } from "zod";
import { UndoToken } from "../actions/actions.contract.ts";

const Url = z.string().max(500);

/** Кусок ответа: текст или ссылка на блок `citations[n - 1]` (CHAT-05). */
export const LawPartData = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("text"), text: z.string().max(100_000) }),
  z.strictObject({ type: z.literal("cite"), n: z.int().min(1).max(200) }),
]);

export const LawCitationData = z.discriminatedUnion("kind", [
  z.strictObject({
    n: z.int().min(1).max(200),
    kind: z.literal("quote"),
    versionId: z.string().max(64),
    pravoId: z.string().max(32),
    actTitle: z.string().max(500),
    label: z.string().max(100).nullable(),
    path: z.string().max(1000),
    /** Дословный текст версии фрагмента (DES-12). */
    text: z.string().max(100_000),
    /** «в редакции на 21.10.2026». */
    edition: z.string().max(100),
    editionOn: z.string().max(10).nullable(),
    url: Url,
    /** CHAT-10: версия заменена новой редакцией — показан прежний текст. */
    changedSince: z.boolean(),
    notes: z.array(z.string().max(1000)).max(20),
  }),
  z.strictObject({
    n: z.int().min(1).max(200),
    kind: z.literal("link"),
    reason: z.string().max(40),
    pravoId: z.string().max(32),
    actTitle: z.string().max(500),
    label: z.string().max(100).nullable(),
    url: Url,
    note: z.string().max(1000),
  }),
]);

export type LawCitationData = z.infer<typeof LawCitationData>;

export const LawNoticeData = z.strictObject({
  kind: z.enum(["past-date", "rate", "unresolved", "disclaimer"]),
  text: z.string().max(2000),
});

/** Правовой ответ после `finalizeAnswer` (LEGAL-03…08): текст целиком, цитаты, пометки, версии для CHAT-10. */
export const LawAnswerData = z.strictObject({
  outcome: z.enum(["cited", "no-base"]),
  parts: z.array(LawPartData).max(500),
  citations: z.array(LawCitationData).max(200),
  notices: z.array(LawNoticeData).max(20),
  versionIds: z.array(z.string().max(64)).max(200),
});
export type LawAnswerData = z.infer<typeof LawAnswerData>;

/** Итог ответа человека на ожидающее решение (AGT-07): без модели; «Да» — с токеном «Отменить» (P5). */
export const ActionResultData = z.strictObject({
  decisionId: z.uuid(),
  status: z.enum(["yes", "no"]),
  undoToken: UndoToken.nullable(),
});
export type ActionResultData = z.infer<typeof ActionResultData>;

/** Максимум рядов графика (AGT-03): больше шести не читается. */
export const MAX_CHART_SERIES = 6;

/** Мини-график (AGT-02, CHAT-04). Значения — как в результатах инструментов: копейки у `money`. */
export const ChartData = z.strictObject({
  kind: z.enum(["bar", "line", "pie"]),
  title: z.string().trim().min(1).max(120),
  unit: z.enum(["money", "count", "percent"]),
  /** Код валюты у `money`. */
  currency: z.string().length(3).nullable(),
  labels: z.array(z.string().max(60)).min(1).max(60),
  series: z
    .array(
      z.strictObject({
        name: z.string().trim().min(1).max(60),
        values: z.array(z.number()).min(1).max(60),
      }),
    )
    .min(1)
    .max(MAX_CHART_SERIES),
});
export type ChartData = z.infer<typeof ChartData>;

/** Максимум вложений в одном сообщении (CHAT-03): столько же фото чека берёт одна загрузка раздела — но чат не склад. */
export const MAX_ATTACHMENTS = 4;

/**
 * Вложение сообщения (CHAT-03): файл уже принят конвейером (`files.upload` → `receipts.start` | `statements.start`), здесь —
 * только ссылка. Карточку рисует сайт, состояние берёт у `receipts.get` / `statements.get` (чужой id — NOT_FOUND).
 */
export const ChatAttachment = z.strictObject({
  kind: z.enum(["receipt", "statement"]),
  id: z.uuid(),
});
export type ChatAttachment = z.infer<typeof ChatAttachment>;

/** Кто ответил (LLM-10): модель цепочки и модели, которые были недоступны; идёт в метаданных куска `finish`. */
export const AnswerMetadata = z.strictObject({
  answeredBy: z.strictObject({
    model: z.string().max(200),
    unavailable: z.array(z.string().max(200)).max(20),
  }),
});
export type AnswerMetadata = z.infer<typeof AnswerMetadata>;

/** Виды данных-частей по имени части UI-сообщения: сервер пишет, сайт выбирает компонент. */
export const DATA_PARTS = {
  "data-law-answer": LawAnswerData,
  "data-action-result": ActionResultData,
  "data-chart": ChartData,
  "data-attachment": ChatAttachment,
} as const;

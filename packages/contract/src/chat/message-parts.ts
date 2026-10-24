// Части сообщения чата (ARCHITECTURE §8.3, §10.3): текст ответа модели, шаг агента и карточка объекта. Подпись шага
// сайт берёт из словаря tools по имени инструмента — от модели в части только имя. Новые виды и поля частей
// добавляют T-006, T-010, T-043; поля только добавляются (.claude/rules/api-contract.md).
import { z } from "zod";
import { EntityId, EntityKind } from "../common.ts";

/** Текст ответа ассистента (Markdown). */
export const TextPart = z.strictObject({
  type: z.literal("text"),
  text: z.string().max(100_000),
});

/** Шаг агента: вызов инструмента; имя — как в реестре инструментов (snake_case). */
export const StepPart = z.strictObject({
  type: z.literal("step"),
  tool: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
});

/** Карточка объекта (чек, операция); вид карточки сайт выбирает по `kind`. */
export const CardPart = z.strictObject({
  type: z.literal("card"),
  kind: EntityKind,
  id: EntityId,
});

export const ChatMessagePart = z.discriminatedUnion("type", [TextPart, StepPart, CardPart]);
export type ChatMessagePart = z.infer<typeof ChatMessagePart>;

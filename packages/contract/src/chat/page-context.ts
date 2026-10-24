// CHAT-08, ARCHITECTURE §10.2: что пользователь видит сейчас — маршрут, параметры адреса и выбранный объект.
// Собирает его сайт (usePageContext), читает агент; это вход модели, поэтому всё ограничено, лишние поля не проходят.
import { z } from "zod";
import { EntityId, EntityKind } from "../common.ts";

const MAX_PARAMS = 20;

export const PageContext = z.strictObject({
  /** Путь маршрута сайта: «/operations». */
  route: z.string().startsWith("/").max(200),
  /** Параметры адреса — состояние страницы: период, фильтры (`{ period: "2026-09", category: "taxi" }`). */
  params: z
    .record(z.string().min(1).max(64), z.string().max(200))
    .refine((params) => Object.keys(params).length <= MAX_PARAMS, {
      message: `Не больше ${MAX_PARAMS} параметров адреса.`,
    }),
  /** Выбранный на странице объект (операция в таблице, открытый чек). */
  selected: z.strictObject({ entity: EntityKind, id: EntityId }).optional(),
});
export type PageContext = z.infer<typeof PageContext>;

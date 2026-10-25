// Событие модуля (ADR-0004, ADR-0008, ARCHITECTURE §5): `<модуль>.<прошедшее время>`, схема — в events.ts
// публикующего модуля. Нагрузка — id пачкой: `{ ids: [...] }`, не больше MAX_EVENT_IDS (импорт 300 операций — одно
// событие, а не 300); других данных, кроме id, в событии нет (OBS-04). Подписчик перечитывает состояние сам.
import { z } from "zod";
import { JOB_NAME, type PayloadSchema } from "../jobs/define-job.ts";

/** Сколько id в одном событии: больше — публикующий делит на пачки. */
export const MAX_EVENT_IDS = 1000;

/** Общая часть нагрузки любого события: непустая пачка id. */
const EventIds = z.object({ ids: z.array(z.string()).min(1).max(MAX_EVENT_IDS) });

/** Нагрузка события: поля схемы модуля и пачка id. */
export type EventPayload = { readonly ids: readonly string[] };

export interface EventDef<P extends EventPayload = EventPayload> {
  readonly name: string;
  readonly payload: PayloadSchema<P>;
}

export function defineEvent<S extends z.ZodObject>(definition: {
  readonly name: string;
  readonly payload: S;
}): EventDef<z.output<S> & z.output<typeof EventIds>> {
  if (!JOB_NAME.test(definition.name)) {
    throw new RangeError(
      `Имя события «${definition.name}»: ожидается <модуль>.<прошедшее время> строчными.`,
    );
  }
  if (!("ids" in definition.payload.shape)) {
    throw new RangeError(`Событие ${definition.name}: нагрузка — пачка id в поле ids.`);
  }
  // Пачка проверяется всегда, даже если схема модуля забыла про .max(): «шторм» не прячется в одном событии.
  return { name: definition.name, payload: definition.payload.and(EventIds) };
}

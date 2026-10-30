// Адрес главной (DASH-01): период — `from` и `to` в адресе (ссылку можно сохранить, «назад» возвращает период); без них —
// текущий месяц по часам сервера. Неверное значение отбрасывается: адрес, набранный руками, экран не ломает.
import { LocalDate } from "@kosht/contract";
import { z } from "zod";

export const HomeSearch = z.object({
  from: LocalDate.schema.optional().catch(undefined),
  to: LocalDate.schema.optional().catch(undefined),
});
export type HomeSearch = z.infer<typeof HomeSearch>;

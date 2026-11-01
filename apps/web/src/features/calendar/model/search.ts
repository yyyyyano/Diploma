// Адрес экрана «Календарь» (CAL-01): вид, месяц и открытая карточка живут в адресе — ссылку можно сохранить и открыть. Неверное
// значение отбрасывается (`catch`): адрес, набранный руками, не ломает экран.
import { CalendarMonth } from "@kosht/contract";
import { z } from "zod";

export const CalendarSearch = z.object({
  /** «Месяц» (по умолчанию) или «Список». */
  view: z.enum(["month", "list"]).optional().catch(undefined),
  /** Месяц сетки «ГГГГ-ММ»; без него — текущий по часам сервера. */
  month: CalendarMonth.optional().catch(undefined),
  /** Открытая карточка события (id хранимого события). */
  event: z.uuid().optional().catch(undefined),
});
export type CalendarSearch = z.infer<typeof CalendarSearch>;

// Адрес экрана «Налоговые вычеты» (TAX-01): вид вычета в калькуляторе живёт в адресе — ссылку можно сохранить. Неверное значение
// отбрасывается (`catch`): адрес, набранный руками, не ломает экран.
import { DeductionKind } from "@kosht/contract";
import { z } from "zod";

export const DeductionsSearch = z.object({
  /** Вкладка калькулятора: «Обучение» (по умолчанию), «Жильё», «Дети». */
  kind: DeductionKind.optional().catch(undefined),
});
export type DeductionsSearch = z.infer<typeof DeductionsSearch>;

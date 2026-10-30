// Адрес экрана «Регулярные платежи» (REC-02): вкладка-фильтр живёт в адресе — ссылку можно сохранить. Неверное значение
// отбрасывается (`catch`): адрес, набранный руками, не ломает экран.
import { z } from "zod";

export const RecurringSearch = z.object({
  /** Вкладка: «Доходы», «Обязательные», «Подписки»; нет — «Все». */
  section: z.enum(["income", "mandatory", "subscriptions"]).optional().catch(undefined),
});
export type RecurringSearch = z.infer<typeof RecurringSearch>;

// Адрес страницы входа: created — пришли с первого запуска (показываем «Администратор создан»). Всё прочее в
// адресе отбрасывается, неверное значение — как его отсутствие.
import { z } from "zod";

export const LoginSearch = z.object({
  created: z.literal(true).optional().catch(undefined),
});
export type LoginSearch = z.infer<typeof LoginSearch>;

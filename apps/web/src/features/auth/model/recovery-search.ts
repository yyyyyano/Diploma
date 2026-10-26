// Адрес восстановления доступа: token — ссылка из письма сброса (форма нового пароля); mode=code — вход с кодом
// восстановления; иначе — запрос ссылки на почту. Неверные значения — как их отсутствие.
import { LinkToken } from "@kosht/contract";
import { z } from "zod";

export const RecoverySearch = z.object({
  token: LinkToken.optional().catch(undefined),
  mode: z.literal("code").optional().catch(undefined),
});
export type RecoverySearch = z.infer<typeof RecoverySearch>;

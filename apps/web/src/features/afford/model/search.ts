// Адрес экрана «Могу ли я позволить покупку?» (AFF-01): сумма из карточки главной (`?sum=3000`) подставляется в форму. Неверное
// значение отбрасывается (`catch`): адрес, набранный руками, не ломает экран.
import { z } from "zod";

export const AffordSearch = z.object({
  /** Сумма покупки в рублях целым числом: «3000». */
  sum: z
    .string()
    .regex(/^\d{1,7}$/u)
    .optional()
    .catch(undefined),
});
export type AffordSearch = z.infer<typeof AffordSearch>;

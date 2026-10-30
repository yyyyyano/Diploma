// Адрес «Базы законов» (LEGAL-11): тема, состояние и поиск живут в адресе — ссылку можно сохранить и отправить. Неверное
// значение отбрасывается (`catch`), адрес, набранный руками, экран не ломает. В читалке — `article`: ключ статьи или части.
import { LawGroup, LawStatus } from "@kosht/contract";
import { z } from "zod";

export const LawsSearch = z.object({
  /** Тема; `other` — акты без темы. */
  group: LawGroup.or(z.literal("other")).optional().catch(undefined),
  status: LawStatus.optional().catch(undefined),
  // Без trim: пробел, набранный в строке поиска, не должен пропадать из адреса.
  q: z.string().max(200).optional().catch(undefined),
});
export type LawsSearch = z.infer<typeof LawsSearch>;

export const ReaderSearch = z.object({
  // Адрес `?article=210` роутер читает как число: принимаем и число, и строку («216.1», «p:2»).
  article: z.coerce
    .string()
    .regex(/^(?:\d{1,4}(?:\.\d{1,3})?|p:\d{1,4})$/u)
    .optional()
    .catch(undefined),
});
export type ReaderSearch = z.infer<typeof ReaderSearch>;

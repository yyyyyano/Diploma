// Уведомление «… [Отменить]» (P5) живёт 5 с, пока на «Отменить» нет фокуса или указателя (WCAG 2.2.1, ui/UndoToast).
// Под нагрузкой ответ сервера, перезапрос списка или axe идут дольше 5 с, и тест, который гонится за этим временем,
// плавает. Поэтому тест ждёт само уведомление (без своего предела в 5 с) и держит его фокусом на «Отменить» — так же,
// как это делает человек с клавиатуры.
import { expect, type Locator, type Page } from "@playwright/test";

/** Дождаться уведомления с текстом `text` и удержать его; возвращает его кнопку «Отменить». */
export async function holdUndoToast(page: Page, text: string | RegExp): Promise<Locator> {
  const toast = page.getByRole("status").filter({ hasText: text });
  const undo = toast.getByRole("button", { name: "Отменить" });
  // focus() ждёт появления кнопки до общего предела теста, а не 5 с проверки; фокус ставит уведомление на паузу.
  await undo.focus();
  await expect(undo).toBeFocused();
  await expect(toast).toBeVisible();
  return undo;
}

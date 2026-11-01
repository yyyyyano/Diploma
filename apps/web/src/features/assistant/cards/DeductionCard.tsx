// Карточка расчёта вычета (`calculate_deduction`, TAX-06, CHAT-04): сумма, формула, «Откуда эта цифра?», нормы и чек-лист. Результат
// инструмента проверяется схемой контракта; иная форма — ничего (шаг остаётся подписью в ленте). Вопрос о зарплате (TAX-04) в чате
// задаёт агент, поэтому формы ввода здесь нет. Сам вид — общий с экраном «Налоговые вычеты» (`entities/deduction`).
import { DeductionResult } from "@kosht/contract";
import { z } from "zod";
import { DeductionResultView } from "../../../entities/deduction/index.ts";

const UUID = z.uuid();

export function DeductionCard({
  output,
  messageId,
}: {
  readonly output: unknown;
  readonly messageId: string;
}) {
  const parsed = DeductionResult.safeParse(output);
  if (!parsed.success) return null;
  // Сообщение без своего id (локальное, до ответа сервера) делит «общее» состояние чек-листа.
  const subject = UUID.safeParse(messageId).success
    ? ({ kind: "message", id: messageId } as const)
    : ({ kind: "general" } as const);
  return <DeductionResultView result={parsed.data} checklistSubject={subject} headingLevel={4} />;
}

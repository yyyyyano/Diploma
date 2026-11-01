// Карточка сценариев покупки (`afford_scenarios`, AFF-07, CHAT-04): три сценария, график, предупреждения и «Откуда эта цифра?».
// Результат проверяется схемой контракта; иная форма — ничего (шаг остаётся подписью в ленте). Ожидаемый доход и день (AFF-08) в
// чате спрашивает агент, поэтому формы ввода здесь нет. Сам вид — общий с экраном (`entities/afford`).
import { AffordResult, SafeLoanResult } from "@kosht/contract";
import { AffordResultView, SafeLoanView } from "../../../entities/afford/index.ts";

export function AffordCard({ output }: { readonly output: unknown }) {
  const parsed = AffordResult.safeParse(output);
  if (!parsed.success) return null;
  return <AffordResultView result={parsed.data} headingLevel={3} />;
}

/** Карточка безопасного платежа (`safe_loan_payment`, AFF-05): предел, платёж, сумма кредита; предел не подтверждён — честное «нет предела». */
export function SafeLoanCard({ output }: { readonly output: unknown }) {
  const parsed = SafeLoanResult.safeParse(output);
  if (!parsed.success) return null;
  return <SafeLoanView result={parsed.data} headingLevel={3} />;
}

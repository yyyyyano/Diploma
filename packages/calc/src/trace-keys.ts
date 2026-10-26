// Общий реестр ключей трассы (EXPL-01, ADR-0017): ключи, которые строят показатели calc, и ключи их входов по
// договорённости. У каждого — подпись в словаре formulas (@kosht/i18n): это проверяет тест словаря. Новый показатель —
// ключ сюда, подпись туда и тест-пример (.claude/rules/calc.md).
export const TRACE_KEYS = [
  // FIN-20: свободный остаток и слагаемые разбивки «средний доход − ЖКХ − связь − кредит − подписки».
  "fin.freeBalance",
  "fin.averageIncome",
  "fin.obligation.utilities",
  "fin.obligation.communication",
  "fin.obligation.loan",
  "fin.obligation.subscriptions",
] as const;

export type TraceKey = (typeof TRACE_KEYS)[number];

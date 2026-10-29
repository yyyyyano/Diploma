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
  // STMT-09: эквивалент в BYN — курс НБРБ (в десятитысячных) и масштаб (за сколько единиц валюты).
  "fx.rate",
  "fx.scale",
  // STMT-01/02, STMT-09: остатки счетов и итоги экрана «Счета».
  "accounts.balance",
  "accounts.initialBalance",
  "accounts.balanceInByn",
  "accounts.total",
  "accounts.available",
  // STMT-02, STMT-09: сумма операции, её эквивалент в BYN и сдвиг остатка счёта от операции.
  "transactions.amount",
  "transactions.amountInByn",
  "transactions.balanceDelta",
  // STMT-04: сверка цепочки остатков выписки — остаток на начало, операции, остаток на конец, ожидаемый конец и разница.
  "statements.openingBalance",
  "statements.operation",
  "statements.closingBalance",
  "statements.expectedClosing",
  "statements.balanceDifference",
] as const;

export type TraceKey = (typeof TRACE_KEYS)[number];

// Подписи ключей трассы calc для «Откуда эта цифра?» (P2, EXPL-01): ключ `fin.freeBalance` → `formulas:fin.freeBalance`.
// Новый показатель calc = функция + ключ здесь + тест-пример (.claude/rules/calc.md).
export const formulas = {
  /** Подпись ключа, которого нет в словаре (новый расчёт без подписи — ошибка теста, а не пустая строка). */
  unknown: "Слагаемое расчёта",
  recurring: {
    occurrence: "Платёж по операции",
    averageAmount: "Средняя сумма платежа",
    manualAmount: "Сумма, указанная вами",
    monthlyAmount: "Сумма в месяц",
    monthlyTotal: "Итого в месяц",
    yearlyTotal: "Итого в год",
    monthsInYear: "Месяцев в году",
  },
  fin: {
    freeBalance: "Свободный остаток",
    averageIncome: "Средний регулярный доход",
    obligation: {
      utilities: "ЖКХ",
      communication: "Связь, интернет и ТВ",
      loan: "Кредиты и займы",
      subscriptions: "Подписки и онлайн-сервисы",
    },
  },
  fx: {
    rate: "Курс НБРБ, BYN",
    scale: "За сколько единиц валюты",
  },
  accounts: {
    balance: "Остаток в валюте счёта",
    initialBalance: "Начальный остаток",
    balanceInByn: "Остаток в BYN по курсу НБРБ",
    total: "Всего на счетах",
    available: "Доступно без накопительного",
  },
  transactions: {
    amount: "Сумма операции",
    amountInByn: "Сумма в BYN по курсу НБРБ на день операции",
    balanceDelta: "Изменение остатка счёта",
  },
  statements: {
    openingBalance: "Остаток на начало периода по выписке",
    operation: "Операция выписки",
    closingBalance: "Остаток на конец периода по выписке",
    expectedClosing: "Остаток на конец, если все операции учтены",
    balanceDifference: "Расхождение с выпиской",
  },
  receipts: {
    unitPrice: "Цена за единицу",
    quantity: "Количество, в тысячных долях единицы",
    lineGross: "Цена × количество",
    lineDiscount: "Скидка на строку",
    lineExpected: "Сумма строки по расчёту",
    lineTotal: "Сумма строки на чеке",
    lineDifference: "Расхождение в строке",
    linesSum: "Сумма строк чека",
    receiptDiscount: "Скидки на чек",
    expectedTotal: "Итог по расчёту",
    total: "Итог на чеке",
    totalDifference: "Расхождение в итоге",
    categorySum: "Сумма позиций категории",
    categoryDiscount: "Доля скидки на чек",
    categorySplit: "Часть чека в категории",
    unrecognizedRemainder: "Нераспознанный остаток чека",
  },
} as const;

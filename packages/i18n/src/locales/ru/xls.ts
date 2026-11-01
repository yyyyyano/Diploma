// Тексты файла Excel (XLS-02, XLS-04): названия листов, шапки столбцов, подписи типов операций и итоговых строк. Книгу собирает
// сервер (`xls-export`), поэтому словарь не входит в `resources`: сайт его не грузит (бюджет первой загрузки) — нужен `createXlsT`.
export const xls = {
  sheet: {
    operations: "Операции",
    summary: "Сводка",
    limits: "Лимиты",
  },
  operations: {
    date: "Дата",
    account: "Счёт",
    type: "Тип",
    counterparty: "Контрагент",
    category: "Категория",
    amount: "Сумма",
    currency: "Валюта",
    amountByn: "Сумма в BYN",
  },
  // Значения столбца «Тип»: формулы листа «Сводка» ищут именно эти слова — менять только вместе с формулами (их строит код из этого же словаря).
  type: {
    expense: "Расход",
    income: "Доход",
    transfer: "Перевод",
    refund: "Возврат",
  },
  summary: {
    category: "Категория",
    total: "Итого",
    expenses: "Расходы",
    income: "Доходы",
    difference: "Разница",
  },
  limits: {
    category: "Категория",
    limit: "Лимит",
    fact: "Факт",
    percent: "Процент",
    month: "Месяц лимитов",
  },
  noCategory: "Без категории",
} as const;

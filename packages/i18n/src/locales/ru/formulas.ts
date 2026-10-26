// Подписи ключей трассы calc для «Откуда эта цифра?» (P2, EXPL-01): ключ `fin.freeBalance` → `formulas:fin.freeBalance`.
// Новый показатель calc = функция + ключ здесь + тест-пример (.claude/rules/calc.md).
export const formulas = {
  /** Подпись ключа, которого нет в словаре (новый расчёт без подписи — ошибка теста, а не пустая строка). */
  unknown: "Слагаемое расчёта",
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
} as const;

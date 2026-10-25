// Счета (design/screens/Accounts.dc.html, STMT-01): список счетов. Итоги, валюта, меню счёта и добавление — T-019.
export const accounts = {
  title: "Счета",
  count_one: "{{count, number}} счёт",
  count_few: "{{count, number}} счёта",
  count_many: "{{count, number}} счетов",
  count_other: "{{count, number}} счёта",
  kind: {
    cash: "Наличные",
  },
  cashNote: "Есть у каждого · {{currency}}",
  listLabel: "Ваши счета",
  balance: "Остаток",
  empty: {
    title: "Счетов пока нет",
    text: "«Наличные» появятся через несколько секунд после первого входа. Если их нет — обновите страницу.",
  },
  error: {
    title: "Не удалось загрузить счета",
    text: "Проверьте, что сервер запущен, и попробуйте ещё раз.",
    retry: "Попробовать ещё раз",
  },
} as const;

// Подписи шагов агента по имени инструмента (ARCHITECTURE §10.3): «Ищу траты за сентябрь…» — из словаря, не от модели.
// Подписи инструментов добавляют задачи, которые их создают; `fallback` — для инструмента без своей подписи.
export const tools = {
  fallback: "Выполняю шаг…",
  list_accounts: "Смотрю ваши счета…",
  explain_number: "Разбираю, как получилась цифра…",
  read_profile_facts: "Вспоминаю, что знаю о вас…",
  upsert_profile_fact: "Запоминаю…",
  create_account: "Добавляю счёт…",
  rename_account: "Переименовываю счёт…",
  delete_account: "Готовлю удаление счёта…",
  search_transactions: "Ищу операции…",
  add_transaction: "Записываю операцию…",
  update_transaction: "Меняю операцию…",
  delete_transaction: "Готовлю удаление операций…",
  bulk_change_category: "Готовлю смену категории…",
} as const;

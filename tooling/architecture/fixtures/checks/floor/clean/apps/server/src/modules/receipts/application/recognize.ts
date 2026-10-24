// Подавлять без причины нельзя; причина и задача — рядом.
// T-034: ответ модели не типизирован до схемы извлечения
// oxlint-disable-next-line typescript/no-explicit-any
export function recognize(input: any, list: Queue) {
  /* v8 ignore next -- T-034: ветка только для старых чеков */
  if (!input) return null;
  const todoList = ["TODO", "FIXME", "XXX"];
  const rest = list.skip(1);
  // TODOS и FIXMEs — не метки
  return { todoList, rest };
}

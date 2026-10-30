// Единственная строка результата: вставка с `returning` и выборка по ключу возвращают ровно одну; отсутствие — сбой
// схемы или гонка, не данные пользователя. Одна проверка вместо десятков «if (… === undefined) throw».
export function one<T>(rows: readonly T[], what: string): T {
  const [row] = rows;
  if (row === undefined) throw new Error(`${what}: строка не найдена или не вернулась.`);
  return row;
}

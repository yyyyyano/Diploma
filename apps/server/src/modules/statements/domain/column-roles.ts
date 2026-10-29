// Словарь заголовков колонок (STMT-04 шаг 2, эвристика): по тексту шапки таблицы — смысл колонки. Работает без модели:
// знакомые названия («Дата», «Описание», «Дебет», «Кредит», «Остаток», Date, Amount, Balance) узнаются сразу. Что в
// словаре нет — `ignore`, и если без этих колонок не обойтись, колонки определяет модель по небольшому фрагменту.
import type { Role } from "./types.ts";

/** Нижний регистр, «ё» → «е», без пунктуации по краям и лишних пробелов. */
export function normalizeHeader(text: string): string {
  return text
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[\s ]+/g, " ")
    .replace(/^[\s.,:;*№#-]+|[\s.,:;*]+$/g, "")
    .trim();
}

// Порядок важен: сначала узкие («сумма операции» — до «сумма»), потом общие.
const RULES: readonly (readonly [Role, RegExp])[] = [
  // «Сумма операции в валюте счёта» — это уже сумма со стороны счёта.
  ["amount", /(сумма|amount).*(в валюте счета|account currency|in account)/u],
  ["operationAmount", /(сумма|amount).*(операц|transaction)|(операц|transaction).*(сумма|amount)/u],
  ["amount", /^(сумма|amount|sum)(?!\p{L})/u],
  [
    "debit",
    /^(дебет|расход|расходы|списание|списано|debit|withdrawal|withdrawals|снятие)(?!\p{L})/u,
  ],
  ["credit", /^(кредит|приход|зачисление|зачислено|пополнение|credit|deposit|deposits)(?!\p{L})/u],
  ["balance", /(остаток|баланс|сальдо|balance)/u],
  ["time", /^(время|time)$/u],
  ["date", /^(дата|date)(?!\p{L})/u],
  ["currency", /^(валюта( счета)?|currency|вал)$/u],
  [
    "description",
    /(описание|назначение|контрагент|получатель|наименование|детали|комментарий|description|details|merchant|purpose|narrative|payee)/,
  ],
  [
    "operationId",
    /^(№|номер( операции| документа| транзакции)?|id|ид|reference|ref|код авторизации)$/,
  ],
];

/** Смысл колонки по тексту её заголовка; незнакомый — `ignore`. */
export function roleOfHeader(text: string): Role {
  const normalized = normalizeHeader(text);
  if (normalized === "") return "ignore";
  for (const [role, pattern] of RULES) if (pattern.test(normalized)) return role;
  return "ignore";
}

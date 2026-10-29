// Шапка банка над таблицей (и подвал под ней): название банка, номер счёта или карты, валюта счёта, период, остатки
// на начало и конец. Всё необязательно (SPEC 9.7: наличие остатков и валюты не подтверждено ни для одного банка):
// чего нет — undefined, а не выдумка. Распознаётся по тексту строк, а не по позициям: шапки у банков разные.
import { parseAmount } from "./values.ts";
import { parseDate } from "./values.ts";

export interface Preamble {
  readonly bank?: string;
  readonly accountMask?: string;
  readonly currency?: string;
  readonly period?: { readonly from: string; readonly to: string };
  /** Остатки текстом как в файле: знак и дробная часть — по общему разбору суммы. */
  readonly openingMinor?: number;
  readonly closingMinor?: number;
}

const IBAN = /\bBY\d{2}[A-Z0-9]{4}\d{4}[A-Z0-9]{16}\b/;
const CARD = /(?:\*{2,}|•{2,}|[xX]{2,})\s?(\d{4})\b/;
const CURRENCY = /(?:валюта(?:\s+счета|\s+счёта)?|currency)\s*[:-]?\s*([A-Z]{3})\b/i;
const PERIOD =
  /(\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{4}-\d{2}-\d{2})\s*[-–—]\s*(\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{4}-\d{2}-\d{2})/;
const OPENING =
  /(?:остаток|сальдо)\s+на\s+начало[^:\d−-]*[:\s]\s*(.+)$|входящий\s+остаток[^:\d−-]*[:\s]\s*(.+)$|opening\s+balance\s*[:\s]\s*(.+)$/i;
const CLOSING =
  /(?:остаток|сальдо)\s+на\s+конец[^:\d−-]*[:\s]\s*(.+)$|исходящий\s+остаток[^:\d−-]*[:\s]\s*(.+)$|closing\s+balance\s*[:\s]\s*(.+)$/i;
const BANK_PREFIX = /^(?:банк|bank)\s*[:-]\s*(.+)$/i;
const BANK_NAME = /^[\p{L}][\p{L}\s\-«»"'.]{2,40}$/u;

/** Сумма из хвоста строки «Остаток на начало: 1 000,00 BYN»: дробная часть — последняя запятая или точка с 1–2 цифрами. */
function balanceOf(tail: string): number | undefined {
  const trimmed = tail.trim();
  const decimal = /\.\d{1,2}(?!\d)/.test(trimmed) && !/,\d{1,2}(?!\d)/.test(trimmed) ? "." : ",";
  return parseAmount(trimmed, decimal);
}

function firstGroup(match: RegExpExecArray | null): string | undefined {
  return match?.slice(1).find((group) => group !== undefined);
}

/** Разобрать строки шапки и подвала (каждая — тексты её ячеек через пробел). */
export function readPreamble(lines: readonly string[]): Preamble {
  let bank: string | undefined;
  let mask: string | undefined;
  let currency: string | undefined;
  let period: Preamble["period"];
  let opening: number | undefined;
  let closing: number | undefined;
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (line === "") continue;
    const prefixed = BANK_PREFIX.exec(line);
    if (bank === undefined && prefixed?.[1] !== undefined) bank = prefixed[1].trim();
    else if (bank === undefined && BANK_NAME.test(line) && /банк|bank/i.test(line)) bank = line;
    if (mask === undefined) {
      const iban = IBAN.exec(line);
      if (iban !== null) mask = iban[0].slice(-4);
      else mask = CARD.exec(line)?.[1];
    }
    currency ??= CURRENCY.exec(line)?.[1]?.toUpperCase();
    if (period === undefined) {
      const found = PERIOD.exec(line);
      const from = found?.[1] === undefined ? undefined : parseDate(found[1], "dmy");
      const to = found?.[2] === undefined ? undefined : parseDate(found[2], "dmy");
      if (from !== undefined && to !== undefined) period = { from: from.date, to: to.date };
    }
    const open = firstGroup(OPENING.exec(line));
    if (opening === undefined && open !== undefined) opening = balanceOf(open);
    const close = firstGroup(CLOSING.exec(line));
    if (closing === undefined && close !== undefined) closing = balanceOf(close);
  }
  return {
    ...(bank === undefined ? {} : { bank }),
    ...(mask === undefined ? {} : { accountMask: mask }),
    ...(currency === undefined ? {} : { currency }),
    ...(period === undefined ? {} : { period }),
    ...(opening === undefined ? {} : { openingMinor: opening }),
    ...(closing === undefined ? {} : { closingMinor: closing }),
  };
}

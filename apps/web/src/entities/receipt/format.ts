// Показ чисел чека (RCPT-03): количество в тысячных долях и копейки — как печатают на чеке («3», «0,345», «2,49»). Это
// форматирование готовых чисел сервера и разбор ввода человека в редакторе, а не расчёт (P1): суммы считает сервер.
import type { Money } from "@kosht/kernel";

/** 3000 → «3», 345 → «0,345», 1500 → «1,5». */
export function formatQuantity(milli: number): string {
  const whole = Math.floor(milli / 1000);
  const fraction = String(milli % 1000)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return fraction === "" ? String(whole) : `${whole},${fraction}`;
}

/** Копейки без валюты для поля ввода: 249 → «2,49». */
export function plainAmount(money: Money): string {
  const abs = Math.abs(money.minor);
  const sign = money.minor < 0 ? "-" : "";
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

const QUANTITY = /^(\d{1,9})(?:[.,](\d{1,3}))?$/;

/** «0,345» → 345, «3» → 3000; не количество — undefined. */
export function parseQuantity(text: string): number | undefined {
  const match = QUANTITY.exec(text.replace(/\s/g, ""));
  if (match === null) return undefined;
  const [, whole = "0", fraction = ""] = match;
  const milli = Number(whole) * 1000 + Number(fraction.padEnd(3, "0"));
  return milli > 0 ? milli : undefined;
}

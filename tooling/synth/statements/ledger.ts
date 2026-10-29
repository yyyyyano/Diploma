// Книга операций синтетической выписки (T-025): детерминированная — одно зерно, один результат. Из неё и рисуется
// файл любого формата, и берётся эталон expected.json: «правда» известна заранее, разбор её не угадывает.

/** Генератор Mulberry32: зерно → числа [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Operation {
  /** ISO-дата «2026-09-15». */
  readonly date: string;
  readonly time?: string;
  readonly description: string;
  /** Со стороны счёта: поступление +, списание −; в валюте счёта. */
  readonly amountMinor: number;
  /** Сумма в валюте операции, если она не равна валюте счёта (покупка за границей). */
  readonly original?: { readonly minor: number; readonly currency: string };
  readonly balanceMinor: number;
}

/** Вымышленные продавцы: названия не принадлежат реальным компаниям (NFR-18 — реальных данных в наборе нет). */
const SHOPS = [
  "EVROTORG T-0042 MINSK UL. VESNOVAYA 12",
  "GIPPO MINSK PR. PEREDOVIKOV 3",
  "BELNEFT AZS 118 BREST",
  "APTEKA LISTOK 77 MINSK",
  "SADOVAYA KAFE GRODNO",
  "KINO ZVEZDA MINSK",
  "MOBILE STATION OPLATA SVYAZI",
  "DOSTAVKA PIROG 24 MINSK",
  "KNIZHNY DVOR MINSK",
  "MARKET ZELENY 5 GOMEL",
  "ERIP OPLATA ZHKH UL. LESNAYA 15 KV. 7 LITSEVOY SCHET 0045-1123 ZA SENTYABR 2026",
];
const INCOMES = ["Зарплата за месяц", "Аванс", "Пособие", "Поступление НПД"];

export interface LedgerSpec {
  readonly seed: number;
  readonly count: number;
  readonly from: string;
  readonly days: number;
  readonly openingMinor: number;
  /** Подмешать покупки в иностранной валюте (карта в BYN): [валюта, курс в копейках BYN за единицу]. */
  readonly foreign?: readonly (readonly [string, number])[];
  readonly withTime?: boolean;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function makeLedger(spec: LedgerSpec): Operation[] {
  const next = rng(spec.seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T;
  const ops: Operation[] = [];
  let balance = spec.openingMinor;
  for (let i = 0; i < spec.count; i++) {
    const date = addDays(spec.from, Math.floor((i / spec.count) * spec.days));
    const income = i % 11 === 5;
    let amount: number;
    let description: string;
    let original: Operation["original"];
    if (income) {
      amount = 50_000 + Math.floor(next() * 150_000);
      description = pick(INCOMES);
    } else {
      amount = -(150 + Math.floor(next() * 12_000));
      description = pick(SHOPS);
      if (spec.foreign !== undefined && i % 4 === 2) {
        const [currency, rate] = pick(spec.foreign);
        const units = 500 + Math.floor(next() * 4_000);
        original = { minor: -units, currency };
        amount = -Math.round((units * rate) / 100);
        description = `${pick(SHOPS).split(" ")[0]} ONLINE ${currency}`;
      }
    }
    balance += amount;
    const time = spec.withTime
      ? `${String(8 + Math.floor(next() * 12)).padStart(2, "0")}:${String(Math.floor(next() * 60)).padStart(2, "0")}`
      : undefined;
    ops.push({
      date,
      ...(time === undefined ? {} : { time }),
      description,
      amountMinor: amount,
      ...(original === undefined ? {} : { original }),
      balanceMinor: balance,
    });
  }
  return ops;
}

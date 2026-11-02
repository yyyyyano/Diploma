// Чеки демо (DEMO-01, design/demo-data.md «Чеки»): прочитанные строки, напечатанные как на чеке, и готовые ответы перепроверки.
// Статус каждого чека получает валидатор receipts, а не эти данные: «сходится» — арифметика строк и итога верна; «перепроверка» —
// строка 2 Гиппо прочитана как 8,47 (3 × 2,49 ≠ 8,47) и исправлена ответом на 7,47; «требует проверки» — у Короны строки 5 и 9
// не сходятся, а итог больше суммы строк на 1,37 («нераспознанный остаток» → «Прочее»). Магазины, УНП и УИ вымышлены (NFR-18).
import { LocalDate } from "@kosht/kernel";

/** Какое синтетическое фото чека приложено (`photos.ts`). */
export type PhotoKey = "evroopt" | "gippo" | "korona" | "belfarmaciya" | "elektrosila";

export interface ReadyLine {
  readonly name: string;
  readonly quantity: string;
  readonly unit: string | null;
  readonly unitPrice: string;
  readonly discount: string | null;
  readonly lineTotal: string;
}

export interface ReadyReading {
  readonly store: string;
  readonly unp: string;
  readonly address: string;
  /** День как напечатан: «12.10.2026». */
  readonly date: string;
  readonly time: string;
  readonly currency: "BYN";
  readonly items: readonly ReadyLine[];
  readonly receiptDiscount: string | null;
  readonly total: string;
  readonly payment: "cash" | "card";
  readonly cardLast4: string | null;
  readonly uid: string | null;
}

export interface ReadyRecheck {
  readonly lines: readonly {
    readonly line: number;
    readonly quantity: string;
    readonly unitPrice: string;
    readonly discount: string | null;
    readonly lineTotal: string;
  }[];
  readonly total: string | null;
  readonly receiptDiscount: string | null;
}

export interface StoryReceipt {
  readonly key: PhotoKey;
  readonly on: LocalDate;
  readonly payment: "cash" | "card";
  /** Итог чека, копейки. */
  readonly totalMinor: number;
  readonly reading: ReadyReading;
  readonly rechecks: readonly ReadyRecheck[];
  /** Код категории каждой позиции по порядку чтения. */
  readonly categories: readonly string[];
}

/** «2026-10-12» → «12.10.2026». */
const printed = (day: LocalDate) => day.split("-").toReversed().join(".");

const line = (
  name: string,
  quantity: string,
  unitPrice: string,
  lineTotal: string,
  unit: string | null = "шт",
): ReadyLine => ({ name, quantity, unit, unitPrice, discount: null, lineTotal });

/** Чек одной позиции из шаблона: день — от «сегодня» (`daysAgo` дней назад). */
interface Template {
  readonly key: PhotoKey;
  readonly daysAgo: number;
  readonly time: string;
  readonly store: string;
  readonly unp: string;
  readonly address: string;
  readonly payment: "cash" | "card";
  readonly cardLast4: string | null;
  readonly uid: string | null;
  readonly items: readonly ReadyLine[];
  readonly total: string;
  readonly totalMinor: number;
  readonly rechecks: readonly ReadyRecheck[];
  readonly categories: readonly string[];
}

// Корона: строки 5 и 9 напечатаны с ошибкой (7,63 → «7,93», 11,25 → «11,52»), итог 132,80 больше суммы строк (131,43) на 1,37.
const koronaLine5 = line("Колбаса варёная 0,512кг", "0,512", "14,90", "7,93", "кг");
const koronaLine9 = line("Печенье овсяное", "3", "3,75", "11,52");
const koronaSame: ReadyRecheck = {
  lines: [
    { line: 5, quantity: "0,512", unitPrice: "14,90", discount: null, lineTotal: "7,93" },
    { line: 9, quantity: "3", unitPrice: "3,75", discount: null, lineTotal: "11,52" },
  ],
  total: "132,80",
  receiptDiscount: null,
};

const TEMPLATES: readonly Template[] = [
  {
    key: "evroopt",
    daysAgo: 9,
    time: "14:32:10",
    store: "Евроопт",
    unp: "800013387",
    address: "г. Минск, ул. Притыцкого, 42",
    payment: "card",
    cardLast4: "4821",
    uid: "4F2A9C01B7E3D58A6C0F1E29",
    total: "47,30",
    totalMinor: 4730,
    rechecks: [],
    categories: [
      "groceries",
      "groceries",
      "groceries",
      "groceries",
      "groceries",
      "groceries",
      "groceries",
      "groceries",
      "household",
      "beauty",
    ],
    items: [
      line("Молоко 3,2% 1л", "2", "2,49", "4,98"),
      line("Хлеб ржаной", "1", "1,85", "1,85"),
      line("Бананы", "1,236", "4,29", "5,30", "кг"),
      line("Сыр 200г", "1", "6,79", "6,79"),
      line("Яйца С1 10шт", "1", "3,89", "3,89"),
      line("Куриное филе", "0,842", "12,99", "10,94", "кг"),
      line("Йогурт питьевой", "3", "1,19", "3,57"),
      line("Яблоки", "0,803", "2,79", "2,24", "кг"),
      line("Средство для посуды", "1", "3,49", "3,49"),
      line("Зубная паста", "1", "4,25", "4,25"),
    ],
  },
  {
    key: "gippo",
    daysAgo: 3,
    time: "19:05:41",
    store: "Гиппо",
    unp: "190325467",
    address: "г. Минск, пр-т Независимости, 18",
    payment: "card",
    cardLast4: "4821",
    uid: null,
    total: "34,45",
    totalMinor: 3445,
    // Строка 2 прочитана как 8,47 — валидатор находит 3 × 2,49 ≠ 8,47; перепроверка читает 7,47.
    rechecks: [
      {
        lines: [{ line: 2, quantity: "3", unitPrice: "2,49", discount: null, lineTotal: "7,47" }],
        total: null,
        receiptDiscount: null,
      },
    ],
    categories: ["groceries", "groceries", "groceries", "groceries", "beauty", "household"],
    items: [
      line("Кофе молотый 250г", "1", "9,89", "9,89"),
      line("Сок яблочный 1л", "3", "2,49", "8,47"),
      line("Макароны 500г", "2", "1,65", "3,30"),
      line("Масло сливочное 82,5%", "1", "4,59", "4,59"),
      line("Шампунь 400мл", "1", "8,95", "8,95"),
      line("Пакет", "1", "0,25", "0,25"),
    ],
  },
  {
    key: "korona",
    daysAgo: 2,
    time: "12:47:03",
    store: "Корона",
    unp: "100123456",
    address: "г. Минск, ул. Петра Мстиславца, 11",
    payment: "card",
    cardLast4: "0937",
    uid: null,
    total: "132,80",
    totalMinor: 13_280,
    rechecks: [koronaSame, koronaSame],
    categories: [
      "groceries",
      "groceries",
      "groceries",
      "groceries",
      "groceries",
      "groceries",
      "groceries",
      "groceries",
      "groceries",
      "household",
      "household",
      "beauty",
    ],
    items: [
      line("Хлеб бородинский", "1", "2,05", "2,05"),
      line("Молоко 2,5% 1л", "2", "2,59", "5,18"),
      line("Сметана 20%", "1", "3,29", "3,29"),
      line("Творог 5%", "2", "3,15", "6,30"),
      koronaLine5,
      line("Сыр Российский", "0,386", "18,50", "7,14", "кг"),
      line("Кофе растворимый", "1", "24,90", "24,90"),
      line("Чай чёрный", "2", "4,20", "8,40"),
      koronaLine9,
      line("Средство для стирки", "1", "22,40", "22,40"),
      line("Мыло туалетное", "4", "1,30", "5,20"),
      line("Шампунь 2 шт", "2", "13,56", "27,12"),
    ],
  },
  {
    key: "belfarmaciya",
    daysAgo: 6,
    time: "10:15:22",
    store: "Аптека Белфармация №15",
    unp: "100098765",
    address: "г. Минск, ул. Сурганова, 31",
    payment: "cash",
    cardLast4: null,
    uid: null,
    total: "23,45",
    totalMinor: 2345,
    rechecks: [],
    categories: ["health", "health", "health"],
    items: [
      line("Витамин C 500мг", "1", "8,95", "8,95"),
      line("Пластырь бактерицидный", "1", "3,50", "3,50"),
      line("Капли для носа", "1", "11,00", "11,00"),
    ],
  },
  {
    key: "elektrosila",
    daysAgo: 170,
    time: "16:20:48",
    store: "Электросила",
    unp: "190468231",
    address: "г. Минск, ул. Ленина, 5",
    payment: "card",
    cardLast4: "4821",
    uid: null,
    total: "389,00",
    totalMinor: 38_900,
    rechecks: [],
    categories: ["electronics"],
    items: [line("Пылесос беспроводной", "1", "389,00", "389,00")],
  },
];

/** Чеки демо на день `today`. */
export function receiptsFor(today: LocalDate): readonly StoryReceipt[] {
  return TEMPLATES.map((template) => {
    const on = LocalDate.addDays(today, -template.daysAgo);
    return {
      key: template.key,
      on,
      payment: template.payment,
      totalMinor: template.totalMinor,
      rechecks: template.rechecks,
      categories: template.categories,
      reading: {
        store: template.store,
        unp: template.unp,
        address: template.address,
        date: printed(on),
        time: template.time,
        currency: "BYN",
        items: template.items,
        receiptDiscount: null,
        total: template.total,
        payment: template.payment,
        cardLast4: template.cardLast4,
        uid: template.uid,
      },
    };
  });
}

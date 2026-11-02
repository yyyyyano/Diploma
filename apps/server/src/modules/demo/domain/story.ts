// История демо-пользователя (DEMO-01, DEMO-02, design/demo-data.md): 6 месяцев правдоподобных операций с белорусскими
// контрагентами, счета с остатками, чеки, цели — всё считается от «сегодня» и зерна, без БД, времени и модели. Чистая
// функция: одинаковые зерно и день дают одну и ту же историю (тест), поэтому «Пересоздать демо-данные» воспроизводимо и не
// тратит лимиты. Исходные описания операций — как в банковских выписках; контрагента и его ключ добавляет сценарий записи
// через справочник `merchants`, категории заданы здесь явно (модель категоризации не нужна, P1).
import { LocalDate } from "@kosht/kernel";
import { dayIn, monthsBetween, shiftMonths } from "./dates.ts";
import { between, pick, rng } from "./rng.ts";
import { receiptsFor, type StoryReceipt } from "./receipts.ts";

export type { PhotoKey, StoryReceipt } from "./receipts.ts";

export const DEMO_SEED = 20_261_021;
/** Курс USD → BYN демо: фиксированный (курс НБРБ из сети — не нужен, генерация офлайн). */
export const DEMO_USD_RATE = 2.9871;

export type AccountKey = "main" | "prior" | "savings" | "alfa" | "cash";
export type Currency = "BYN" | "USD";

export interface StoryAccount {
  readonly key: Exclude<AccountKey, "cash">;
  readonly kind: "card" | "savings";
  readonly name: string | null;
  readonly bank: string;
  readonly mask: string;
  readonly currency: Currency;
  /** Остаток на сегодня (копейки валюты счёта): начальный остаток подбирается так, чтобы итог сошёлся. */
  readonly target: number;
}

export const STORY_ACCOUNTS: readonly StoryAccount[] = [
  {
    key: "main",
    kind: "card",
    name: null,
    bank: "Беларусбанк",
    mask: "4821",
    currency: "BYN",
    target: 128_437,
  },
  {
    key: "prior",
    kind: "card",
    name: null,
    bank: "Приорбанк",
    mask: "0937",
    currency: "BYN",
    target: 41_290,
  },
  {
    key: "savings",
    kind: "savings",
    name: "Отпуск",
    bank: "Беларусбанк",
    mask: "5530",
    currency: "BYN",
    target: 215_000,
  },
  {
    key: "alfa",
    kind: "card",
    name: null,
    bank: "Альфа-Банк",
    mask: "2208",
    currency: "USD",
    target: 32_000,
  },
];
/** Остаток «Наличных» на сегодня. */
export const CASH_TARGET = 18_650;

export interface StoryOp {
  /** Ключ внутри истории: связи (возврат, пара перевода) ссылаются на него. */
  readonly key: string;
  readonly account: AccountKey;
  readonly type: "expense" | "income" | "transfer" | "refund";
  readonly direction: "in" | "out";
  readonly on: LocalDate;
  /** Сумма в валюте счёта, копейки, положительная. */
  readonly minor: number;
  readonly currency: Currency;
  /** Эквивалент в BYN по курсу демо. */
  readonly bynMinor: number;
  /** Описание как в выписке. */
  readonly description: string;
  /** Код встроенной категории; у перевода — нет. */
  readonly category: string | null;
  /** Снятие наличных: встречная операция на «Наличные». */
  readonly cashCounterpart?: boolean;
  /** Возврат: ключ покупки. */
  readonly refundOf?: string;
  /** Вторая сторона перевода между своими счетами: ключ первой. */
  readonly pairOf?: string;
}

export interface StoryGoal {
  readonly name: string;
  readonly kind: "account" | "piggy";
  readonly targetMinor: number;
  readonly deadline: LocalDate;
  /** Копилка: взносы, копейки (со днём «сегодня» — взнос нельзя датировать задним числом). */
  readonly contributions: readonly number[];
}

export interface StoryChild {
  readonly name: string;
  readonly birthDate: LocalDate;
}

export interface Story {
  readonly today: LocalDate;
  readonly start: LocalDate;
  readonly ops: readonly StoryOp[];
  /** Начальные остатки счетов: цель минус всё, что движется по счёту в истории. */
  readonly openings: Readonly<Record<AccountKey, number>>;
  readonly receipts: readonly StoryReceipt[];
  readonly goals: readonly StoryGoal[];
  readonly children: readonly StoryChild[];
}

const byn = (minor: number) => minor;
const toByn = (minor: number, currency: Currency) =>
  currency === "BYN" ? minor : Math.round(minor * DEMO_USD_RATE);

interface Draft extends Omit<StoryOp, "key" | "bynMinor" | "currency"> {
  readonly currency?: Currency;
}

/** Постоянные платежи и поступления месяца: число месяца, сумма и откуда. */
interface Fixed {
  readonly day: number;
  readonly draft: (random: () => number) => Draft;
  /** Платёж есть только в днях, не старше столько дней от сегодня. */
  readonly youngerThan?: number;
  /** Платёж перестал приходить: есть только в днях, старше столько дней от сегодня. */
  readonly olderThan?: number;
}

const expense = (
  account: AccountKey,
  minor: number,
  description: string,
  category: string,
  on: LocalDate,
): Draft => ({ account, type: "expense", direction: "out", on, minor, description, category });

export function buildStory(input: { readonly today: LocalDate; readonly seed?: number }): Story {
  const { today } = input;
  const random = rng(input.seed ?? DEMO_SEED);
  const start = LocalDate.addDays(shiftMonths(today, -6), 1);
  const drafts: Draft[] = [];
  let counter = 0;
  const keyOf = () => `op-${String((counter += 1)).padStart(4, "0")}`;
  const keys = new Map<Draft, string>();
  const add = (draft: Draft): Draft => {
    keys.set(draft, keyOf());
    drafts.push(draft);
    return draft;
  };

  // 1. Постоянные платежи и поступления (design/demo-data.md, «Регулярные платежи»).
  const placeholder = LocalDate.parse("2000-01-01");
  const fixed: readonly Fixed[] = [
    {
      day: 25,
      draft: () => ({
        account: "main",
        type: "income",
        direction: "in",
        on: placeholder,
        minor: 144_000,
        description: "ООО «ТехноСофт» зарплата",
        category: "salary",
      }),
    },
    {
      day: 10,
      draft: () => ({
        account: "main",
        type: "income",
        direction: "in",
        on: placeholder,
        minor: 96_000,
        description: "ООО «ТехноСофт» аванс",
        category: "salary",
      }),
    },
    {
      day: 23,
      draft: () => expense("main", 41_000, "Беларусбанк кредит погашение", "loans", placeholder),
    },
    {
      day: 14,
      draft: (r) =>
        expense("main", between(r, 17_200, 20_100), "ERIP RASCHET ZHKU", "utilities", placeholder),
    },
    {
      day: 22,
      draft: () => expense("main", 3290, "Белтелеком интернет и ТВ", "telecom", placeholder),
    },
    { day: 2, draft: () => expense("main", 1000, "А1 пополнение", "telecom", placeholder) },
    { day: 1, draft: () => expense("main", 1599, "Яндекс Плюс", "subscriptions", placeholder) },
    { day: 5, draft: () => expense("prior", 1299, "VK Музыка", "subscriptions", placeholder) },
    { day: 14, draft: () => expense("prior", 949, "iCloud+", "subscriptions", placeholder) },
    {
      day: 9,
      youngerThan: 100,
      draft: () => expense("main", 6000, "Кружок робототехники", "kids", placeholder),
    },
    // Фитнес-клуб: был ежемесячно и перестал приходить — «возможно прекращён».
    {
      day: 12,
      olderThan: 45,
      draft: () => expense("main", 5500, "Фитнес-клуб Атлетик", "leisure", placeholder),
    },
    {
      day: 1,
      draft: () => ({
        account: "prior",
        type: "income",
        direction: "in",
        on: placeholder,
        minor: 1240,
        description: "Кешбэк",
        category: "interest",
      }),
    },
    {
      day: 17,
      draft: () => ({
        account: "main",
        type: "transfer",
        direction: "out",
        on: placeholder,
        minor: 12_000,
        description: "Перевод на «Отпуск»",
        category: null,
      }),
    },
    {
      day: 12,
      draft: () => ({
        account: "main",
        type: "transfer",
        direction: "out",
        on: placeholder,
        minor: 10_000,
        description: "BELARUSBANK ATM 0042",
        category: null,
        cashCounterpart: true,
      }),
    },
  ];
  for (const [year, month] of monthsBetween(start, today)) {
    for (const item of fixed) {
      const on = dayIn(year, month, item.day);
      if (on < start || on > today) continue;
      const age = LocalDate.daysBetween(on, today);
      if (item.youngerThan !== undefined && age > item.youngerThan) continue;
      if (item.olderThan !== undefined && age <= item.olderThan) continue;
      const draft = { ...item.draft(random), on };
      const added = add(draft);
      if (draft.type === "transfer" && draft.cashCounterpart !== true) {
        add({
          account: "savings",
          type: "transfer",
          direction: "in",
          on,
          minor: draft.minor,
          description: draft.description,
          category: null,
          pairOf: keys.get(added) ?? "",
        });
      }
    }
    // Покупка в Steam в долларах: счёт Альфа-Банка в валюте (валютные операции).
    const steam = dayIn(year, month, 5);
    if (steam >= start && steam <= today) {
      add({ ...expense("alfa", 999, "STEAM PURCHASE", "leisure", steam), currency: "USD" });
    }
  }

  // 2. Повседневные траты: по дню и категории — по зерну.
  const groceries = [
    "EVROOPT T-0042 MINSK",
    "GIPPO HIPERMARKET MINSK",
    "KORONA ZAMOK",
    "GREEN STORE MINSK",
    "SOSEDI MINSK",
  ];
  const taxi = ["YANDEX.GO TAXI", "TAXI 7788 MINSK"];
  const cafes = [
    "Ресторан «Васильки»",
    "Пицца Темпо доставка",
    "Кофейня Зерно",
    "Додо Пицца Минск",
  ];
  const fuel = ["АЗС Белоруснефть №58", "АЗС Белоруснефть №12"];
  const pharmacies = ["Аптека Белфармация №15", "Аптека Планета Здоровья"];
  const accountOf = (): AccountKey => (random() < 0.8 ? "main" : "prior");
  const monthStart = LocalDate.parse(`${today.slice(0, 7)}-01`);
  for (let day = start; day <= today; day = LocalDate.addDays(day, 1)) {
    if (random() < 0.33)
      add(
        expense(
          accountOf(),
          between(random, 1500, 9500),
          pick(random, groceries),
          "groceries",
          day,
        ),
      );
    if (random() < 0.33)
      add(expense(accountOf(), between(random, 600, 1300), pick(random, taxi), "taxi", day));
    if (random() < 0.16)
      add(expense(accountOf(), between(random, 1200, 6000), pick(random, cafes), "cafes", day));
    if (LocalDate.daysBetween(start, day) % 14 === 6)
      add(expense("main", between(random, 6000, 7500), pick(random, fuel), "car", day));
    if (random() < 0.07)
      add(
        expense(accountOf(), between(random, 1500, 3500), pick(random, pharmacies), "health", day),
      );
    if (random() < 0.03)
      add(expense("prior", between(random, 4000, 12_000), "Wildberries", "clothes", day));
    if (random() < 0.04)
      add(expense("main", between(random, 1500, 2500), "Кинотеатр Октябрь", "leisure", day));
    if (random() < 0.05)
      add(expense("main", between(random, 1500, 4000), "Детский мир", "kids", day));
  }
  // Месяц показа: у каждой категории с лимитами есть траты, как бы рано в месяце ни был день показа.
  const inMonth = (category: string) =>
    drafts.filter((d) => d.category === category && d.on >= monthStart && d.direction === "out")
      .length;
  const forced: [string, number, string[]][] = [
    ["cafes", 3, cafes],
    ["taxi", 3, taxi],
    ["groceries", 3, groceries],
    ["leisure", 1, ["Кинотеатр Октябрь"]],
  ];
  for (const [category, wanted, names] of forced) {
    for (let n = inMonth(category); n < wanted; n++) {
      const on = LocalDate.addDays(today, -Math.min(n, LocalDate.daysBetween(monthStart, today)));
      const minor =
        category === "cafes"
          ? between(random, 2500, 5500)
          : category === "taxi"
            ? between(random, 700, 1200)
            : category === "leisure"
              ? 2000
              : between(random, 2500, 8000);
      add(expense("main", minor, pick(random, names), category, on));
    }
  }

  // 3. Единичные: оплата обучения (вычет), ОСАГО (календарь), покупка техники (гарантия), возврат одежды.
  const at = (back: number) => {
    const day = LocalDate.addDays(today, -back);
    return day < start ? start : day;
  };
  add(expense("main", 200_000, "Оплата обучения БГУ", "education", at(39)));
  add(expense("main", 14_260, "Белгосстрах ОСАГО", "car", at(176)));
  add(expense("main", 38_900, "ЭЛЕКТРОСИЛА", "electronics", at(170)));
  add(expense("main", 4730, "EVROOPT T-0042 MINSK", "groceries", at(8)));
  const purchase = add(expense("prior", 8970, "Mark Formelle", "clothes", at(16)));
  add({
    account: "prior",
    type: "refund",
    direction: "in",
    on: at(11),
    minor: 2490,
    description: "Возврат Mark Formelle",
    category: "clothes",
    refundOf: keys.get(purchase) ?? "",
  });

  // Порядок — по дню, внутри дня — как добавлены (устойчиво); ключи остаются теми же.
  const ops: StoryOp[] = drafts
    .map((draft, order) => ({ draft, order }))
    .toSorted((a, b) => a.draft.on.localeCompare(b.draft.on) || a.order - b.order)
    .map(({ draft }) => {
      const currency = draft.currency ?? (draft.account === "alfa" ? "USD" : "BYN");
      return {
        ...draft,
        currency,
        key: keys.get(draft) ?? "",
        bynMinor: toByn(draft.minor, currency),
      };
    });

  // 4. Начальные остатки: цель минус движение по счёту (в том числе «Наличные» — снятия и чек аптеки).
  const flow: Record<AccountKey, number> = { main: 0, prior: 0, savings: 0, alfa: 0, cash: 0 };
  for (const op of ops) {
    const sign = op.direction === "in" ? 1 : -1;
    flow[op.account] += sign * op.minor;
    if (op.cashCounterpart === true) flow.cash += -sign * op.minor;
  }
  const receipts = receiptsFor(today);
  for (const receipt of receipts) {
    if (receipt.payment === "cash") flow.cash -= receipt.totalMinor;
  }
  const openings = {
    main: STORY_ACCOUNTS[0]!.target - flow.main,
    prior: STORY_ACCOUNTS[1]!.target - flow.prior,
    savings: STORY_ACCOUNTS[2]!.target - flow.savings,
    alfa: STORY_ACCOUNTS[3]!.target - flow.alfa,
    cash: CASH_TARGET - flow.cash,
  };

  return {
    today,
    start,
    ops,
    openings,
    receipts,
    goals: [
      {
        name: "Отпуск летом",
        kind: "account",
        targetMinor: byn(300_000),
        deadline: shiftMonths(today, 7),
        contributions: [],
      },
      {
        name: "Новый ноутбук",
        kind: "piggy",
        targetMinor: byn(180_000),
        deadline: shiftMonths(today, 4),
        contributions: [30_000, 20_000, 14_000],
      },
    ],
    children: [
      { name: "Максим", birthDate: LocalDate.addDays(shiftMonths(today, -17 * 12), -220) },
      { name: "Алиса", birthDate: LocalDate.addDays(shiftMonths(today, -9 * 12), -100) },
    ],
  };
}

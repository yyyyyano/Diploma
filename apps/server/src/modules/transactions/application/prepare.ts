// Подготовка значений операции до транзакции (TXN-03, STMT-09, CAT-03): категория (выбрана человеком или подобрана
// правилами), контрагент (очистка и название) и эквивалент в BYN по курсу НБРБ. Курс — это HTTP, поэтому всё здесь
// работает вне s.transaction; в транзакции остаётся только запись.
import { node } from "@kosht/calc";
import {
  FALLBACK_CATEGORY,
  SYSTEM_CATEGORIES,
  type CategoryRef,
  type CategorySource,
} from "@kosht/contract";
import { LocalDate, Money } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { CategoriesFacade } from "../../categories/index.ts";
import type { FxRatesFacade } from "../../fx-rates/index.ts";
import type { MerchantsFacade } from "../../merchants/index.ts";
import { categoryKindsOf, kindForRules, type TransactionType } from "../domain/transactions.ts";

export interface PrepareDeps {
  readonly categories: Pick<CategoriesFacade, "list" | "byRules">;
  readonly merchants: Pick<MerchantsFacade, "resolve">;
  readonly fxRates: Pick<FxRatesFacade, "convert">;
}

const KIND_OF_SYSTEM = new Map<string, "expense" | "income">(
  SYSTEM_CATEGORIES.map((category) => [category.code, category.kind]),
);

/** Итог подбора категории: что записать и нужна ли модель (правила не покрыли — пока «Прочее» с источником fallback). */
export interface ChosenCategory {
  readonly ref: CategoryRef | null;
  readonly source: CategorySource | null;
  readonly pendingModel: boolean;
}

export interface Merchant {
  readonly name: string | null;
  readonly key: string | null;
  /** Исходный текст, как ввели (идёт в «исходное описание»). */
  readonly text: string | null;
}

export interface BynAmount {
  readonly amountBynMinor: number;
  readonly fxRateId: string | null;
}

export function makePrepare(d: PrepareDeps) {
  /** Вид категории: встроенная — из справочника кода, своя — по списку категорий (чужая или нет — NOT_FOUND). */
  async function kindOf(s: ScopedDb, ref: CategoryRef): Promise<"expense" | "income"> {
    if (ref.type === "system") {
      const kind = KIND_OF_SYSTEM.get(ref.code);
      if (kind === undefined) throw new AppError("NOT_FOUND");
      return kind;
    }
    const found = (await d.categories.list(s)).items.find(
      (item) => item.ref.type === "custom" && item.ref.id === ref.id,
    );
    if (found === undefined) throw new AppError("NOT_FOUND");
    return found.kind;
  }

  /** Категорию выбрал человек (или ассистент по его просьбе): вид должен подходить типу операции. */
  async function chosen(
    s: ScopedDb,
    type: TransactionType,
    ref: CategoryRef,
  ): Promise<ChosenCategory> {
    if (!(await accepts(s, type, ref))) throw new AppError("VALIDATION", { reason: "category" });
    return { ref, source: "user", pendingModel: false };
  }

  /** Подходит ли категория типу операции (при смене типа: оставить прежнюю или подобрать заново). */
  async function accepts(s: ScopedDb, type: TransactionType, ref: CategoryRef): Promise<boolean> {
    return categoryKindsOf(type).includes(await kindOf(s, ref));
  }

  /** Категория не указана: правила — сразу (CAT-03), непокрытое — «Прочее» и модель в фоне (CAT-06). */
  async function byRules(
    s: ScopedDb,
    type: TransactionType,
    text: string | null,
  ): Promise<ChosenCategory> {
    if (type === "transfer") return { ref: null, source: null, pendingModel: false };
    const kind = kindForRules(type);
    const { resolved } = await d.categories.byRules(s, [
      { key: "operation", kind, description: text ?? "" },
    ]);
    const found = resolved[0];
    if (found !== undefined) {
      return { ref: found.category, source: found.source, pendingModel: false };
    }
    return {
      ref: { type: "system", code: FALLBACK_CATEGORY[kind] },
      source: "fallback",
      pendingModel: true,
    };
  }

  /** Контрагент: название из справочника («Евроопт») или как ввели; ключ очистки — для правила CAT-05. */
  async function merchant(text: string | null): Promise<Merchant> {
    if (text === null) return { name: null, key: null, text: null };
    const [info] = await d.merchants.resolve([text]);
    if (info === undefined) return { name: text, key: null, text };
    return {
      name: info.merchantId === null ? text : info.name,
      key: info.key === "" ? null : info.key,
      text,
    };
  }

  /** STMT-09: эквивалент в BYN по курсу на день операции; курса нет — null («курс не получен»). */
  async function inByn(amount: Money, day: string): Promise<BynAmount | null> {
    const converted = await convertCalc(amount, LocalDate.parse(day));
    if (converted === undefined) return null;
    return { amountBynMinor: converted.calc.value.minor, fxRateId: converted.rateId };
  }

  /** Тот же расчёт, что в inByn, целиком — для «Откуда курс?» (трасса) и сверки с записанным курсом. */
  async function convertCalc(amount: Money, day: LocalDate) {
    const converted = await d.fxRates.convert(
      "transactions.amountInByn",
      node("transactions.amount", amount),
      day,
    );
    if (converted === undefined) return undefined;
    return { calc: converted.calc, rateId: converted.rate?.id ?? null };
  }

  return { kindOf, accepts, chosen, byRules, merchant, inByn, convertCalc };
}

export type Prepare = ReturnType<typeof makePrepare>;

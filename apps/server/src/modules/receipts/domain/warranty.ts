// RCPT-13: позиция с гарантией — техника, электроника, бытовые приборы: по категории «Электроника» и по наименованию.
// Срок гарантии и событие «конец гарантии» считает календарь (CAL-04); здесь — только признак.
const APPLIANCE =
  /(холодильник|морозильник|стиральн|посудомоечн|телевизор|пылесос|чайник|микроволнов|мультиварк|блендер|миксер|кофемашин|кофеварк|утюг|тостер|кондиционер|обогревател|вентилятор|смартфон|телефон|планшет|ноутбук|наушник|колонк|монитор|принтер|роутер|электробритв|фен\b)/iu;

/** Есть ли у позиции гарантия: категория «Электроника» (`electronics`) или наименование бытового прибора. */
export function hasWarranty(categoryCode: string | null, name: string): boolean {
  return categoryCode === "electronics" || APPLIANCE.test(name);
}

/** Позиция чека с гарантией для календаря (CAL-04): что куплено, где и когда. */
export interface WarrantyItem {
  readonly itemId: string;
  readonly receiptId: string;
  readonly name: string;
  readonly store: string | null;
  readonly purchasedOn: string | null;
}

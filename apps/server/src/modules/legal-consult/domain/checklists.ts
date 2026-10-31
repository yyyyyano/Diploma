// Шаблоны чек-листов документов (LEGAL-12, LEGAL-10, TAX-06): шаги, документы, инстанции, сроки и ссылки на нормы — заранее
// составленное содержание, а не текст модели. Тексты — словарь `legal` (`checklists.<id>.items.<item>`), здесь — структура и источники.
// Каждая ссылка на норму — в формате точного обращения legal-base («п. 3 ст. 210 НК») и, где норма есть в сохранённой странице pravo.by,
// с `evidence` — словами нормы, на которых держится пункт: тест находит норму точным обращением и сверяет эти слова с её текстом.
// Нормы вне сохранённых страниц помечены `unsaved`: их содержание — из SPEC §9.1 (проверено по pravo.by 2026-10-12), а не из текста,
// лежащего в базе; когда страницу сохранят, пометку снимает тест (UNSAVED_REFS ниже).
import { CHECKLIST_IDS, type CHECKLIST_INSTANCES, type ChecklistId } from "@kosht/contract";

export { CHECKLIST_IDS, type ChecklistId };

/** Инстанции (LEGAL-12): к кому идти; подпись — словарь `legal:instance.*`. */
export type Instance = (typeof CHECKLIST_INSTANCES)[number];

export interface NormRef {
  /** Обращение в формате поиска: «п. 3 ст. 210 НК». */
  readonly ref: string;
  /** ID акта на pravo.by — ссылка в шаблоне. */
  readonly pravoId: string;
  /** Слова нормы, на которых держится пункт (сверяются с текстом по точному обращению). Нет — только при `unsaved`. */
  readonly evidence?: string;
  /** Нормы нет в сохранённых страницах pravo.by: содержание из SPEC §9.1, сверить при загрузке полного текста. */
  readonly unsaved?: true;
}

export interface ChecklistItem {
  readonly id: string;
  /** `step` — действие, `document` — что собрать, `note` — что знать (галочки нет). */
  readonly kind: "step" | "document" | "note";
  readonly instance?: Instance;
  /** Есть срок: подпись — `checklists.<id>.deadlines.<item>`. */
  readonly deadline?: true;
  readonly norm?: NormRef;
  /** Акт, названный ссылкой без текста (ПСМ № 778): LEGAL-06. */
  readonly act?: string;
}

export interface ChecklistTemplate {
  readonly id: ChecklistId;
  readonly items: readonly ChecklistItem[];
}

const NK = "Hk0900071";
const ZOZPP = "H10200090";
const nk = (ref: string, evidence: string): NormRef => ({ ref, pravoId: NK, evidence });
const nkUnsaved = (ref: string): NormRef => ({ ref, pravoId: NK, unsaved: true });
const zozpp = (ref: string, evidence: string): NormRef => ({ ref, pravoId: ZOZPP, evidence });

/** Нормы, которых нет в сохранённых страницах pravo.by (30.10.2026): ст. 211, 222, 223 НК. Другим пометку ставить нельзя. */
export const UNSAVED_REFS = ["ст. 211 НК", "ст. 222 НК", "ст. 223 НК"] as const;

export const CHECKLISTS: readonly ChecklistTemplate[] = [
  {
    id: "deduction-education",
    items: [
      {
        id: "way",
        kind: "step",
        instance: "employer",
        norm: nk("п. 2 ст. 210 НК", "в течение налогового периода – налоговым агентом"),
      },
      {
        id: "certificate",
        kind: "document",
        instance: "education",
        norm: nk(
          "п. 3 ст. 210 НК",
          "первое высшее, первое среднее специальное или первое профессионально-техническое образование",
        ),
      },
      {
        id: "contract",
        kind: "document",
        instance: "education",
        norm: nk(
          "п. 3 ст. 210 НК",
          "договора о подготовке специалиста (рабочего, служащего) на платной основе",
        ),
      },
      {
        id: "price-order",
        kind: "document",
        instance: "education",
        norm: nk(
          "п. 3 ст. 210 НК",
          "о стоимости обучения (ее изменении) за соответствующий период",
        ),
      },
      {
        id: "relatives",
        kind: "document",
        norm: nk("п. 3 ст. 210 НК", "документов, подтверждающих степень близкого родства"),
      },
      {
        id: "payment",
        kind: "document",
        norm: nk("п. 5 ст. 210 НК", "сумме и дате"),
      },
      {
        id: "loan",
        kind: "document",
        norm: nk("п. 3 ст. 210 НК", "копии кредитного договора"),
      },
      {
        id: "income-proof",
        kind: "document",
        instance: "tax-office",
        norm: nk(
          "п. 3 ст. 210 НК",
          "справки о доходах, исчисленных и удержанных суммах подоходного налога",
        ),
      },
      {
        id: "copies",
        kind: "step",
        norm: nk("п. 6 ст. 210 НК", "сверяются с их оригиналами"),
      },
      {
        id: "declaration",
        kind: "step",
        instance: "tax-office",
        deadline: true,
        norm: nkUnsaved("ст. 222 НК"),
      },
      {
        id: "carry-over",
        kind: "note",
        norm: nk(
          "п. 7 ст. 210 НК",
          "переносятся на последующие налоговые периоды до полного их использования",
        ),
      },
      { id: "refund-term", kind: "note", norm: nkUnsaved("ст. 223 НК") },
    ],
  },
  {
    id: "deduction-housing",
    items: [
      { id: "queue", kind: "step", instance: "executive-committee", norm: nkUnsaved("ст. 211 НК") },
      { id: "expenses", kind: "step", norm: nkUnsaved("ст. 211 НК") },
      { id: "one-home", kind: "note", norm: nkUnsaved("ст. 211 НК") },
      { id: "subsidy", kind: "note", norm: nkUnsaved("ст. 211 НК") },
      { id: "way", kind: "step", instance: "employer", norm: nkUnsaved("ст. 211 НК") },
      { id: "documents", kind: "document", norm: nkUnsaved("ст. 211 НК") },
      { id: "carry-over", kind: "note", norm: nkUnsaved("ст. 211 НК") },
    ],
  },
  {
    id: "deduction-standard",
    items: [
      {
        id: "way",
        kind: "step",
        instance: "employer",
        norm: nk(
          "п. 2 ст. 209 НК",
          "налоговым агентом, являющимся для него местом основной работы",
        ),
      },
      {
        id: "no-main-job",
        kind: "step",
        instance: "tax-office",
        norm: nk(
          "п. 2 ст. 209 НК",
          "по выбору плательщика только одним налоговым агентом либо налоговым органом",
        ),
      },
      {
        id: "child-docs",
        kind: "document",
        instance: "employer",
        norm: nk("п. 3 ст. 209 НК", "копии свидетельства о рождении ребенка (детей)"),
      },
      {
        id: "student-certificate",
        kind: "document",
        instance: "education",
        norm: nk("п. 3 ст. 209 НК", "лицо старше восемнадцати лет является (являлось) обучающимся"),
      },
      {
        id: "care-leave",
        kind: "document",
        norm: nk(
          "п. 3 ст. 209 НК",
          "справки о нахождении физического лица в отпуске по уходу за ребенком в возрасте до трех лет",
        ),
      },
      {
        id: "disabled-id",
        kind: "document",
        norm: nk(
          "п. 3 ст. 209 НК",
          "копии удостоверения инвалида – для родителей ребенка-инвалида",
        ),
      },
      {
        id: "adoption-guardian",
        kind: "document",
        instance: "guardianship",
        norm: nk(
          "п. 3 ст. 209 НК",
          "копии выписки из решения органов опеки и попечительства – для опекунов и попечителей",
        ),
      },
      {
        id: "single-parent",
        kind: "document",
        instance: "registry-office",
        norm: nk(
          "п. 3 ст. 209 НК",
          "справки, выдаваемой органом, регистрирующим акты гражданского состояния",
        ),
      },
      {
        id: "other-categories",
        kind: "step",
        norm: nk(
          "п. 4 ст. 209 НК",
          "удостоверения пострадавшего от катастрофы на Чернобыльской АЭС",
        ),
      },
      {
        id: "once",
        kind: "note",
        norm: nk(
          "п. 5 ст. 209 НК",
          "повторно этому налоговому агенту или налоговому органу не представляются",
        ),
      },
    ],
  },
  {
    id: "return-good-quality",
    items: [
      {
        id: "term",
        kind: "step",
        instance: "seller",
        deadline: true,
        norm: zozpp(
          "п. 1 ст. 28 ЗоЗПП",
          "в течение четырнадцати дней с момента передачи ему непродовольственного товара",
        ),
      },
      {
        id: "list",
        kind: "step",
        act: "C20200778",
        norm: zozpp(
          "п. 3 ст. 28 ЗоЗПП",
          "не подлежащих обмену и возврату, утверждается Правительством",
        ),
      },
      {
        id: "food",
        kind: "note",
        norm: zozpp(
          "п. 5 ст. 28 ЗоЗПП",
          "Пищевые продукты надлежащего качества обмену и возврату не подлежат",
        ),
      },
      {
        id: "condition",
        kind: "step",
        norm: zozpp(
          "п. 2 ст. 28 ЗоЗПП",
          "товар не был в употреблении, сохранены его потребительские свойства",
        ),
      },
      {
        id: "proof",
        kind: "document",
        norm: zozpp(
          "п. 2 ст. 28 ЗоЗПП",
          "имеются доказательства приобретения его у данного продавца",
        ),
      },
      {
        id: "go-seller",
        kind: "step",
        instance: "seller",
        norm: zozpp(
          "п. 1 ст. 28 ЗоЗПП",
          "произведя в случае разницы в цене необходимый перерасчет с продавцом",
        ),
      },
      {
        id: "refund",
        kind: "note",
        instance: "seller",
        deadline: true,
        norm: zozpp(
          "п. 4 ст. 28 ЗоЗПП",
          "максимальный срок для удовлетворения требования не может превышать семи дней",
        ),
      },
      {
        id: "refund-form",
        kind: "note",
        norm: zozpp("п. 4 ст. 28 ЗоЗПП", "в той же форме, в которой производилась оплата товара"),
      },
    ],
  },
  {
    id: "claim-defective",
    items: [
      {
        id: "choose",
        kind: "step",
        norm: zozpp(
          "п. 1.1 ст. 20 ЗоЗПП",
          "замены недоброкачественного товара товаром надлежащего качества",
        ),
      },
      {
        id: "unfixable",
        kind: "note",
        norm: zozpp("п. 2 ст. 20 ЗоЗПП", "пищевые продукты, товары бытовой химии"),
      },
      {
        id: "to-whom",
        kind: "step",
        instance: "seller",
        norm: zozpp("п. 4 ст. 20 ЗоЗПП", "предъявляются потребителем продавцу"),
      },
      {
        id: "manufacturer",
        kind: "step",
        instance: "manufacturer",
        norm: zozpp("п. 5 ст. 20 ЗоЗПП", "потребитель вправе предъявить требования"),
      },
      {
        id: "complex-goods",
        kind: "note",
        deadline: true,
        norm: zozpp(
          "п. 7 ст. 20 ЗоЗПП",
          "в течение тридцати дней со дня передачи товара продавцом потребителю",
        ),
      },
      {
        id: "no-receipt",
        kind: "note",
        norm: zozpp(
          "п. 10 ст. 20 ЗоЗПП",
          "не является основанием для отказа в удовлетворении его требований",
        ),
      },
      {
        id: "quality-check",
        kind: "step",
        instance: "seller",
        norm: zozpp("п. 11 ст. 20 ЗоЗПП", "обязан провести экспертизу товара за свой счет"),
      },
      {
        id: "handover-act",
        kind: "document",
        instance: "seller",
        norm: zozpp("п. 14 ст. 20 ЗоЗПП", "составляется акт передачи товара по форме"),
      },
      {
        id: "repair-term",
        kind: "note",
        deadline: true,
        norm: zozpp(
          "п. 1 ст. 22 ЗоЗПП",
          "не может превышать четырнадцати дней со дня предъявления потребителем требования",
        ),
      },
      {
        id: "replace-term",
        kind: "note",
        deadline: true,
        norm: zozpp(
          "п. 1 ст. 23 ЗоЗПП",
          "в течение четырнадцати дней со дня предъявления указанного требования",
        ),
      },
      {
        id: "money-term",
        kind: "note",
        deadline: true,
        norm: zozpp("п. 1 ст. 25 ЗоЗПП", "не может превышать семи дней со дня предъявления"),
      },
      {
        id: "penalty",
        kind: "note",
        norm: zozpp("п. 1 ст. 26 ЗоЗПП", "неустойку в размере одного процента цены товара"),
      },
    ],
  },
  {
    id: "warranty",
    items: [
      {
        id: "when",
        kind: "note",
        norm: zozpp("п. 1 ст. 21 ЗоЗПП", "в течение гарантийного срока или срока годности товара"),
      },
      {
        id: "two-years",
        kind: "note",
        norm: zozpp(
          "п. 1 ст. 21 ЗоЗПП",
          "в течение двух лет со дня передачи таких товаров продавцом потребителю",
        ),
      },
      {
        id: "start",
        kind: "note",
        norm: zozpp(
          "п. 2 ст. 21 ЗоЗПП",
          "исчисляется с момента передачи товара продавцом потребителю",
        ),
      },
      {
        id: "proof",
        kind: "document",
        norm: zozpp(
          "п. 10 ст. 20 ЗоЗПП",
          "документы и другие средства доказывания, указывающие на приобретение товара у этого продавца",
        ),
      },
      {
        id: "claim",
        kind: "step",
        instance: "seller",
        norm: zozpp(
          "п. 1 ст. 21 ЗоЗПП",
          "предусмотренные статьей 20 настоящего Закона требования продавцу",
        ),
      },
      {
        id: "burden",
        kind: "note",
        norm: zozpp("п. 12 ст. 20 ЗоЗПП", "отвечает за недостатки товара, если не докажет"),
      },
      {
        id: "loaner",
        kind: "note",
        deadline: true,
        norm: zozpp("п. 2 ст. 22 ЗоЗПП", "в трехдневный срок со дня его предъявления"),
      },
    ],
  },
];

const BY_ID = new Map(CHECKLISTS.map((c) => [c.id, c]));

export function checklistById(id: string): ChecklistTemplate | undefined {
  return BY_ID.get(id as ChecklistId);
}

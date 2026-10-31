// Чек-листы документов (LEGAL-12, LEGAL-10, TAX-06): готовые шаблоны, а не текст модели; состояние галочек — у домохозяйства (CHAT-04:
// «чек-лист документов с галочками, состояние сохраняется»). Тексты шагов приходят готовыми из словаря сервера; ссылки — на pravo.by.
// К чему относится чек-лист: сам по себе, сообщение чата или найденный вычет (SPEC §5 «Состояние чек-листа»).
import { oc } from "@orpc/contract";
import { z } from "zod";
import { pickErrors } from "../errors.ts";

/** Набор MVP (LEGAL-12): вычеты на обучение, на жильё, стандартные по ст. 209; возврат товара надлежащего и ненадлежащего качества; гарантия. */
export const CHECKLIST_IDS = [
  "deduction-education",
  "deduction-housing",
  "deduction-standard",
  "return-good-quality",
  "claim-defective",
  "warranty",
] as const;
export const ChecklistId = z.enum(CHECKLIST_IDS);
export type ChecklistId = z.infer<typeof ChecklistId>;

export const CHECKLIST_INSTANCES = [
  "employer",
  "tax-office",
  "executive-committee",
  "education",
  "seller",
  "manufacturer",
  "registry-office",
  "guardianship",
] as const;

/** К чему относится чек-лист: у каждого сообщения и вычета своё состояние галочек. */
export const ChecklistSubject = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("general") }),
  z.strictObject({ kind: z.literal("message"), id: z.uuid() }),
  z.strictObject({ kind: z.literal("deduction"), id: z.uuid() }),
]);
export type ChecklistSubject = z.infer<typeof ChecklistSubject>;

export const ChecklistSummary = z.strictObject({
  id: ChecklistId,
  title: z.string().max(200),
  summary: z.string().max(600),
});
export type ChecklistSummary = z.infer<typeof ChecklistSummary>;

export const ChecklistItem = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,40}$/u),
  /** `step` — действие, `document` — что собрать, `note` — что знать: у заметки галочки нет (`checked: null`). */
  kind: z.enum(["step", "document", "note"]),
  text: z.string().max(1200),
  /** К кому идти: «Наниматель», «Налоговая (ИМНС)», «Продавец»… */
  instance: z
    .strictObject({ id: z.enum(CHECKLIST_INSTANCES), label: z.string().max(100) })
    .nullable(),
  /** Срок словами, если он есть. */
  deadline: z.string().max(300).nullable(),
  /** Норма, на которой держится пункт: «п. 3 ст. 210 НК» и ссылка на pravo.by; `unsaved` — текста нормы в базе нет, сверьте по ссылке. */
  norm: z.strictObject({ ref: z.string().max(100), url: z.url(), unsaved: z.boolean() }).nullable(),
  /** Акт без текста в базе, названный ссылкой (LEGAL-06). */
  act: z.strictObject({ url: z.url() }).nullable(),
  checked: z.boolean().nullable(),
});
export type ChecklistItem = z.infer<typeof ChecklistItem>;

export const ChecklistView = z.strictObject({
  id: ChecklistId,
  title: z.string().max(200),
  summary: z.string().max(600),
  items: z.array(ChecklistItem).max(40),
  /** Отмечено пунктов из тех, что можно отметить. */
  done: z.int().min(0),
  total: z.int().min(0),
});
export type ChecklistView = z.infer<typeof ChecklistView>;

export const legalConsultContract = {
  /** Набор чек-листов: название и описание. */
  checklists: oc
    .route({ method: "GET", path: "/legal-consult/checklists" })
    .output(z.strictObject({ items: z.array(ChecklistSummary).max(20) }))
    .errors(pickErrors("UNAUTHORIZED")),
  /** Чек-лист с галочками своего домохозяйства для этого `subject`. */
  checklist: oc
    .route({ method: "POST", path: "/legal-consult/checklist" })
    .input(
      z.strictObject({ id: ChecklistId, subject: ChecklistSubject.default({ kind: "general" }) }),
    )
    .output(ChecklistView)
    .errors(pickErrors("UNAUTHORIZED")),
  /** Отметить или снять пункт; повтор того же действия ничего не меняет. Возвращает чек-лист целиком. */
  setChecked: oc
    .route({ method: "POST", path: "/legal-consult/checklist/check" })
    .input(
      z.strictObject({
        id: ChecklistId,
        subject: ChecklistSubject.default({ kind: "general" }),
        item: z.string().regex(/^[a-z][a-z0-9-]{0,40}$/u),
        done: z.boolean(),
      }),
    )
    .output(ChecklistView)
    .errors(pickErrors("UNAUTHORIZED", "VALIDATION")),
};

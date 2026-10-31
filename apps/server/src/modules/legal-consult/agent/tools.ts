// Инструменты агента legal-consult (AGT-03 «legal», ADR-0009): готовый чек-лист документов по id шаблона. Описание — по-английски и
// коротко (префикс набора ≤ 3 000 токенов). Текст чек-листа модель не пишет и не пересказывает цифрами: берёт готовый, а числа и сроки — из
// шаблона (LEGAL-12). Данных пользователя в инструменте нет.
import { ChecklistId } from "@kosht/contract";
import { z } from "zod";
import { defineTool } from "../../../platform/tools/define-tool.ts";
import type { Checklists } from "../application/checklists.ts";

export function legalConsultTools(checklists: Checklists) {
  return {
    checklist: defineTool({
      name: "get_checklist",
      toolset: "legal",
      kind: "read",
      description:
        "Get a ready document checklist (steps, documents, who to go to, deadlines, norms): education, housing or standard tax deduction, return of good-quality goods, claim for defective goods, warranty.",
      input: z.object({ id: ChecklistId }),
      output: z.object({
        id: ChecklistId,
        title: z.string(),
        items: z.array(
          z.object({
            id: z.string(),
            kind: z.enum(["step", "document", "note"]),
            text: z.string(),
            instance: z.string().nullable(),
            deadline: z.string().nullable(),
            norm: z.string().nullable(),
          }),
        ),
      }),
      execute: async (_ctx, input) => {
        const view = checklists.template(input.id);
        return {
          id: view.id,
          title: view.title,
          items: view.items.map((i) => ({
            id: i.id,
            kind: i.kind,
            text: i.text,
            instance: i.instance?.label ?? null,
            deadline: i.deadline,
            norm: i.norm?.ref ?? null,
          })),
        };
      },
    }),
  };
}

// Дозапрос (AGT-06, PROF-04, ARCHITECTURE §8.2): инструмент `ask_user` без `execute` — цикл агента останавливается,
// вопрос показывает сайт. Вариант ответа несёт значение факта: совпал ответ человека с вариантом — факт записывает код
// (`profile.recordAnswer`), без модели; свободный ответ записывает агент через `upsert_profile_fact`.
import { DERIVED_FACT_KEYS, FACT_KEYS, type FactValueInput } from "@kosht/contract";
import { tool } from "ai";
import { z } from "zod";
import { toolInputSchema } from "./tool-schema.ts";

export const ASK_USER = "ask_user";

const isUserKey = (key: string) => !(DERIVED_FACT_KEYS as readonly string[]).includes(key);
const UserFactKey = z.enum(FACT_KEYS.filter(isUserKey) as [(typeof FACT_KEYS)[number]]);
export type AskFactKey = z.infer<typeof UserFactKey>;

const HOUSING_VALUES = new Set(["now", "before", "no", "unknown"]);

/**
 * Значение факта по ключу и значению варианта: «yes»/«no» у да-нет ключей, статус учёта у `housingQueue`. Остальные ключи
 * (занятость, дети, доходы) вариантом не выбираются — только свободным ответом через инструмент записи.
 */
export function optionToFact(factKey: string, value: string): FactValueInput | undefined {
  if (factKey === "housingQueue" && HOUSING_VALUES.has(value)) {
    return {
      key: "housingQueue",
      status: value as "now" | "before" | "no" | "unknown",
      since: null,
    };
  }
  if (value === "yes" || value === "no") {
    const bool = value === "yes";
    switch (factKey) {
      case "mainEmployer":
        return { key: "mainEmployer", has: bool, name: null };
      case "youngSpecialist":
        return { key: "youngSpecialist", value: bool, until: null };
      case "largeFamily":
      case "benefitCategory":
      case "property.apartment":
      case "property.land":
      case "property.car":
        return { key: factKey, value: bool };
      default:
        return undefined;
    }
  }
  return undefined;
}

export const AskInput = z
  .strictObject({
    factKey: UserFactKey,
    question: z.string().trim().min(3).max(300),
    options: z
      .array(z.strictObject({ label: z.string().trim().min(1).max(60), value: z.string().max(20) }))
      .max(4)
      .optional(),
  })
  .superRefine((input, ctx) => {
    for (const option of input.options ?? []) {
      if (optionToFact(input.factKey, option.value) === undefined) {
        ctx.addIssue({ code: "custom", message: "option value does not fit the fact key" });
      }
    }
  });
export type AskUserInput = z.infer<typeof AskInput>;

export const ASK_USER_DESCRIPTION =
  "Ask ONE short question when a fact is missing; stops until the user answers. Option value: yes|no, or now|before|no|unknown for housingQueue.";

/** Инструмент без `execute`: остановка цикла — по правилам AI SDK (нет функции — нечего исполнять). */
export function askUserTool() {
  return tool({ description: ASK_USER_DESCRIPTION, inputSchema: toolInputSchema(AskInput) });
}

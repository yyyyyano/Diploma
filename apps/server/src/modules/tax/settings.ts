// Настройки tax (TAX-20): признаки получателя «учреждение образования» подбираются на живых выписках, поэтому настройка, а не константа.
import { z } from "zod";
import { defineSetting } from "../../platform/settings/settings.ts";
import { DEFAULT_EDUCATION_PAYEE_WORDS } from "./domain/education-payee.ts";

/**
 * Слова в названии получателя или описании платежа, по которым оплата в категории «Образование» считается оплатой учреждению
 * образования (ст. 210 НК: высшее, среднее специальное, профессионально-техническое). Основа слова — с границы слова.
 */
export const EDUCATION_PAYEE_WORDS = defineSetting({
  key: "tax.education-payee-words",
  schema: z.array(z.string().trim().min(2).max(40)).max(80),
  default: [...DEFAULT_EDUCATION_PAYEE_WORDS],
});

export const TAX_SETTINGS = [EDUCATION_PAYEE_WORDS] as const;

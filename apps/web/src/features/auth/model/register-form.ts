// Форма регистрации (AUTH-01, AUTH-02): поля формы — на схемах контракта (Email, NewPassword), согласие на ПД —
// literal true, как в RegisterInput; пароли совпадают. В запрос форма превращается toRegisterInput с версиями текстов
// согласий из словаря policy — теми, что человек видел.
import type { RegisterInput } from "@kosht/contract";
import { Email, NewPassword } from "@kosht/contract";
import { CONSENT_VERSIONS } from "@kosht/i18n";
import { z } from "zod";

export const RegisterForm = z
  .object({
    email: Email,
    password: NewPassword,
    repeat: z.string(),
    consent: z.literal(true),
    cloud: z.boolean(),
  })
  .refine((v) => v.repeat === v.password, { path: ["repeat"] });

export interface RegisterValues {
  email: string;
  password: string;
  repeat: string;
  consent: boolean;
  cloud: boolean;
}

export const EMPTY_REGISTER: RegisterValues = {
  email: "",
  password: "",
  repeat: "",
  consent: false,
  cloud: false,
};

export function toRegisterInput(values: RegisterValues): z.input<typeof RegisterInput> {
  return {
    email: values.email.trim(),
    password: values.password,
    consents: {
      personalData: { accepted: true, version: CONSENT_VERSIONS.personalData },
      cloud: { accepted: values.cloud, version: CONSENT_VERSIONS.cloud },
    },
  };
}

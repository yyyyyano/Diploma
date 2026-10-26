// Формы восстановления доступа (AUTH-04, AUTH-05): поля — на схемах контракта (Email, NewPassword, RecoveryCode),
// пароли совпадают. Одна схема для формы и сервера, сообщения — ключи словаря auth:recovery.
import { Email, NewPassword, RecoveryCode } from "@kosht/contract";
import { z } from "zod";

export const ResetRequestForm = z.object({ email: Email });

export const NewPasswordForm = z
  .object({ password: NewPassword, repeat: z.string() })
  .refine((v) => v.repeat === v.password, { path: ["repeat"] });

export const CodeForm = z
  .object({ email: Email, code: RecoveryCode, password: NewPassword, repeat: z.string() })
  .refine((v) => v.repeat === v.password, { path: ["repeat"] });

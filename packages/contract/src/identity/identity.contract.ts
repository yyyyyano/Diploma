// Вход и первый запуск (AUTH-08, AUTH-10, ROLE-02, NFR-24, ADR-0016). Доступ ставит сервер: status, signIn, signOut —
// publicProc (гость), setup — localOnly (на сетевом входе процедуры «нет»), me — authed. Пароль уходит только во
// входе процедуры и нигде не возвращается; владельца во входе нет — он из сессии.
import { oc } from "@orpc/contract";
import { z } from "zod";
import { pickErrors } from "../errors.ts";

/** Email аккаунта (сервер приводит к нижнему регистру). */
export const Email = z.email().max(254);

/** Новый пароль (SEC-01): не короче 12 символов; верхняя граница — защита хэша от огромного ввода. */
export const NewPassword = z.string().min(12).max(128);

/** Пароль при входе: длину проверяет только сервер (старый пароль мог быть задан по другим правилам). */
export const Password = z.string().min(1).max(128);

export const Role = z.enum(["user", "admin"]);

/** Кто вошёл — для каркаса сайта (меню по роли, имя и email в боковом меню). */
export const SessionUser = z.strictObject({
  email: z.string(),
  name: z.string(),
  role: Role,
});
export type SessionUser = z.infer<typeof SessionUser>;

export const SetupInput = z.strictObject({ email: Email, password: NewPassword });
export const SignInInput = z.strictObject({ email: Email, password: Password });

const Ok = z.strictObject({ ok: z.literal(true) });

export const identityContract = {
  /**
   * Состояние системы для стартового маршрута: initialized — первый запуск пройден; setupAvailable — экран первого
   * запуска доступен этому запросу (не инициализирована и локальный вход).
   */
  status: oc
    .route({ method: "GET", path: "/identity/status" })
    .output(z.strictObject({ initialized: z.boolean(), setupAvailable: z.boolean() })),
  /** Первый запуск: администратор и его домохозяйство; повтор или параллельный второй — CONFLICT. */
  setup: oc
    .route({ method: "POST", path: "/identity/setup" })
    .input(SetupInput)
    .output(Ok)
    .errors(pickErrors("VALIDATION", "CONFLICT", "NOT_FOUND")),
  /** Вход: cookie kosht_session ставится в ответе (Set-Cookie). */
  signIn: oc
    .route({ method: "POST", path: "/identity/sign-in" })
    .input(SignInInput)
    .output(SessionUser)
    .errors(pickErrors("VALIDATION", "INVALID_CREDENTIALS")),
  /** Выход: сессия завершается, cookie снимается; без сессии — тоже успех. */
  signOut: oc.route({ method: "POST", path: "/identity/sign-out" }).output(Ok),
  /** Кто вошёл; без сессии — UNAUTHORIZED. */
  me: oc
    .route({ method: "GET", path: "/identity/me" })
    .output(SessionUser)
    .errors(pickErrors("UNAUTHORIZED")),
};

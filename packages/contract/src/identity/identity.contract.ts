// Вход и первый запуск (AUTH-08, AUTH-10, ROLE-02, NFR-24, ADR-0016). Доступ ставит сервер: status, signIn, signOut —
// publicProc (гость), setup — localOnly (на сетевом входе процедуры «нет»), me — authed. Пароль уходит только во
// входе процедуры и нигде не возвращается; владельца во входе нет — он из сессии.
import { oc } from "@orpc/contract";
import { z } from "zod";
import { pickErrors } from "../errors.ts";
import { RegistrationConsents } from "../privacy/privacy.contract.ts";

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
  /** Адрес подтверждён по ссылке из письма (AUTH-03); до этого в настройках — отметка и «Отправить ещё раз». */
  emailVerified: z.boolean(),
});
export type SessionUser = z.infer<typeof SessionUser>;

export const SetupInput = z.strictObject({ email: Email, password: NewPassword });
export const SignInInput = z.strictObject({ email: Email, password: Password });

/** Регистрация (AUTH-01, AUTH-02): без согласия на обработку ПД вход не проходит схему. */
export const RegisterInput = z.strictObject({
  email: Email,
  password: NewPassword,
  consents: RegistrationConsents,
});

/** Токен ссылки из письма (base64url, 32 байта). */
export const LinkToken = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
export const VerifyEmailInput = z.strictObject({ token: LinkToken });

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
    .errors(pickErrors("VALIDATION", "CONFLICT", "EMAIL_TAKEN", "NOT_FOUND")),
  /** Вход: cookie kosht_session ставится в ответе (Set-Cookie). */
  signIn: oc
    .route({ method: "POST", path: "/identity/sign-in" })
    .input(SignInInput)
    .output(SessionUser)
    .errors(pickErrors("VALIDATION", "INVALID_CREDENTIALS", "ACCOUNT_BLOCKED", "RATE_LIMITED")),
  /**
   * Регистрация: пользователь, его домохозяйство и согласия — одной транзакцией; письмо подтверждения; вход сразу
   * (Set-Cookie). Email занят — EMAIL_TAKEN; версия текста согласия устарела — CONFLICT; частота — RATE_LIMITED.
   */
  register: oc
    .route({ method: "POST", path: "/identity/register" })
    .input(RegisterInput)
    .output(SessionUser)
    .errors(pickErrors("VALIDATION", "EMAIL_TAKEN", "CONFLICT", "RATE_LIMITED")),
  /** Подтверждение адреса по ссылке из письма (страница сайта шлёт POST); ссылка устарела — LINK_INVALID. */
  verifyEmail: oc
    .route({ method: "POST", path: "/identity/verify-email" })
    .input(VerifyEmailInput)
    .output(Ok)
    .errors(pickErrors("VALIDATION", "LINK_INVALID")),
  /** «Отправить письмо ещё раз» (AUTH-03); адрес уже подтверждён — успех без письма. */
  resendVerification: oc
    .route({ method: "POST", path: "/identity/resend-verification" })
    .output(Ok)
    .errors(pickErrors("UNAUTHORIZED", "RATE_LIMITED", "UNAVAILABLE")),
  /** Выход: сессия завершается, cookie снимается; без сессии — тоже успех. */
  signOut: oc.route({ method: "POST", path: "/identity/sign-out" }).output(Ok),
  /** Кто вошёл; без сессии — UNAUTHORIZED. */
  me: oc
    .route({ method: "GET", path: "/identity/me" })
    .output(SessionUser)
    .errors(pickErrors("UNAUTHORIZED")),
};

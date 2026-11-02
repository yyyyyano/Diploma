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

/** Контакт оператора загрузчика законов (LAW-36): email или адрес сайта — он попадает в User-Agent запросов к pravo.by. */
export const LoaderContact = z.union([Email, z.url({ protocol: /^https?$/ }).max(200)]);

/** Первый запуск: контакт загрузчика необязателен (нет или пусто) — по умолчанию email администратора (AUTH-10). */
export const SetupInput = z.strictObject({
  email: Email,
  password: NewPassword,
  loaderContact: z.union([LoaderContact, z.literal("")]).optional(),
});
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

/** «Забыли пароль?»: адрес аккаунта. */
export const PasswordResetRequestInput = z.strictObject({ email: Email });
/** Новый пароль по ссылке из письма. */
export const PasswordResetInput = z.strictObject({ token: LinkToken, password: NewPassword });

/** Код восстановления (AUTH-05) как его вводит человек: «KQ7M-4XPD-9TJC-2HWR», пробелы и регистр не важны. */
export const RecoveryCode = z.string().min(16).max(40);
export const RecoverWithCodeInput = z.strictObject({
  email: Email,
  code: RecoveryCode,
  password: NewPassword,
});

/** «Удалить аккаунт» (PRIV-06): подтверждение текущим паролем. */
export const DeleteAccountInput = z.strictObject({ password: Password });

export const ChangePasswordInput = z.strictObject({
  currentPassword: Password,
  newPassword: NewPassword,
});

/** Новый код восстановления — показывается один раз; момент создания — ISO UTC. */
export const IssuedRecoveryCode = z.strictObject({
  recoveryCode: z.string(),
  createdAt: z.iso.datetime(),
});

const Ok = z.strictObject({ ok: z.literal(true) });

export const identityContract = {
  /**
   * Состояние системы для стартового маршрута: initialized — первый запуск пройден; setupAvailable — экран первого
   * запуска доступен этому запросу (не инициализирована и локальный вход).
   */
  status: oc.route({ method: "GET", path: "/identity/status" }).output(
    z.strictObject({
      initialized: z.boolean(),
      setupAvailable: z.boolean(),
      /** Кнопка «Войти как демо-пользователь» (DEMO-04): только на локальном слушателе. */
      demoAvailable: z.boolean(),
    }),
  ),
  /**
   * Первый запуск: администратор и его домохозяйство; повтор или параллельный второй — CONFLICT. В ответе — код
   * восстановления администратора (AUTH-05): показать один раз.
   */
  setup: oc
    .route({ method: "POST", path: "/identity/setup" })
    .input(SetupInput)
    .output(z.strictObject({ ok: z.literal(true), recoveryCode: z.string() }))
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
  /** «Забыли пароль?» (AUTH-04): ответ одинаковый, есть такой email или нет; письмо — только активному. */
  requestPasswordReset: oc
    .route({ method: "POST", path: "/identity/password-reset/request" })
    .input(PasswordResetRequestInput)
    .output(Ok)
    .errors(pickErrors("VALIDATION", "RATE_LIMITED")),
  /** Новый пароль по ссылке: ссылка одноразовая, 1 час; все сессии завершаются. */
  resetPassword: oc
    .route({ method: "POST", path: "/identity/password-reset" })
    .input(PasswordResetInput)
    .output(Ok)
    .errors(pickErrors("VALIDATION", "LINK_INVALID", "ACCOUNT_BLOCKED")),
  /** «Войти с кодом восстановления»: новый пароль, новый код (старый не работает), вход (Set-Cookie). */
  recoverWithCode: oc
    .route({ method: "POST", path: "/identity/recovery-code/sign-in" })
    .input(RecoverWithCodeInput)
    .output(z.strictObject({ user: SessionUser, recoveryCode: z.string() }))
    .errors(pickErrors("VALIDATION", "INVALID_CREDENTIALS", "ACCOUNT_BLOCKED", "RATE_LIMITED")),
  /** Когда создан действующий код восстановления; кода нет — null. */
  recoveryCodeStatus: oc
    .route({ method: "GET", path: "/identity/recovery-code" })
    .output(z.strictObject({ createdAt: z.iso.datetime().nullable() }))
    .errors(pickErrors("UNAUTHORIZED")),
  /** Создать код восстановления в настройках (прежний перестаёт действовать); показать один раз. */
  createRecoveryCode: oc
    .route({ method: "POST", path: "/identity/recovery-code" })
    .output(IssuedRecoveryCode)
    .errors(pickErrors("UNAUTHORIZED")),
  /** Смена пароля (AUTH-08): текущий неверен — INVALID_CREDENTIALS; прочие сессии завершаются. */
  changePassword: oc
    .route({ method: "POST", path: "/identity/password" })
    .input(ChangePasswordInput)
    .output(Ok)
    .errors(pickErrors("VALIDATION", "UNAUTHORIZED", "INVALID_CREDENTIALS", "RATE_LIMITED")),
  /**
   * Удалить аккаунт безвозвратно (PRIV-06): пароль неверен — INVALID_CREDENTIALS; последний администратор —
   * LAST_ADMIN (AUTH-12). Успех — все данные пользователя удалены, cookie сессии снята.
   */
  /**
   * Отметка «Пароль был сброшен администратором <дата>» (AUTH-05, R37): ссылку сброса показали администратору, потому
   * что подтверждённой почты не было. Пока не погашена — момент (ISO UTC), иначе null.
   */
  adminResetNotice: oc
    .route({ method: "GET", path: "/identity/admin-reset" })
    .output(z.strictObject({ at: z.iso.datetime().nullable() }))
    .errors(pickErrors("UNAUTHORIZED")),
  /** Погасить отметку «Пароль был сброшен администратором» — человек её увидел. */
  acknowledgeAdminReset: oc
    .route({ method: "POST", path: "/identity/admin-reset/ack" })
    .output(Ok)
    .errors(pickErrors("UNAUTHORIZED")),
  deleteAccount: oc
    .route({ method: "POST", path: "/identity/delete-account" })
    .input(DeleteAccountInput)
    .output(Ok)
    .errors(
      pickErrors("VALIDATION", "UNAUTHORIZED", "INVALID_CREDENTIALS", "LAST_ADMIN", "RATE_LIMITED"),
    ),
  /** Выход: сессия завершается, cookie снимается; без сессии — тоже успех. */
  signOut: oc.route({ method: "POST", path: "/identity/sign-out" }).output(Ok),
  /** Кто вошёл; без сессии — UNAUTHORIZED. */
  me: oc
    .route({ method: "GET", path: "/identity/me" })
    .output(SessionUser)
    .errors(pickErrors("UNAUTHORIZED")),
};

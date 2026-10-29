// Администрирование (ADM-01, ADM-30, ADM-60, AUTH-05, AUTH-12, R37, PRIV-07): только роль admin — проверяет сервер
// (процедуры `admin`). Ответы — метаданные учётных записей и системы: ни финансов, ни профиля, ни переписки, ни
// счётчиков данных пользователя (PRIV-07, ARCHITECTURE §6.5; форму сторожит admin.contract.test.ts). Пользователь
// указывается своим id (`id`), а не «userId»: владелец данных во входе не передаётся — это id учётной записи, над
// которой действует администратор.
import { oc } from "@orpc/contract";
import { z } from "zod";
import { pickErrors } from "../errors.ts";
import { Email, Role } from "../identity/identity.contract.ts";
import {
  AiConnectionResult,
  AiPeriod,
  AiProviders,
  AiUsage,
  SaveAiModelInput,
  SetAiChainInput,
  SetAiKeyInput,
  SetAiModelEnabledInput,
  SetAiPriceInput,
} from "./ai.contract.ts";

const Ok = z.strictObject({ ok: z.literal(true) });

/** Строка «Пользователи» (ADM-30). */
export const AdminUser = z.strictObject({
  id: z.uuid(),
  email: z.string(),
  registeredAt: z.iso.datetime(),
  emailVerified: z.boolean(),
  status: z.enum(["active", "blocked"]),
  role: Role,
  /** Демо-пользователь (DEMO-04). */
  demo: z.boolean(),
  /** Привязан ли Telegram (TG-02; до T-052 — всегда false). */
  telegram: z.boolean(),
  /** Облачный режим ИИ (PRIV-02): согласие на облако дано. */
  cloud: z.boolean(),
  /** Это сам администратор, который смотрит список. */
  self: z.boolean(),
});
export type AdminUser = z.infer<typeof AdminUser>;

export const AdminUserRef = z.strictObject({ id: z.uuid() });

/** Итог «Сбросить пароль»: письмо ушло самому пользователю или ссылка показана администратору (R37). */
export const AdminResetResult = z.discriminatedUnion("delivery", [
  z.strictObject({ delivery: z.literal("email") }),
  z.strictObject({ delivery: z.literal("shown"), link: z.url() }),
]);
export type AdminResetResult = z.infer<typeof AdminResetResult>;

/** Запуск фоновой задачи (OBS-07): вид, состояние, прогресс, код ошибки каталога (без текста), моменты. */
export const JobRun = z.strictObject({
  kind: z.string(),
  status: z.enum(["running", "completed", "failed", "dropped"]),
  progress: z.int().min(0).max(100).nullable(),
  errorCode: z.string().nullable(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
});
export type JobRun = z.infer<typeof JobRun>;

/** Расписание (запланированная задача): имя очереди, cron по поясу системы и последний запуск. */
export const ScheduledJob = z.strictObject({
  name: z.string(),
  cron: z.string(),
  lastRun: JobRun.nullable(),
});

/** Почта (AUTH-06): пароль — только «задан / не задан» (NFR-16). */
export const MailSettings = z.strictObject({
  configured: z.boolean(),
  host: z.string(),
  port: z.int(),
  secure: z.boolean(),
  user: z.string(),
  from: z.string(),
  passwordSet: z.boolean(),
});

/** Экран «Система» (ADM-60). */
export const SystemOverview = z.strictObject({
  jobs: z.strictObject({
    running: z.array(JobRun).max(100),
    failures: z.array(JobRun).max(100),
    schedules: z.array(ScheduledJob).max(200),
  }),
  mail: MailSettings,
  /** Часовой пояс IANA (NFR-23); расписания worker перестроятся после его перезапуска. */
  timeZone: z.string(),
  /** Доступ с других устройств (NFR-24) и адрес компьютера для ссылок в письмах. */
  lan: z.strictObject({ allowed: z.boolean(), address: z.string() }),
  /** Langfuse (OBS-05): включён ли и адрес интерфейса — только на этом компьютере. */
  langfuse: z.strictObject({ enabled: z.boolean(), url: z.string().nullable() }),
});
export type SystemOverview = z.infer<typeof SystemOverview>;

export const SetMailInput = z.strictObject({
  host: z.string().trim().max(253),
  port: z.int().min(1).max(65_535),
  secure: z.boolean(),
  user: z.string().max(254),
  from: Email,
  /** Новый пароль SMTP; не передан — прежний остаётся (поле только для записи). */
  password: z.string().min(1).max(256).optional(),
});

export const adminContract = {
  /** Пользователи системы — только учётные записи (ADM-30). */
  users: oc
    .route({ method: "GET", path: "/admin/users" })
    .output(z.strictObject({ items: z.array(AdminUser).max(1000) }))
    .errors(pickErrors("UNAUTHORIZED", "FORBIDDEN")),
  /** Заблокировать (сессии завершаются сразу) или разблокировать; последнего администратора — LAST_ADMIN. */
  setUserStatus: oc
    .route({ method: "POST", path: "/admin/users/status" })
    .input(z.strictObject({ id: z.uuid(), status: z.enum(["active", "blocked"]) }))
    .output(Ok)
    .errors(pickErrors("VALIDATION", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "LAST_ADMIN")),
  /** Назначить или снять администратора; снять у последнего — LAST_ADMIN. */
  setUserRole: oc
    .route({ method: "POST", path: "/admin/users/role" })
    .input(z.strictObject({ id: z.uuid(), role: Role }))
    .output(Ok)
    .errors(pickErrors("VALIDATION", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "LAST_ADMIN")),
  /** Удалить пользователя со всеми данными; email — подтверждение (не совпал — VALIDATION). */
  deleteUser: oc
    .route({ method: "POST", path: "/admin/users/delete" })
    .input(z.strictObject({ id: z.uuid(), email: z.string().max(254) }))
    .output(Ok)
    .errors(pickErrors("VALIDATION", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "LAST_ADMIN")),
  /** Ссылка сброса пароля — самому пользователю; администратору — только без подтверждённой почты (R37). */
  resetUserPassword: oc
    .route({ method: "POST", path: "/admin/users/reset-password" })
    .input(AdminUserRef)
    .output(AdminResetResult)
    .errors(pickErrors("UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "ACCOUNT_BLOCKED", "UNAVAILABLE")),
  /** Экран «Система»: фоновые задачи, почта, часовой пояс, доступ из сети, Langfuse. */
  system: oc
    .route({ method: "GET", path: "/admin/system" })
    .output(SystemOverview)
    .errors(pickErrors("UNAUTHORIZED", "FORBIDDEN")),
  setMail: oc
    .route({ method: "POST", path: "/admin/system/mail" })
    .input(SetMailInput)
    .output(SystemOverview)
    .errors(pickErrors("VALIDATION", "UNAUTHORIZED", "FORBIDDEN")),
  /** Тестовое письмо — на адрес администратора; сбой SMTP — UNAVAILABLE. */
  sendTestMail: oc
    .route({ method: "POST", path: "/admin/system/mail/test" })
    .output(Ok)
    .errors(pickErrors("UNAUTHORIZED", "FORBIDDEN", "UNAVAILABLE")),
  setTimeZone: oc
    .route({ method: "POST", path: "/admin/system/time-zone" })
    .input(z.strictObject({ timeZone: z.string().min(1).max(64) }))
    .output(SystemOverview)
    .errors(pickErrors("VALIDATION", "UNAUTHORIZED", "FORBIDDEN")),
  /** Открыть или закрыть вход из сети без перезапуска; адрес — для ссылок в письмах, при включении обязателен (NFR-24). */
  setLan: oc
    .route({ method: "POST", path: "/admin/system/lan" })
    .input(
      z.strictObject({
        allowed: z.boolean(),
        address: z.union([z.literal(""), z.url({ protocol: /^https?$/ })]),
      }),
    )
    .output(SystemOverview)
    .errors(pickErrors("VALIDATION", "UNAUTHORIZED", "FORBIDDEN")),
  /** «Провайдеры ИИ» (ADM-50): цепочки по задачам, реестр моделей, статус ключей. */
  aiProviders: oc
    .route({ method: "GET", path: "/admin/ai/providers" })
    .output(AiProviders)
    .errors(pickErrors("UNAUTHORIZED", "FORBIDDEN")),
  /** Порядок цепочки задачи (ADM-50): модели с нужными возможностями; иначе — VALIDATION. */
  setAiChain: oc
    .route({ method: "POST", path: "/admin/ai/chain" })
    .input(SetAiChainInput)
    .output(AiProviders)
    .errors(pickErrors("VALIDATION", "UNAUTHORIZED", "FORBIDDEN")),
  /** Включить или выключить модель реестра (ADM-50). */
  setAiModelEnabled: oc
    .route({ method: "POST", path: "/admin/ai/model-enabled" })
    .input(SetAiModelEnabledInput)
    .output(AiProviders)
    .errors(pickErrors("VALIDATION", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND")),
  /** Добавить модель существующего провайдера или изменить возможности, цены, лимиты, разрешение выбора (LLM-09). */
  saveAiModel: oc
    .route({ method: "POST", path: "/admin/ai/model" })
    .input(SaveAiModelInput)
    .output(AiProviders)
    .errors(pickErrors("VALIDATION", "UNAUTHORIZED", "FORBIDDEN")),
  /** «Проверить связь» (LLM-08): список моделей провайдера и модель в нём. Сбой — в ответе, а не ошибкой процедуры. */
  testAiProvider: oc
    .route({ method: "POST", path: "/admin/ai/test" })
    .input(z.strictObject({ id: z.string().min(1).max(200) }))
    .output(AiConnectionResult)
    .errors(pickErrors("UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND")),
  /** Ключ API провайдера: только запись; после сохранения — «задан» (NFR-16). */
  setAiKey: oc
    .route({ method: "POST", path: "/admin/ai/key" })
    .input(SetAiKeyInput)
    .output(AiProviders)
    .errors(pickErrors("VALIDATION", "UNAUTHORIZED", "FORBIDDEN")),
  /** «Запросы к ИИ» (ADM-20): цифры журнала расхода за период; текстов запросов нет (ADM-22). */
  aiUsage: oc
    .route({ method: "GET", path: "/admin/ai/usage" })
    .input(z.strictObject({ period: AiPeriod.default("day") }))
    .output(AiUsage)
    .errors(pickErrors("VALIDATION", "UNAUTHORIZED", "FORBIDDEN")),
  /** Прайс-лист условной стоимости (ADM-21): цена записи за миллион токенов. */
  setAiPrice: oc
    .route({ method: "POST", path: "/admin/ai/price" })
    .input(SetAiPriceInput)
    .output(AiUsage)
    .errors(pickErrors("VALIDATION", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND")),
};

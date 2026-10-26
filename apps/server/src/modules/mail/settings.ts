// Почта (AUTH-06, ADM-60): SMTP задаётся в админке (поля — T-017), env — запасное значение разработчика. Пустой хост —
// почта не настроена: все письма идут в локальный ящик, и он включён. Пароль SMTP — секрет (NFR-16).
import { z } from "zod";
import { defineSecret } from "../../platform/secrets/secrets.ts";
import { defineSetting } from "../../platform/settings/settings.ts";

export const SMTP_HOST = defineSetting({
  key: "mail.smtp-host",
  schema: z.string().trim().max(253),
  default: "",
  env: "SMTP_HOST",
});

export const SMTP_PORT = defineSetting({
  key: "mail.smtp-port",
  schema: z.int().min(1).max(65_535),
  default: 587,
  env: "SMTP_PORT",
  fromEnv: Number,
});

/** TLS с самого начала (порт 465); иначе — STARTTLS, если сервер его предлагает. */
export const SMTP_SECURE = defineSetting({
  key: "mail.smtp-secure",
  schema: z.boolean(),
  default: false,
  env: "SMTP_SECURE",
  fromEnv: (raw) => raw === "1" || raw === "true",
});

/** Логин SMTP; пусто — сервер без входа. */
export const SMTP_USER = defineSetting({
  key: "mail.smtp-user",
  schema: z.string().max(254),
  default: "",
  env: "SMTP_USER",
});

/** Адрес отправителя писем. */
export const MAIL_FROM = defineSetting({
  key: "mail.from-address",
  schema: z.email().max(254),
  default: "no-reply@kosht.local",
  env: "SMTP_FROM",
});

export const SMTP_PASSWORD = defineSecret({ name: "mail.smtp-password", env: "SMTP_PASSWORD" });

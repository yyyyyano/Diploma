// AUTH-06: письма на настоящем Postgres — пока SMTP не настроен, все письма в локальном ящике; настроен — уходят по
// SMTP (поддельный сервер на 127.0.0.1), а ящик выключен. Сбой SMTP — UNAVAILABLE; адрес в лог не попадает.
import { FakeClock } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MasterKey } from "../../../platform/config/master-key.ts";
import { createSystemDb } from "../../../platform/db/system-db.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import { createSecrets } from "../../../platform/secrets/secrets.ts";
import { createSettings } from "../../../platform/settings/settings.ts";
import {
  decodedParts,
  startFakeSmtp,
  type FakeSmtp,
} from "../infrastructure/__fixtures__/fake-smtp.ts";
import { createLocalMailbox } from "../infrastructure/local-mailbox.ts";
import { createSmtpTransport } from "../infrastructure/smtp.ts";
import { makeMailbox } from "./mailbox.ts";
import { makeSendMail } from "./send-mail.ts";
import { makeSmtpSettings } from "./smtp-settings.ts";

let db: TestDb;
let smtp: FakeSmtp;
beforeAll(async () => {
  db = await createTestDb();
  smtp = await startFakeSmtp();
});
afterAll(async () => {
  await smtp.close();
  await db.drop();
});
beforeEach(async () => {
  await db.owner.query("delete from mail_messages");
  smtp.received.length = 0;
});

const verify = {
  kind: "verify-email",
  link: "http://127.0.0.1:8140/verify-email?token=tok-123",
  hours: 24,
} as const;

/** Модуль почты процесса с окружением env (SMTP задаётся переменными — как запасное значение разработчика). */
function mailWith(env: Record<string, string> = {}) {
  const clock = new FakeClock("2026-10-26T09:00:00Z");
  const memory = memoryLogger();
  const system = createSystemDb(db.pool);
  const platform = {
    system,
    settings: createSettings({ db: system, clock, env: (name) => env[name], log: memory.log }),
    secrets: createSecrets({
      db: system,
      masterKey: MasterKey.fromBytes(Buffer.alloc(32, 7)),
      env: (name) => env[name],
      clock,
      log: memory.log,
    }),
    log: memory.log,
  };
  const send = makeSendMail({
    platform,
    mailbox: createLocalMailbox({ system, clock }),
    smtp: createSmtpTransport,
  });
  return {
    send,
    mailbox: makeMailbox(platform),
    memory,
    smtpSettings: makeSmtpSettings({ ...platform, send }),
  };
}

describe("AUTH-06: локальный ящик, пока почта не настроена", () => {
  it("письмо подтверждения ложится в ящик целиком: тема, абзацы, кнопка со ссылкой, пометка", async () => {
    const { send, mailbox, memory } = mailWith();
    await send("Irina@Example.test", verify);
    const box = await mailbox();
    expect(box.enabled).toBe(true);
    expect(box.messages).toEqual([
      {
        id: expect.any(String),
        to: "Irina@Example.test",
        subject: "Подтвердите адрес электронной почты",
        preview: "Подтвердите адрес — так по почте можно будет восстановить пароль.",
        title: "Подтвердите ваш адрес",
        paragraphs: [
          "Здравствуйте!",
          expect.stringContaining("Вы зарегистрировались в Коште"),
          "Пользоваться Коштом можно и до подтверждения.",
        ],
        action: { label: "Подтвердить адрес", url: verify.link },
        note: { kind: "info", text: expect.stringContaining("Ссылка действует 24 ч.") },
        sentAt: new Date("2026-10-26T09:00:00Z"),
      },
    ]);
    expect(smtp.received).toEqual([]);
    expect(memory.text()).not.toContain("example.test");
    expect(memory.text()).not.toContain("tok-123");
  });

  it("новые письма — сверху", async () => {
    const { send, mailbox } = mailWith();
    await send("first@example.test", verify);
    await send("second@example.test", verify);
    expect((await mailbox()).messages.map((m) => m.to)).toEqual([
      "second@example.test",
      "first@example.test",
    ]);
  });
});

describe("AUTH-06: SMTP настроен — ящик выключен", () => {
  const env = () => ({ SMTP_HOST: "127.0.0.1", SMTP_PORT: String(smtp.port) });

  it("письмо уходит на SMTP-сервер с темой, ссылкой и отправителем; в ящик не попадает", async () => {
    const { send, mailbox } = mailWith(env());
    await send("irina@example.test", verify);
    expect(smtp.received).toHaveLength(1);
    const raw = smtp.received[0] ?? "";
    expect(raw).toContain("To: irina@example.test");
    expect(raw).toContain("no-reply@kosht.local");
    expect(decodedParts(raw)).toContain(
      "Подтвердить адрес: http://127.0.0.1:8140/verify-email?token=tok-123",
    );
    expect(await mailbox()).toEqual({ enabled: false, messages: [] });
    const { rows } = await db.owner.query("select id from mail_messages");
    expect(rows).toEqual([]);
  });

  it("SMTP недоступен — UNAVAILABLE, в логе ключ события без адреса", async () => {
    const { send, memory } = mailWith({ SMTP_HOST: "127.0.0.1", SMTP_PORT: "1" });
    await expect(send("irina@example.test", verify)).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    expect(memory.text()).toContain("mail.send-failed");
    expect(memory.text()).not.toContain("irina@example.test");
  });
});

describe("AUTH-04: письмо сброса пароля", () => {
  it("тема, адрес аккаунта в тексте, кнопка «Задать новый пароль», предупреждение со сроком", async () => {
    const { send, mailbox } = mailWith();
    await send("irina@example.test", {
      kind: "reset-password",
      link: "http://127.0.0.1:8140/recovery?token=r-1",
      minutes: 60,
    });
    const [letter] = (await mailbox()).messages;
    expect(letter).toMatchObject({
      subject: "Сброс пароля",
      preview: "Ссылка для нового пароля. Действует 60 мин.",
      paragraphs: expect.arrayContaining([
        expect.stringContaining("для аккаунта irina@example.test"),
      ]),
      action: { label: "Задать новый пароль", url: "http://127.0.0.1:8140/recovery?token=r-1" },
      note: { kind: "warn", text: expect.stringContaining("сработает только один раз") },
    });
  });
});

describe("ссылка письма", () => {
  it("ссылка не http(s) — письмо не собирается и никуда не уходит", async () => {
    const { send, mailbox } = mailWith();
    await expect(
      send("irina@example.test", { ...verify, link: "javascript:alert(1)" }),
    ).rejects.toThrow(RangeError);
    expect((await mailbox()).messages).toEqual([]);
  });
});

describe("ADM-60, NFR-16: почта в админке", () => {
  beforeEach(async () => {
    await db.owner.query("delete from settings where key like 'mail.%'");
    await db.owner.query("delete from secrets where name like 'mail.%'");
  });

  const fields = { host: "", port: 587, secure: false, user: "", from: "no-reply@kosht.local" };

  it("сохранить SMTP с паролем — почта настроена, пароль «задан», но наружу не отдаётся; тестовое письмо уходит по SMTP", async () => {
    const { smtpSettings } = mailWith();
    expect(await smtpSettings.view()).toMatchObject({ configured: false, passwordSet: false });
    await smtpSettings.save({
      ...fields,
      host: "127.0.0.1",
      port: smtp.port,
      user: "kosht",
      password: "пароль-приложения",
    });
    const view = await smtpSettings.view();
    expect(view).toEqual({
      configured: true,
      host: "127.0.0.1",
      port: smtp.port,
      secure: false,
      user: "kosht",
      from: "no-reply@kosht.local",
      passwordSet: true,
    });
    expect(JSON.stringify(view)).not.toContain("пароль-приложения");
    await smtpSettings.sendTest("admin@example.test");
    expect(smtp.received).toHaveLength(1);
    expect(decodedParts(smtp.received[0] ?? "")).toContain("Почта работает");
  });

  it("одно поле не по схеме — VALIDATION, и ни одно поле не записано", async () => {
    const { smtpSettings } = mailWith();
    await expect(
      smtpSettings.save({ ...fields, host: "smtp.example.test", from: "не-адрес" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await smtpSettings.view()).toMatchObject({ configured: false, host: "" });
  });

  it("пароль не передан — прежний остаётся", async () => {
    const { smtpSettings } = mailWith();
    await smtpSettings.save({ ...fields, host: "127.0.0.1", password: "первый" });
    await smtpSettings.save({ ...fields, host: "127.0.0.1" });
    expect((await smtpSettings.view()).passwordSet).toBe(true);
  });
});

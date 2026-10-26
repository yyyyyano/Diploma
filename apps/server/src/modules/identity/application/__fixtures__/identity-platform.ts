// Платформа identity для int-тестов сценариев на тестовой базе файла: SystemDb, настройки без env, ограничитель
// частоты, FakeClock (срок ссылок — по нему), Better Auth на SystemDb и письма — в массив (адрес и шаблон).
import { FakeClock } from "@kosht/testing";
import type { TestDb } from "@kosht/testing/db";
import { MasterKey } from "../../../../platform/config/master-key.ts";
import { createScopedDb } from "../../../../platform/db/scoped-db.ts";
import { createSystemDb } from "../../../../platform/db/system-db.ts";
import { memoryLogger } from "../../../../platform/logging/__fixtures__/memory-logger.ts";
import { createRateLimiter } from "../../../../platform/rate-limit/rate-limit.ts";
import { createSettings } from "../../../../platform/settings/settings.ts";
import type { MailFacade, MailTemplate } from "../../../mail/index.ts";
import { createAuth, createAuthGateway } from "../../infrastructure/auth.ts";
import { insertUser, newUserIds, type UserRole } from "../../infrastructure/db/identity.repo.ts";
import { hashPassword } from "../../infrastructure/password.ts";

export interface SentMail {
  readonly to: string;
  readonly template: MailTemplate;
}

export function identityPlatform(db: TestDb, now = "2026-10-26T09:00:00Z") {
  const clock = new FakeClock(now);
  const memory = memoryLogger();
  const system = createSystemDb(db.pool);
  const platform = {
    system,
    clock,
    log: memory.log,
    localOrigin: "http://127.0.0.1:8140",
    scoped: (scope: Parameters<typeof createScopedDb>[1]) => createScopedDb(db.pool, scope),
    settings: createSettings({ db: system, clock, env: () => undefined, log: memory.log }),
    rateLimiter: createRateLimiter({
      db: system,
      clock,
      masterKey: MasterKey.fromBytes(Buffer.alloc(32, 3)),
      log: memory.log,
    }),
  };
  const sent: SentMail[] = [];
  const mail: MailFacade = {
    send: async (to, template) => {
      sent.push({ to, template });
    },
  };
  const auth = createAuthGateway(
    createAuth({ system, secret: "s".repeat(32), baseURL: platform.localOrigin }),
  );
  return { platform, clock, memory, sent, mail, auth };
}

/** Пользователь с паролем — строками сценария первого запуска (без событий). */
export async function seedUser(
  db: TestDb,
  user: { readonly email: string; readonly password: string; readonly role?: UserRole },
) {
  const system = createSystemDb(db.pool);
  const ids = await newUserIds(system);
  await insertUser(system, {
    ...ids,
    email: user.email,
    role: user.role ?? "user",
    passwordHash: await hashPassword(user.password),
  });
  return ids;
}

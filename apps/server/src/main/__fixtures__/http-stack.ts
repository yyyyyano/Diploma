// Стенд процедур через настоящие HTTP-приложения обоих слушателей (local и lan) над корнем композиции на тестовой базе:
// api и worker (очередь, подписки), запрос — как из браузера: Host слушателя, cookie, JSON. Для сквозных int-тестов
// регистрации и восстановления доступа. Папка данных (файлы домохозяйств) у api и worker общая — как у процессов на
// одной машине: архив, собранный задачей worker, скачивается через api.
import { CONSENT_VERSIONS } from "@kosht/i18n";
import { HouseholdId, UserId } from "@kosht/kernel";
import type { TestDb } from "@kosht/testing/db";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiHandler } from "../../platform/http/api.ts";
import { createApp, type HttpApp } from "../../platform/http/app.ts";
import { BODY_LIMIT } from "../../platform/http/body-limit.ts";
import type { ListenerName } from "../../platform/http/guard.ts";
import { memoryLogger } from "../../platform/logging/__fixtures__/memory-logger.ts";
import type { Composition } from "../compose.ts";
import { composeOnTestDb } from "./compose-on-test-db.ts";

/** Host каждого слушателя: local — адрес локального входа, lan — IP компьютера в сети. */
export const STACK_HOST: Readonly<Record<ListenerName, string>> = {
  local: "127.0.0.1:8140",
  lan: "192.168.1.5:8141",
};

export interface CallOptions {
  readonly body?: unknown;
  readonly cookie?: string;
  /** POST без тела (выход, «отправить ещё раз»). */
  readonly post?: boolean;
}

export interface HttpStack {
  readonly api: Composition;
  call(listener: ListenerName, path: string, options?: CallOptions): Promise<Response>;
  close(): Promise<void>;
}

/**
 * worker: false — без процесса фоновых задач: поставленные задачи остаются ожидающими (удаление аккаунта убирает
 * ожидающие задачи домохозяйства — их нужно увидеть).
 */
export async function startHttpStack(
  db: TestDb,
  options: { readonly worker?: boolean } = {},
): Promise<HttpStack> {
  const dataDir = await mkdtemp(join(tmpdir(), "kosht-stack-data-"));
  const env = { DATA_DIR: dataDir };
  const api = await composeOnTestDb(db, "api", env);
  const worker = options.worker === false ? undefined : await composeOnTestDb(db, "worker", env);
  await api.composition.startJobs();
  await worker?.composition.startJobs();
  const log = memoryLogger().log;
  const handler = createApiHandler(api.composition.router, log);
  const apps = new Map<ListenerName, HttpApp>();
  for (const listener of ["local", "lan"] as const) {
    apps.set(
      listener,
      createApp({
        listener,
        trustedOrigins: [],
        log,
        ready: () => api.composition.ready(),
        api: {
          handler,
          session: (headers) => api.composition.session(headers),
          shutdownSignal: new AbortController().signal,
          bodyLimit: async () => BODY_LIMIT.default,
        },
      }),
    );
  }
  return {
    api: api.composition,
    async call(listener, path, options = {}) {
      const app = apps.get(listener);
      if (app === undefined) throw new Error("нет приложения");
      const headers = new Headers({ host: STACK_HOST[listener] });
      if (options.cookie !== undefined) headers.set("cookie", options.cookie);
      const init: RequestInit = { headers };
      if (options.body !== undefined) {
        headers.set("content-type", "application/json");
        init.method = "POST";
        init.body = JSON.stringify(options.body);
      } else if (options.post === true) {
        init.method = "POST";
      }
      return await app.fetch(new Request(`http://${STACK_HOST[listener]}/api${path}`, init));
    },
    async close() {
      await worker?.close();
      await api.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

/** cookie сессии из ответа: «kosht_session=…» без атрибутов. */
export function sessionCookie(response: Response): string {
  const header = response.headers.getSetCookie().find((c) => c.startsWith("kosht_session="));
  if (header === undefined) throw new Error("нет cookie kosht_session");
  return header.split(";")[0] ?? "";
}

/** Пароль пользователей стенда: подходит под SEC-01 (≥ 12 символов). */
export const STACK_PASSWORD = "пароль-пользователя";

/**
 * Зарегистрировать пользователя через HTTP (как сайт) и вернуть его cookie и id — id читаются владельцем базы по
 * email: из них тест собирает scope (makeScope), чтобы звать фасады модулей от имени этого пользователя.
 */
export async function registerUser(
  stack: HttpStack,
  db: TestDb,
  email: string,
  options: { readonly cloud?: boolean } = {},
): Promise<{ cookie: string; userId: UserId; householdId: HouseholdId }> {
  const response = await stack.call("local", "/identity/register", {
    body: {
      email,
      password: STACK_PASSWORD,
      consents: {
        personalData: { accepted: true, version: CONSENT_VERSIONS.personalData },
        cloud: { accepted: options.cloud ?? false, version: CONSENT_VERSIONS.cloud },
      },
    },
  });
  const { rows } = await db.owner.query<{ id: string; household_id: string }>(
    "select id, household_id from identity_users where email = $1",
    [email],
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`пользователь ${email} не зарегистрирован`);
  return {
    cookie: sessionCookie(response),
    userId: UserId.parse(row.id),
    householdId: HouseholdId.parse(row.household_id),
  };
}

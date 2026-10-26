// Стенд процедур через настоящие HTTP-приложения обоих слушателей (local и lan) над корнем композиции на тестовой базе:
// api и worker (очередь, подписки), запрос — как из браузера: Host слушателя, cookie, JSON. Для сквозных int-тестов
// регистрации и восстановления доступа.
import type { TestDb } from "@kosht/testing/db";
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

export async function startHttpStack(db: TestDb): Promise<HttpStack> {
  const api = await composeOnTestDb(db, "api");
  const worker = await composeOnTestDb(db, "worker");
  await api.composition.startJobs();
  await worker.composition.startJobs();
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
      await worker.close();
      await api.close();
    },
  };
}

/** cookie сессии из ответа: «kosht_session=…» без атрибутов. */
export function sessionCookie(response: Response): string {
  const header = response.headers.getSetCookie().find((c) => c.startsWith("kosht_session="));
  if (header === undefined) throw new Error("нет cookie kosht_session");
  return header.split(";")[0] ?? "";
}

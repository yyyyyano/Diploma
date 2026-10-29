// Удаление трасс пользователя в Langfuse (PRIV-06, OBS-05) по публичному API self-hosted Langfuse 4 (compose.yaml):
// трассы пользователя ищутся через Observations API v2 (`GET /api/public/v2/observations?userId=…`; старый
// `GET /api/public/traces` в v4 отвечает 404), каждый запрос ограничен окном fromStartTime/toStartTime — так требует
// API. Окна по 30 дней идут назад от «сейчас»; первое пустое окно после текущего — конец истории (трассы старше 30
// дней удаляет ночная задача llm.trace-retention через deleteTracesBefore — те же окна без фильтра по пользователю),
// но не дальше 24 окон. Уникальные traceId уходят в
// `DELETE /api/public/traces` пачками до 1000 (удаление в Langfuse асинхронное). Ответ не 2xx или сеть — ошибка:
// вызывающий ставит пользователя в очередь повторов. Документация: langfuse.com/docs/administration/data-deletion.
import type { Clock } from "@kosht/kernel";
import { z } from "zod";
import type { LangfuseTarget } from "../../../../platform/telemetry/telemetry.ts";
import type { TraceDeleter } from "../../application/ports.ts";

const DAY_MS = 86_400_000;
/** Окно запроса наблюдений. */
export const WINDOW_DAYS = 30;
/** Предел окон назад (два года). */
export const MAX_WINDOWS = 24;
/** Наибольшие страница чтения и пачка удаления по API Langfuse. */
export const PAGE_LIMIT = 1000;
export const DELETE_BATCH = 1000;
/** Срок одного HTTP-запроса к Langfuse. */
const TIMEOUT_MS = 10_000;

const ObservationsPage = z.object({
  data: z.array(z.object({ traceId: z.string().nullish() })),
  meta: z.object({ cursor: z.string().nullish() }).optional(),
});

export class LangfuseApiError extends Error {
  override readonly name = "LangfuseApiError";
}

export function createLangfuseTraceDeleter(
  target: LangfuseTarget,
  deps: { readonly clock: Clock; readonly fetch?: typeof fetch },
): TraceDeleter {
  const send = deps.fetch ?? fetch;
  const base = target.baseUrl.replace(/\/+$/, "");
  const authorization = () =>
    `Basic ${Buffer.from(`${target.publicKey}:${target.secretKey()}`).toString("base64")}`;

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await send(`${base}${path}`, {
      ...init,
      headers: { authorization: authorization(), "content-type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new LangfuseApiError(
        `Langfuse ответил ${String(response.status)} на ${path.split("?")[0] ?? ""}.`,
      );
    }
    return response;
  }

  async function deleteBatch(traceIds: readonly string[]): Promise<void> {
    await request("/api/public/traces", {
      method: "DELETE",
      body: JSON.stringify({ traceIds }),
    });
  }

  /**
   * Трассы по окнам назад от newest: наблюдения окна (с фильтром filter) → уникальные traceId → удаление пачками.
   * Первое пустое окно после первого — конец истории, но не дальше MAX_WINDOWS окон.
   */
  async function deleteBackFrom(newest: number, filter: Record<string, string>): Promise<number> {
    const seen = new Set<string>();
    let pending: string[] = [];
    let deleted = 0;
    const flush = async () => {
      if (pending.length === 0) return;
      await deleteBatch(pending);
      deleted += pending.length;
      pending = [];
    };
    let to = newest;
    for (let window = 0; window < MAX_WINDOWS; window += 1) {
      const from = to - WINDOW_DAYS * DAY_MS;
      let found = 0;
      let cursor: string | undefined;
      do {
        const query = new URLSearchParams({
          ...filter,
          fromStartTime: new Date(from).toISOString(),
          toStartTime: new Date(to).toISOString(),
          fields: "core",
          limit: String(PAGE_LIMIT),
        });
        if (cursor !== undefined) query.set("cursor", cursor);
        const page = ObservationsPage.parse(
          await (await request(`/api/public/v2/observations?${query.toString()}`)).json(),
        );
        found += page.data.length;
        for (const { traceId } of page.data) {
          if (traceId === undefined || traceId === null || seen.has(traceId)) continue;
          seen.add(traceId);
          pending.push(traceId);
          if (pending.length === DELETE_BATCH) await flush();
        }
        cursor = page.meta?.cursor ?? undefined;
      } while (cursor !== undefined && cursor !== "");
      if (found === 0 && window > 0) break;
      to = from;
    }
    await flush();
    return deleted;
  }

  return {
    // Конец окна — с запасом в минуту: спаны, досланные прямо сейчас, тоже попадают.
    deleteUserTraces: (userId) => deleteBackFrom(deps.clock.now().getTime() + 60_000, { userId }),
    deleteTracesBefore: (before) => deleteBackFrom(before.getTime(), {}),
  };
}

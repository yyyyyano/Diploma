// Админка ИИ (ADM-20, ADM-21, ADM-50, LLM-08, LLM-09): цепочки по задачам, реестр моделей, ключи, «Проверить связь» и
// цифры журнала расхода. Админ-фасад llm: модуль admin берёт отсюда только метаданные и числа — тексты запросов и
// ответов в журнале не хранятся (ADM-22), пользователей в нём нет (PRIV-07), значения ключей наружу не уходят
// (NFR-16). Облачность записи задаёт провайдер, а не администратор: «локальная» модель с облачным адаптером была бы
// утечкой в обход согласия (PRIV-02). Цифры считает сервер; стоимость — по текущему прайсу (ADM-21), поэтому правка
// цены меняет и показанную стоимость за период.
import {
  AI_TASKS,
  type AiConnectionResult,
  type AiModel,
  type AiPeriod,
  type AiProvider,
  type AiProviders,
  type AiTask,
  type AiUsage,
  type SaveAiModelInput,
} from "@kosht/contract";
import { APICallError } from "@ai-sdk/provider";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { SystemPlatform } from "../../../platform/module/define-module.ts";
import { costMicros } from "../domain/cost.ts";
import { LOCAL_ONLY_TASKS, TASKS } from "../domain/tasks.ts";
import {
  listChains,
  listModels,
  replaceChain,
  setModelEnabled,
  setModelPrice,
  upsertModel,
  usageWindows,
  type StoredModel,
} from "../infrastructure/db/llm.repo.ts";
import { usageByModel, usageByTask, usageTotals } from "../infrastructure/db/usage-stats.repo.ts";
import type { ProviderRegistry } from "../infrastructure/providers/providers.ts";
import { RemoteStatusError } from "../infrastructure/providers/remote-fetch.ts";
import { GROQ_API_KEY, ZAI_API_KEY } from "../settings.ts";

const DAY_MS = 86_400_000;
const PERIOD_DAYS: Readonly<Record<AiPeriod, number>> = { day: 1, week: 7, month: 30 };

/** Ключи облачных провайдеров (секреты, ADM-50): у остальных ключа нет. */
const KEYS = { groq: GROQ_API_KEY, zai: ZAI_API_KEY } as const;

function toAiModel(model: StoredModel): AiModel {
  return {
    id: model.id,
    provider: model.provider,
    model: model.modelId,
    cloud: model.cloud,
    capabilities: [...model.capabilities],
    priority: model.priority,
    enabled: model.enabled,
    userSelectable: model.userSelectable,
    contextTokens: model.contextTokens,
    inputMicrosPerMillion: model.inputMicrosPerMillion,
    outputMicrosPerMillion: model.outputMicrosPerMillion,
    limits: model.limits,
  };
}

export function makeLlmAdmin(d: {
  readonly platform: Pick<SystemPlatform, "system" | "secrets" | "clock" | "log">;
  readonly providers: ProviderRegistry;
  /** Адрес интерфейса Langfuse на этом компьютере (OBS-05); выключен — null. */
  readonly langfuseUrl: string | null;
}) {
  const { system, secrets, clock } = d.platform;

  async function keyStatus(id: string): Promise<AiProvider["key"]> {
    const def = KEYS[id as keyof typeof KEYS];
    return def === undefined ? "none" : secrets.status(def);
  }

  /** «Провайдеры ИИ»: провайдеры и статус ключей, реестр моделей, порядок цепочки каждой задачи. */
  async function providers(): Promise<AiProviders> {
    const [models, chains] = await Promise.all([listModels(system), listChains(system)]);
    return {
      providers: await Promise.all(
        [...d.providers.values()].map(async (adapter) => ({
          id: adapter.id,
          cloud: adapter.cloud,
          key: await keyStatus(adapter.id),
        })),
      ),
      models: models.map(toAiModel),
      chains: AI_TASKS.map((task) => {
        const rows = chains.get(task);
        const byPriority = models
          .filter((model) => TASKS[task].every((need) => model.capabilities.includes(need)))
          .map((model) => model.id);
        return { task, custom: rows !== undefined, models: rows ?? byPriority };
      }),
    };
  }

  /** Порядок цепочки задачи (ADM-50): только известные модели с нужными возможностями; векторы — только локальные. */
  async function setChain(task: AiTask, modelIds: readonly string[]): Promise<AiProviders> {
    const known = new Map((await listModels(system)).map((model) => [model.id, model]));
    const invalid =
      new Set(modelIds).size !== modelIds.length ||
      modelIds.some((id) => {
        const model = known.get(id);
        return (
          model === undefined ||
          !TASKS[task].every((need) => model.capabilities.includes(need)) ||
          (LOCAL_ONLY_TASKS.has(task) && model.cloud)
        );
      });
    if (invalid) throw new AppError("VALIDATION");
    await replaceChain(system, task, modelIds);
    return providers();
  }

  async function enable(id: string, enabled: boolean): Promise<AiProviders> {
    if (!(await setModelEnabled(system, id, enabled))) throw new AppError("NOT_FOUND");
    return providers();
  }

  /** Добавить модель существующего провайдера или изменить запись (LLM-09); провайдер — только из кода. */
  async function saveModel(input: SaveAiModelInput): Promise<AiProviders> {
    const adapter = d.providers.get(input.provider);
    // Тестовый провайдер — для тестов: модели его в боевой реестр администратор не добавляет.
    if (adapter === undefined || adapter.id === "test") throw new AppError("VALIDATION");
    await upsertModel(system, {
      provider: adapter.id,
      modelId: input.model,
      cloud: adapter.cloud,
      capabilities: input.capabilities,
      priority: input.priority,
      userSelectable: input.userSelectable,
      contextTokens: input.contextTokens,
      inputMicrosPerMillion: input.inputMicrosPerMillion,
      outputMicrosPerMillion: input.outputMicrosPerMillion,
      limits: input.limits,
    });
    return providers();
  }

  /** «Проверить связь» (LLM-08): `GET /models` провайдера и модель в списке; сбой — в ответе, ключ не показывается. */
  async function testConnection(id: string): Promise<AiConnectionResult> {
    const model = (await listModels(system)).find((record) => record.id === id);
    if (model === undefined) throw new AppError("NOT_FOUND");
    const adapter = d.providers.get(model.provider);
    if (adapter?.listModels === undefined) return { ok: false, reason: "unsupported" };
    if ((await adapter.isConfigured?.()) === false) return { ok: false, reason: "no-key" };
    const started = performance.now();
    try {
      const available = await adapter.listModels();
      if (!available.includes(model.modelId)) {
        // Список провайдера неполон (Z.ai) — модель проверяется пробой; иначе её просто нет.
        if (adapter.probe === undefined) return { ok: false, reason: "model-missing" };
        try {
          await adapter.probe(model.modelId);
        } catch (error) {
          const status = APICallError.isInstance(error) ? error.statusCode : undefined;
          if (status === 400 || status === 404) return { ok: false, reason: "model-missing" };
          throw error;
        }
      }
      return { ok: true, ms: Math.round(performance.now() - started) };
    } catch (error) {
      d.platform.log.warn({ reason: `connection-test:${model.provider}` }, "llm.test-failed");
      const status =
        error instanceof RemoteStatusError
          ? error.status
          : APICallError.isInstance(error)
            ? error.statusCode
            : undefined;
      const unauthorized = status === 401 || status === 403;
      return { ok: false, reason: unauthorized ? "unauthorized" : "unreachable" };
    }
  }

  /** Ключ провайдера (NFR-16): только запись; null — убрать значение админки (останется .env, если задан). */
  async function setKey(provider: "groq" | "zai", key: string | null): Promise<AiProviders> {
    if (key === null) await secrets.clear(KEYS[provider]);
    else await secrets.set(KEYS[provider], key);
    return providers();
  }

  /** «Запросы к ИИ»: цифры журнала за период. */
  async function usage(period: AiPeriod): Promise<AiUsage> {
    const now = clock.now();
    const since = new Date(now.getTime() - PERIOD_DAYS[period] * DAY_MS);
    const [models, totals, byTask, byModel, windows] = await Promise.all([
      listModels(system),
      usageTotals(system, since),
      usageByTask(system, since),
      usageByModel(system, since),
      usageWindows(system, now),
    ]);
    const known = new Map(models.map((model) => [model.id, model]));
    const providerCloud = new Map(
      [...d.providers.values()].map((adapter) => [adapter.id, adapter.cloud]),
    );
    const byProvider = new Map<
      string,
      { cloud: boolean; requests: number; tokens: number; errors: number }
    >();
    let tokens = 0;
    let cost = 0;
    let cloudRequests = 0;
    let localRequests = 0;
    for (const row of byModel) {
      const record = known.get(`${row.provider}/${row.model}`);
      const cloud = record?.cloud ?? providerCloud.get(row.provider) ?? false;
      const rowTokens = row.inputTokens + row.outputTokens;
      tokens += rowTokens;
      if (record !== undefined) {
        cost += costMicros({ input: row.inputTokens, output: row.outputTokens }, record);
      }
      if (cloud) cloudRequests += row.requests;
      else localRequests += row.requests;
      const sum = byProvider.get(row.provider) ?? { cloud, requests: 0, tokens: 0, errors: 0 };
      byProvider.set(row.provider, {
        cloud: sum.cloud || cloud,
        requests: sum.requests + row.requests,
        tokens: sum.tokens + rowTokens,
        errors: sum.errors + row.errors,
      });
    }
    return {
      period,
      totals: {
        requests: totals.requests,
        tokens,
        costMicros: cost,
        medianMs: totals.medianMs,
        errors: totals.errors,
        errorPermille:
          totals.requests === 0 ? 0 : Math.round((totals.errors * 1000) / totals.requests),
      },
      byTask,
      byProvider: [...byProvider]
        .map(([provider, sum]) => ({ provider, ...sum }))
        .toSorted((a, b) => b.requests - a.requests || a.provider.localeCompare(b.provider)),
      cloudRequests,
      localRequests,
      dailyLimits: models
        .map((model) => {
          const used = windows.get(model.id);
          return {
            id: model.id,
            provider: model.provider,
            requests: { used: used?.requestsDay ?? 0, limit: model.limits.rpd },
            tokens: { used: used?.tokensDay ?? 0, limit: model.limits.tpd },
          };
        })
        .filter(
          (row) =>
            row.requests.limit !== null || row.tokens.limit !== null || row.requests.used > 0,
        ),
      prices: models.map((model) => ({
        id: model.id,
        provider: model.provider,
        model: model.modelId,
        inputMicrosPerMillion: model.inputMicrosPerMillion,
        outputMicrosPerMillion: model.outputMicrosPerMillion,
      })),
      langfuseUrl: d.langfuseUrl,
    };
  }

  /** Прайс-лист (ADM-21): цены записи за миллион токенов; ответ — «Запросы к ИИ» с новой стоимостью. */
  async function setPrice(
    id: string,
    price: { inputMicrosPerMillion: number; outputMicrosPerMillion: number },
    period: AiPeriod = "day",
  ): Promise<AiUsage> {
    if (!(await setModelPrice(system, id, price))) throw new AppError("NOT_FOUND");
    return usage(period);
  }

  return { providers, setChain, enable, saveModel, testConnection, setKey, usage, setPrice };
}

export type LlmAdmin = ReturnType<typeof makeLlmAdmin>;

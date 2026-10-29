// Модуль llm (паспорт — CLAUDE.md): шлюз к моделям — реестр моделей и провайдеров, цепочки по задачам, журнал
// расхода, кассеты, трассы (ARCHITECTURE §8.1). Фасад — LlmGateway.
import {
  defineModule,
  type ModuleDeps,
  type SystemPlatform,
} from "../../platform/module/define-module.ts";
import type { PrivacyFacade } from "../privacy/index.ts";
import type { IdentityFacade } from "../identity/index.ts";
import type { NotificationsFacade } from "../notifications/index.ts";
import { createLlmGateway, type LlmGateway } from "./application/gateway.ts";
import { makeLlmAdmin, type LlmAdmin } from "./application/admin.ts";
import { makePreferences } from "./application/preferences.ts";
import { makeProviderAlerts } from "./application/provider-alerts.ts";
import { makeRetention } from "./application/retention.ts";
import { makeTraceDeletion } from "./application/trace-deletion.ts";
import { llmRouter } from "./api/router.ts";
import { createGroqAdapter } from "./infrastructure/providers/groq.ts";
import {
  createLlamaAdapter,
  createZaiAdapter,
} from "./infrastructure/providers/openai-compatible.ts";
import { createProviderRegistry } from "./infrastructure/providers/providers.ts";
import { createLangfuseTraceDeleter } from "./infrastructure/telemetry/langfuse-traces.ts";
import { createLangfuseTracing } from "./infrastructure/telemetry/langfuse-tracing.ts";
import { createTestProvider } from "./infrastructure/providers/test-provider.ts";
import {
  GROQ_API_KEY,
  LLM_CASSETTE,
  LLM_CASSETTE_DELAYS,
  LLM_LLAMA_BASE_URL,
  LLM_MODE,
  LLM_TIMEOUT_CLOUD_MS,
  LLM_TIMEOUT_LOCAL_MS,
  LLM_TRACE_RETENTION_DAYS,
  LLM_USAGE_RETENTION_DAYS,
  ZAI_API_KEY,
} from "./settings.ts";
import { llmUserData } from "./user-data.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface LlmFacades {
  readonly privacy: PrivacyFacade;
  readonly identity: IdentityFacade;
  readonly notifications: NotificationsFacade;
}

/** Пауза между кусками ответа тестового провайдера: на сайте виден поток (CHAT-02). */
const TEST_PROVIDER_PACE_MS = 300;

export function createLlmModule({ platform, facades }: ModuleDeps<LlmFacades, SystemPlatform>) {
  // ADR-0010: трассы в Langfuse, если корень композиции дал адрес и ключи; иначе шлюз работает без них.
  const { langfuse } = platform.telemetry;
  const tracing = langfuse === undefined ? undefined : createLangfuseTracing(langfuse);
  const preferences = makePreferences(platform);
  const alerts = makeProviderAlerts({
    clock: platform.clock,
    notifications: facades.notifications,
  });
  const providers = createProviderRegistry([
    createTestProvider({ paceMs: TEST_PROVIDER_PACE_MS }),
    // Ключи — секреты (админка или .env), читаются в момент вызова: смена ключа действует сразу (NFR-16).
    createGroqAdapter({ key: async () => platform.secrets.reveal(GROQ_API_KEY) }),
    createZaiAdapter({ key: async () => platform.secrets.reveal(ZAI_API_KEY) }),
    createLlamaAdapter({ baseUrl: async () => platform.settings.get(LLM_LLAMA_BASE_URL) }),
  ]);
  const gateway: LlmGateway = createLlmGateway({
    system: platform.system,
    providers,
    timeouts: async () => ({
      cloudMs: await platform.settings.get(LLM_TIMEOUT_CLOUD_MS),
      localMs: await platform.settings.get(LLM_TIMEOUT_LOCAL_MS),
    }),
    preferredModel: (scope) => preferences.preferredOf(platform.scoped(scope)),
    onProviderEvent: alerts,
    consent: platform.consent,
    telemetry: platform.telemetry,
    ...(tracing === undefined ? {} : { integrations: [tracing.integration] }),
    clock: platform.clock,
    log: platform.log,
    cassettes: async () => {
      const file = await platform.settings.get(LLM_CASSETTE);
      return {
        mode: await platform.settings.get(LLM_MODE),
        delays: await platform.settings.get(LLM_CASSETTE_DELAYS),
        ...(file === "" ? {} : { cassette: { file, scenario: scenarioOf(file) } }),
      };
    },
  });
  const deleter =
    langfuse === undefined
      ? undefined
      : createLangfuseTraceDeleter(langfuse, { clock: platform.clock });
  // PRIV-06: трассы пользователя удаляются вместе с аккаунтом; Langfuse выключен — ждут в очереди повторов.
  const traces = makeTraceDeletion({ platform, deleter });
  const retention = makeRetention({ platform, deleter });
  // Админка ИИ (ADM-20, ADM-50): цифры и настройки без текстов запросов; адрес Langfuse — только на этом компьютере.
  const admin = makeLlmAdmin({ platform, providers, langfuseUrl: langfuse?.baseUrl ?? null });
  return defineModule({
    id: "llm",
    facade: { ...gateway, admin },
    router: llmRouter(preferences),
    settings: [
      LLM_MODE,
      LLM_CASSETTE,
      LLM_CASSETTE_DELAYS,
      LLM_TIMEOUT_CLOUD_MS,
      LLM_TIMEOUT_LOCAL_MS,
      LLM_LLAMA_BASE_URL,
      LLM_USAGE_RETENTION_DAYS,
      LLM_TRACE_RETENTION_DAYS,
    ],
    secrets: [GROQ_API_KEY, ZAI_API_KEY],
    userData: llmUserData(traces),
    schedules: [traces.retrySchedule, retention.usageSchedule, retention.traceSchedule],
    // Остановка процесса досылает накопленные спаны (не дольше таймаута экспорта, 5 с).
    ...(tracing === undefined ? {} : { stop: () => tracing.shutdown() }),
  });
}

/** Сценарий кассеты по пути: `…/modules/chat/application/__cassettes__/accounts.json` → `chat/accounts`. */
export function scenarioOf(file: string): string {
  const match = /modules\/([^/]+)\/(?:.*\/)?__cassettes__\/([^/]+)\.json$/.exec(file);
  return match === null ? file : `${match[1] ?? ""}/${match[2] ?? ""}`;
}

/** Что модуль даёт соседям: шлюз к моделям. */
export type LlmFacade = LlmGateway;

/** Фасад для админки (модуль admin): шлюз и `admin` — цепочки, реестр, ключи, расход; тексты запросов не хранятся. */
export type LlmAdminFacade = LlmFacade & { readonly admin: LlmAdmin };

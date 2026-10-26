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
import { makeTraceDeletion } from "./application/trace-deletion.ts";
import { createProviderRegistry } from "./infrastructure/providers/providers.ts";
import { createLangfuseTraceDeleter } from "./infrastructure/telemetry/langfuse-traces.ts";
import { createLangfuseTracing } from "./infrastructure/telemetry/langfuse-tracing.ts";
import { createTestProvider } from "./infrastructure/providers/test-provider.ts";
import { LLM_CASSETTE, LLM_CASSETTE_DELAYS, LLM_MODE } from "./settings.ts";
import { llmUserData } from "./user-data.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface LlmFacades {
  readonly privacy: PrivacyFacade;
  readonly identity: IdentityFacade;
  readonly notifications: NotificationsFacade;
}

/** Пауза между кусками ответа тестового провайдера: на сайте виден поток (CHAT-02). */
const TEST_PROVIDER_PACE_MS = 300;

export function createLlmModule({ platform }: ModuleDeps<LlmFacades, SystemPlatform>) {
  // ADR-0010: трассы в Langfuse, если корень композиции дал адрес и ключи; иначе шлюз работает без них.
  const { langfuse } = platform.telemetry;
  const tracing = langfuse === undefined ? undefined : createLangfuseTracing(langfuse);
  const gateway: LlmGateway = createLlmGateway({
    system: platform.system,
    providers: createProviderRegistry([createTestProvider({ paceMs: TEST_PROVIDER_PACE_MS })]),
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
  // PRIV-06: трассы пользователя удаляются вместе с аккаунтом; Langfuse выключен — ждут в очереди повторов.
  const traces = makeTraceDeletion({
    platform,
    deleter:
      langfuse === undefined
        ? undefined
        : createLangfuseTraceDeleter(langfuse, { clock: platform.clock }),
  });
  return defineModule({
    id: "llm",
    facade: gateway,
    settings: [LLM_MODE, LLM_CASSETTE, LLM_CASSETTE_DELAYS],
    userData: llmUserData(traces),
    schedules: [traces.retrySchedule],
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

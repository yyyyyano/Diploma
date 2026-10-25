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
import { createProviderRegistry } from "./infrastructure/providers/providers.ts";
import { createTestProvider } from "./infrastructure/providers/test-provider.ts";
import { LLM_CASSETTE, LLM_MODE } from "./settings.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface LlmFacades {
  readonly privacy: PrivacyFacade;
  readonly identity: IdentityFacade;
  readonly notifications: NotificationsFacade;
}

/** Пауза между кусками ответа тестового провайдера: на сайте виден поток (CHAT-02). */
const TEST_PROVIDER_PACE_MS = 300;

export function createLlmModule({ platform }: ModuleDeps<LlmFacades, SystemPlatform>) {
  const gateway: LlmGateway = createLlmGateway({
    system: platform.system,
    providers: createProviderRegistry([createTestProvider({ paceMs: TEST_PROVIDER_PACE_MS })]),
    consent: platform.consent,
    telemetry: platform.telemetry,
    clock: platform.clock,
    log: platform.log,
    cassettes: async () => {
      const file = await platform.settings.get(LLM_CASSETTE);
      return {
        mode: await platform.settings.get(LLM_MODE),
        ...(file === "" ? {} : { cassette: { file, scenario: scenarioOf(file) } }),
      };
    },
  });
  return defineModule({
    id: "llm",
    facade: gateway,
    settings: [LLM_MODE, LLM_CASSETTE],
  });
}

/** Сценарий кассеты по пути: `…/chat/__cassettes__/accounts.json` → `chat/accounts`. */
export function scenarioOf(file: string): string {
  const match = /([^/]+)\/__cassettes__\/([^/]+)\.json$/.exec(file);
  return match === null ? file : `${match[1] ?? ""}/${match[2] ?? ""}`;
}

/** Что модуль даёт соседям: шлюз к моделям. */
export type LlmFacade = LlmGateway;

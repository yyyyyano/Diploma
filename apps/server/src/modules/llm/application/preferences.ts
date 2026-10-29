// Выбор модели пользователем (LLM-10, PRIV-02): список — модели, разрешённые администратором (userSelectable,
// включённые, умеющие чат) и допустимые облачным согласием; облачная модель без согласия не предлагается и не
// принимается. Выбранная, но ставшая недоступной (отозвано согласие, выключена, разрешение снято) показывается как
// «Авто», а шлюз её не использует (его фильтр — buildChain; здесь тот же инвариант для списка).
import type { LlmModelChoice, LlmModels } from "@kosht/contract";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { SystemPlatform } from "../../../platform/module/define-module.ts";
import { TASKS } from "../domain/tasks.ts";
import { listModels } from "../infrastructure/db/llm.repo.ts";
import {
  clearPreferredModel,
  getPreferredModel,
  setPreferredModel,
} from "../infrastructure/db/preferences.repo.ts";

export function makePreferences(d: Pick<SystemPlatform, "system" | "consent">) {
  /** Модели, которые вошедший может выбрать в чате. */
  async function choices(s: ScopedDb): Promise<LlmModelChoice[]> {
    const cloudAllowed = await d.consent.cloudAllowed(s.scope);
    return (await listModels(d.system))
      .filter(
        (model) =>
          model.enabled &&
          model.userSelectable &&
          (cloudAllowed || !model.cloud) &&
          TASKS.chat.every((capability) => model.capabilities.includes(capability)),
      )
      .map((model) => ({
        id: model.id,
        provider: model.provider,
        model: model.modelId,
        cloud: model.cloud,
      }));
  }

  async function view(s: ScopedDb): Promise<LlmModels> {
    const items = await choices(s);
    const chosen = await getPreferredModel(s);
    return { items, selected: items.some((item) => item.id === chosen) ? (chosen ?? null) : null };
  }

  /** Выбрать модель из списка или вернуть «Авто» (null); вне списка — VALIDATION. */
  async function choose(s: ScopedDb, modelId: string | null): Promise<LlmModels> {
    if (modelId === null) {
      await clearPreferredModel(s);
    } else {
      if (!(await choices(s)).some((item) => item.id === modelId)) {
        throw new AppError("VALIDATION");
      }
      await setPreferredModel(s, modelId);
    }
    return view(s);
  }

  return { view, choose, preferredOf: getPreferredModel };
}

export type Preferences = ReturnType<typeof makePreferences>;

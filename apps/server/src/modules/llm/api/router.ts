// Процедуры llm (contract.llm.*): выбор модели пользователем (LLM-10). Тонко: вход контрактом → сценарий.
import { authed } from "../../../platform/http/procedures.ts";
import type { Preferences } from "../application/preferences.ts";

export function llmRouter(uc: Pick<Preferences, "view" | "choose">) {
  return {
    models: authed.llm.models.handler(({ context }) => uc.view(context.s)),
    setPreferredModel: authed.llm.setPreferredModel.handler(({ input, context }) =>
      uc.choose(context.s, input.modelId),
    ),
  };
}

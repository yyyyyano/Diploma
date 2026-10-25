// Цепочка моделей по задаче (LLM-02, LLM-09, PRIV-02, NFR-05): записи реестра с нужными возможностями, по приоритету.
// Инвариант: без облачного согласия (cloudAllowed = false) и для задач «только локально» в цепочке нет ни одной
// облачной записи — это проверяет тест-свойство. Выбранная пользователем модель (LLM-10) идёт первой, если разрешена.
import { TASKS, LOCAL_ONLY_TASKS, type Capability, type LlmTask } from "./tasks.ts";

/** Запись реестра моделей (таблица llm_models). */
export interface ModelRecord {
  /** `<провайдер>/<модель>`: «test/scripted», «groq/llama-3.3-70b». */
  readonly id: string;
  readonly provider: string;
  readonly modelId: string;
  /** Облачная модель: данные уходят за пределы компьютера (PRIV-02). */
  readonly cloud: boolean;
  readonly capabilities: readonly Capability[];
  /** Меньше — раньше в цепочке. */
  readonly priority: number;
  readonly enabled: boolean;
}

export interface ChainOptions {
  readonly cloudAllowed: boolean;
  /** Модель, выбранная пользователем (LLM-10): первой, если подходит и разрешена. */
  readonly preferred?: string;
}

export function buildChain(
  models: readonly ModelRecord[],
  task: LlmTask,
  options: ChainOptions,
): ModelRecord[] {
  const needed: readonly Capability[] = TASKS[task];
  const cloudAllowed = options.cloudAllowed && !LOCAL_ONLY_TASKS.has(task);
  const chain = models
    .filter(
      (m) =>
        m.enabled &&
        (cloudAllowed || !m.cloud) &&
        needed.every((capability) => m.capabilities.includes(capability)),
    )
    .toSorted((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const preferred = chain.find((m) => m.id === options.preferred);
  return preferred === undefined ? chain : [preferred, ...chain.filter((m) => m !== preferred)];
}

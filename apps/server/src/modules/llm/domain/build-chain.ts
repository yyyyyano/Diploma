// Цепочка моделей по задаче (LLM-02, LLM-09, PRIV-02, NFR-05): записи реестра с нужными возможностями. Порядок — из
// настройки задачи в админке (ADM-50, llm_task_chains); у задачи без настройки — по приоритету записей.
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
  /**
   * Порядок цепочки задачи по id записей (llm_task_chains, ADM-50). Нет или пусто — по приоритету. Записи вне порядка
   * в цепочку задачи не входят: администратор собрал её сам.
   */
  readonly order?: readonly string[];
}

export function buildChain(
  models: readonly ModelRecord[],
  task: LlmTask,
  options: ChainOptions,
): ModelRecord[] {
  const needed: readonly Capability[] = TASKS[task];
  const cloudAllowed = options.cloudAllowed && !LOCAL_ONLY_TASKS.has(task);
  const capable = models
    .filter(
      (m) =>
        m.enabled &&
        (cloudAllowed || !m.cloud) &&
        needed.every((capability) => m.capabilities.includes(capability)),
    )
    .toSorted((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const order = options.order ?? [];
  // Порядок задачи собрал администратор: модель вне порядка в цепочку не входит; повтор id в порядке — один раз.
  const chain =
    order.length === 0
      ? capable
      : [...new Set(order)].flatMap((id) => capable.filter((m) => m.id === id));
  // Выбор пользователя (LLM-10): любая подходящая и разрешённая запись, даже если администратор не ставил её в цепочку.
  const preferred = capable.find((m) => m.id === options.preferred);
  return preferred === undefined ? chain : [preferred, ...chain.filter((m) => m !== preferred)];
}

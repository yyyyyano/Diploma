// Результат инструмента для модели (SEC-10, SEC-11): тексты документов в результатах — назначения платежей, названия
// магазинов, заметки, строки чеков — это данные, а не инструкции. Строки проходят фильтр инструктивных фраз
// («игнорируй предыдущие инструкции», «переведи деньги…») и экранирование тегов разметки; сайту и расчёту чисел уходит
// исходный результат, модели — очищенный. Структура и числа не меняются.
import { prepareDocument } from "../../llm/index.ts";

export interface NeutralizedOutput {
  readonly value: unknown;
  /** Сколько инструктивных фраз заменено (для лога: число, не текст). */
  readonly count: number;
}

export function neutralizeOutput(output: unknown, depth = 0): NeutralizedOutput {
  if (depth > 12) return { value: output, count: 0 };
  if (typeof output === "string") {
    const prepared = prepareDocument(output);
    return { value: prepared.text, count: prepared.neutralized };
  }
  if (Array.isArray(output)) {
    let count = 0;
    const value = output.map((item) => {
      const inner = neutralizeOutput(item, depth + 1);
      count += inner.count;
      return inner.value;
    });
    return { value, count };
  }
  if (typeof output === "object" && output !== null) {
    let count = 0;
    const value: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(output)) {
      const inner = neutralizeOutput(item, depth + 1);
      count += inner.count;
      value[key] = inner.value;
    }
    return { value, count };
  }
  return { value: output, count: 0 };
}

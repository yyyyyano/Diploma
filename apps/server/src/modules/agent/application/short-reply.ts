// Ответ пользователя на вопрос ассистента (AGT-06): короткое «да» или текст варианта выбирает вариант `ask_user`.
// Распознаёт код до запуска агента: совпавший вариант записывается фактом без модели (PROF-04), остальное идёт агенту.
import { parseShortAnswer } from "../../actions/index.ts";

export interface AnswerOption {
  readonly label: string;
  readonly value: string;
}

function plain(text: string): string {
  return text
    .toLowerCase()
    .replaceAll("ё", "е")
    .trim()
    .replace(/[\s!.?…)]+$/u, "")
    .replace(/\s+/gu, " ");
}

/**
 * Вариант, который выбрал ответ: точный текст варианта; или «да»/«нет», если ровно один вариант начинается со слова
 * «да» («Да, состоял») или «нет» («Нет»). Не однозначно — undefined: ответ идёт агенту как обычный текст.
 */
export function matchOption(
  reply: string,
  options: readonly AnswerOption[],
): AnswerOption | undefined {
  const text = plain(reply);
  const exact = options.filter((option) => plain(option.label) === text);
  if (exact.length === 1) return exact[0];
  const short = parseShortAnswer(reply);
  if (short === undefined) return undefined;
  const word = short === "yes" ? "да" : "нет";
  const starting = options.filter((option) => {
    const label = plain(option.label);
    return label === word || label.startsWith(`${word} `) || label.startsWith(`${word},`);
  });
  return starting.length === 1 ? starting[0] : undefined;
}

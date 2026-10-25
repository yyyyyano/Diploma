// Кассеты моделей в тестах (ARCHITECTURE §12, QA-17): путь файла и режим. Движок записи и повтора живёт в шлюзе llm
// (боевому коду нельзя @kosht/testing); здесь — то, что нужно тесту, чтобы выбрать кассету и режим. Обычный прогон —
// replay (промах — ошибка с подсказкой, сети нет); `make ai-record SCENARIO=<сценарий>` ставит AI_RECORD, и тесты этого
// сценария пишут кассету заново. Для тестов без кассет — MockLanguageModelV4 из AI SDK.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export { MockLanguageModelV4 } from "ai/test";

/** Сценарий кассеты: `<модуль>/<имя>` латиницей (`chat/accounts`). */
const SCENARIO = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/;

/** Файл кассеты сценария рядом с тестом: `<папка теста>/__cassettes__/<имя>.json`. */
export function cassetteFile(testFile: string, scenario: string): string {
  if (!SCENARIO.test(scenario)) {
    throw new RangeError(`Сценарий кассеты «${scenario}»: ожидается <модуль>/<имя>.`);
  }
  const dir = testFile.startsWith("file:") ? dirname(fileURLToPath(testFile)) : dirname(testFile);
  return join(dir, "__cassettes__", `${scenario.split("/")[1] ?? scenario}.json`);
}

/** record — если make ai-record назвал этот сценарий (AI_RECORD: имя, список через запятую или «*»), иначе replay. */
export function cassetteMode(
  scenario: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): "record" | "replay" {
  const wanted = (env["AI_RECORD"] ?? "").split(",").map((item) => item.trim());
  return wanted.includes(scenario) || wanted.includes("*") ? "record" : "replay";
}

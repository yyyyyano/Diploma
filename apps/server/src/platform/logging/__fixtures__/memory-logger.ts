// Логгер в память для тестов платформы: строки — как в файле (тот же createLogger), текст целиком — для канареек.
import { createLogger, type Logger } from "../logger.ts";

export interface MemoryLog {
  readonly log: Logger;
  /** Разобранные строки. */
  lines(): Record<string, unknown>[];
  /** Всё, что записано, одной строкой. */
  text(): string;
}

export function memoryLogger(): MemoryLog {
  const chunks: string[] = [];
  const log = createLogger({
    role: "api",
    level: "trace",
    destination: { write: (chunk: string) => void chunks.push(chunk) },
  });
  return {
    log,
    lines: () => chunks.map((chunk) => JSON.parse(chunk) as Record<string, unknown>),
    text: () => chunks.join(""),
  };
}

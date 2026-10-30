// robots.txt с шаблонами `*` (LAW-37, ADR-0012): тонкая обёртка над robots-parser 3.0.1. Его index.d.ts объявляет
// `export default`, а пакет — CommonJS с module.exports = функция, поэтому под nodenext TypeScript видит пространство имён,
// а не функцию. Рантайм проверен (default-импорт даёт функцию, polite-fetcher.test.ts и КП LAW), тип задан здесь один раз.
import parserModule from "robots-parser";

interface RobotsRules {
  isAllowed(url: string, userAgent?: string): boolean | undefined;
}

const parse = parserModule as unknown as (robotsUrl: string, text: string) => RobotsRules;

/** Правила сайта по тексту robots.txt; пустой текст — всё разрешено. */
export function parseRobots(robotsUrl: string, text: string): RobotsRules {
  return parse(robotsUrl, text);
}

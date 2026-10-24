// Конфигурация dependency-cruiser (make deps-check). Правила не хранятся здесь копией: они собираются из карты
// модулей tooling/architecture/modules.ts при каждой загрузке (tooling/architecture/rules.ts, ADR-0003).
import { buildConfig } from "./tooling/architecture/rules.ts";

export default buildConfig();

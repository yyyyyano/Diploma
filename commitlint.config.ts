// Правила сообщений коммитов (ADR-0001, CONSTRAINTS.md «Коммиты», корневой CLAUDE.md «Git»).
import { RuleConfigSeverity, type UserConfig } from "@commitlint/types";

// Служебные области из корневого CLAUDE.md «Git»; id модулей добавит T-002 (генерация из modules.ts).
export const SERVICE_SCOPES = [
  "web",
  "server",
  "kernel",
  "calc",
  "contract",
  "i18n",
  "testing",
  "e2e",
  "tooling",
  "docker",
  "docs",
  "deps",
  "plan",
];

export const COMMIT_TYPES = [
  "feat",
  "fix",
  "refactor",
  "test",
  "docs",
  "chore",
  "perf",
  "build",
  "style",
  "revert",
];

const config: UserConfig = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [RuleConfigSeverity.Error, "always", COMMIT_TYPES],
    // Длина считается в символах, а не байтах: русский заголовок в 72 символа проходит.
    "header-max-length": [RuleConfigSeverity.Error, "always", 72],
    // «fix: ok» — не описание изменения.
    "header-min-length": [RuleConfigSeverity.Error, "always", 15],
    // Темы по-русски: регистр для них не имеет смысла.
    "subject-case": [RuleConfigSeverity.Disabled],
    // Область необязательна; указанная — только из списка.
    "scope-enum": [RuleConfigSeverity.Error, "always", SERVICE_SCOPES],
  },
};

export default config;

// Правила сообщений коммитов (ADR-0001, CONSTRAINTS.md «Коммиты», корневой CLAUDE.md «Git»).
import { RuleConfigSeverity, type UserConfig } from "@commitlint/types";
import { commitScopes } from "./tooling/architecture/commit-scopes.ts";

// Области: id модулей из tooling/architecture/modules.ts + служебные области корневого CLAUDE.md «Git».
export const SCOPES = commitScopes();

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
    "scope-enum": [RuleConfigSeverity.Error, "always", SCOPES],
  },
};

export default config;

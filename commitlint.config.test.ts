// Правила commitlint.config.ts (ADR-0001, CONSTRAINTS.md «Коммиты»): проверяем наш конфиг, а не сам commitlint.
import lint from "@commitlint/lint";
import load from "@commitlint/load";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL(".", import.meta.url));

async function check(message: string) {
  const config = await load({}, { cwd: root });
  const result = await lint(message, config.rules, {
    defaultIgnores: config.defaultIgnores ?? true,
    ...(config.parserPreset?.parserOpts === undefined
      ? {}
      : { parserOpts: config.parserPreset.parserOpts as Record<string, unknown> }),
  });
  return { valid: result.valid, rules: result.errors.map((error) => error.name) };
}

describe("commitlint: формат сообщения коммита", () => {
  it("русский заголовок с областью модуля проходит", async () => {
    expect(await check("feat(tooling): проверять размер коммита в хуке")).toEqual({
      valid: true,
      rules: [],
    });
  });

  it("область необязательна", async () => {
    expect((await check("chore: подготовить каркас монорепозитория")).valid).toBe(true);
  });

  it("служебная область plan разрешена для коммитов дирижёра", async () => {
    expect((await check("docs(plan): отметить задачу T-001 выполненной")).valid).toBe(true);
  });

  it("русский заголовок ровно из 72 символов проходит — длина в символах, не в байтах", async () => {
    const header = "fix: " + "я".repeat(67);
    expect(header).toHaveLength(72);
    expect((await check(header)).valid).toBe(true);
  });

  it("заголовок из 80 символов отклоняется правилом header-max-length", async () => {
    const header = "fix: " + "я".repeat(75);
    expect(header).toHaveLength(80);
    expect(await check(header)).toEqual({ valid: false, rules: ["header-max-length"] });
  });

  it("заголовок короче 15 символов отклоняется", async () => {
    expect(await check("fix: ok")).toEqual({ valid: false, rules: ["header-min-length"] });
  });

  it("неизвестная область отклоняется правилом scope-enum", async () => {
    expect(await check("feat(nowhere): добавить что-то полезное")).toEqual({
      valid: false,
      rules: ["scope-enum"],
    });
  });

  it("тип ci не входит в список типов проекта", async () => {
    expect(await check("ci: настроить сборку в облаке")).toEqual({
      valid: false,
      rules: ["type-enum"],
    });
  });

  it("сообщение без типа отклоняется", async () => {
    expect((await check("правки по замечаниям ревьюера")).valid).toBe(false);
  });
});

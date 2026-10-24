// Правила границ dependency-cruiser (ADR-0002, ADR-0003, CONSTRAINTS.md «Архитектурные запреты»): состав
// правил выводится из карты модулей, а запреты библиотек узнают пакет в обеих раскладках путей — по имени из
// импорта (пакет не установлен) и по пути pnpm (node_modules/.pnpm/…/node_modules/<пакет>/).
import { describe, expect, it } from "vitest";
import { MODULES } from "./modules.ts";
import {
  EXCLUDE,
  buildConfig,
  buildForbiddenRules,
  npmPattern,
  type ForbiddenRule,
} from "./rules.ts";

const rules = buildForbiddenRules(MODULES);

function ruleNamed(name: string): ForbiddenRule {
  const found = rules.find((r) => r.name === name);
  if (found === undefined) throw new Error(`нет правила ${name}`);
  return found;
}

function matches(pattern: string, path: string): boolean {
  return new RegExp(pattern).test(path);
}

describe("состав правил", () => {
  it("на каждый модуль — своё правило deps-of-<id>", () => {
    const names = new Set(rules.map((r) => r.name));
    expect(MODULES.filter((m) => !names.has(`deps-of-${m.id}`)).map((m) => m.id)).toEqual([]);
  });

  it("правило яруса есть для каждого яруса, над которым есть модули", () => {
    const names = rules.map((r) => r.name).filter((n) => n.startsWith("tier-"));
    expect([...new Set(names)]).toEqual([
      "tier-1-no-upward",
      "tier-2-no-upward",
      "tier-3-no-upward",
    ]);
  });

  it("все правила — ошибки, у каждого есть пояснение «что исправить»", () => {
    expect(rules.filter((r) => r.severity !== "error" || r.comment.length < 20)).toEqual([]);
  });

  it("deps-of-<id> разрешает только свой модуль и модули из dependsOn", () => {
    const rule = ruleNamed("deps-of-receipts");
    const notAllowed = String(rule.to.pathNot);
    const base = "apps/server/src/modules";
    expect(matches(notAllowed, `${base}/transactions/index.ts`)).toBe(true);
    expect(matches(notAllowed, `${base}/receipts/domain/x.ts`)).toBe(true);
    expect(matches(notAllowed, `${base}/budgets/index.ts`)).toBe(false);
  });

  it("deps-of-<id> не путает модуль с другим, чьё имя начинается так же (legal-base и legal-consult)", () => {
    const notAllowed = String(ruleNamed("deps-of-legal-consult").to.pathNot);
    expect(matches(notAllowed, "apps/server/src/modules/legal-base/index.ts")).toBe(true);
    expect(matches(notAllowed, "apps/server/src/modules/legal/index.ts")).toBe(false);
  });

  it("system-db-only-for-flagged-modules не мешает модулям с таблицами system или public", () => {
    const from = String(ruleNamed("system-db-only-for-flagged-modules").from.path);
    expect(matches(from, "apps/server/src/modules/fin/application/x.ts")).toBe(true);
    expect(matches(from, "apps/server/src/modules/admin/application/x.ts")).toBe(true);
    expect(matches(from, "apps/server/src/modules/mail/application/x.ts")).toBe(false);
    expect(matches(from, "apps/server/src/modules/fx-rates/application/x.ts")).toBe(false);
  });
});

describe("npmPattern — запреты библиотек в обеих раскладках путей", () => {
  it.each([
    ["drizzle-orm", "drizzle-orm"],
    ["drizzle-orm", "drizzle-orm/pg-core"],
    ["drizzle-orm", "node_modules/drizzle-orm/index.js"],
    [
      "drizzle-orm",
      "node_modules/.pnpm/drizzle-orm@1.0.0-rc.1_pg@8.16.3/node_modules/drizzle-orm/index.js",
    ],
    ["pg", "pg"],
    ["pg", "node_modules/.pnpm/pg@8.16.3/node_modules/pg/lib/index.js"],
    ["pg", "node_modules/.pnpm/@types+pg@8.15.5/node_modules/@types/pg/index.d.ts"],
    ["pg-boss", "node_modules/.pnpm/pg-boss@12.0.0/node_modules/pg-boss/dist/index.js"],
    ["ai", "ai"],
    ["ai", "node_modules/.pnpm/ai@7.0.0_zod@4.1.0/node_modules/ai/dist/index.mjs"],
    ["@ai-sdk/*", "@ai-sdk/groq"],
    ["@ai-sdk/*", "node_modules/.pnpm/@ai-sdk+groq@3.0.0/node_modules/@ai-sdk/groq/dist/index.mjs"],
    ["@orpc/server", "@orpc/server/fetch"],
    [
      "@orpc/server",
      "node_modules/.pnpm/@orpc+server@1.16.0/node_modules/@orpc/server/dist/index.mjs",
    ],
    ["grammy", "node_modules/.pnpm/grammy@1.38.0/node_modules/grammy/out/mod.js"],
  ])("%s узнаётся в «%s»", (pkg, path) => {
    expect(matches(npmPattern([pkg]), path)).toBe(true);
  });

  it.each([
    ["pg", "pg-boss"],
    ["pg", "node_modules/.pnpm/pg-boss@12.0.0/node_modules/pg-boss/dist/index.js"],
    ["drizzle-orm", "drizzle-kit"],
    ["drizzle-orm", "node_modules/.pnpm/drizzle-kit@1.0.0/node_modules/drizzle-kit/index.js"],
    ["ai", "node_modules/.pnpm/ai@7.0.0/node_modules/aider/index.js"],
    ["ai", "apps/server/src/modules/agent/ai/x.ts"],
    ["@ai-sdk/*", "@ai-sdkx/groq"],
    [
      "@orpc/server",
      "node_modules/.pnpm/@orpc+contract@1.16.0/node_modules/@orpc/contract/dist/index.mjs",
    ],
    ["@orpc/server", "@orpc/client"],
  ])("%s не путается с «%s»", (pkg, path) => {
    expect(matches(npmPattern([pkg]), path)).toBe(false);
  });
});

describe("buildConfig", () => {
  it("фикстуры нарушений исключены из обхода — иначе make deps-check был бы всегда красным", () => {
    const exclude: readonly string[] = EXCLUDE;
    expect(exclude.some((p) => matches(p, "tooling/architecture/fixtures/clean/apps/x.ts"))).toBe(
      true,
    );
    expect(exclude.some((p) => matches(p, "tooling/architecture/rules.ts"))).toBe(false);
  });

  it("dependency-cruiser читает TypeScript парсером tsc и видит импорты только типов", () => {
    expect(buildConfig().options).toMatchObject({ parser: "tsc", tsPreCompilationDeps: true });
  });
});

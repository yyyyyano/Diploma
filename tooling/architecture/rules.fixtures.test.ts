// «Каждое правило ловит своё» (ADR-0003, ARCHITECTURE §15): правило запускается в одиночку
// (forbidden: [правило]) на своей фикстуре нарушения, и нарушения должны совпасть с ожидаемыми рёбрами —
// ни одного лишнего, ни одного пропущенного. Чистая фикстура проходит все правила разом.
// Фикстуры лежат в fixtures/<имя>/ с раскладкой репозитория (apps/…, packages/…), обход идёт с baseDir в корне
// фикстуры — иначе правила с путями ^apps/server/… ничего бы в ней не нашли и тест прошёл бы вхолостую.
// Пакеты npm в фикстурах не установлены: импорт разрешается в своё имя (`drizzle-orm`), а раскладку pnpm
// проверяют регэкспы в rules.test.ts и обход настоящего пакета ниже.
import { cruise, type ICruiseResult } from "dependency-cruiser";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { MODULES, type ModuleDef } from "./modules.ts";
import {
  ROOTS,
  buildForbiddenRules,
  cruiseOptions,
  npmPattern,
  type ForbiddenRule,
} from "./rules.ts";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const allRules = buildForbiddenRules(MODULES);

// Правила, чьи фикстуры строятся из карты модулей во временной папке (по одной на модуль и ярус).
const GENERATED = /^(deps-of-.+|tier-\d-no-upward)$/;

const M = "apps/server/src/modules";
const P = "apps/server/src/platform";
const W = "apps/web/src";

/** Нарушения: «правило: откуда → куда», по алфавиту. */
async function violations(baseDir: string, rules: ForbiddenRule[]): Promise<string[]> {
  const roots = ROOTS.filter((root) => existsSync(join(baseDir, root)));
  const result = await cruise(roots, {
    ...cruiseOptions(),
    baseDir,
    validate: true,
    ruleSet: { forbidden: rules },
  });
  const output = result.output as ICruiseResult;
  return output.summary.violations.map((v) => `${v.rule.name}: ${v.from} → ${v.to}`).toSorted();
}

function rulesNamed(name: string): ForbiddenRule[] {
  return allRules.filter((r) => r.name === name);
}

// Ожидаемые нарушения каждой статической фикстуры fixtures/rules/<правило>/. Рядом в фикстуре — разрешённые
// «почти нарушения» (свой модуль, index.ts соседа, *.sweep.ts, тесты), которых в списке быть не должно.
const EXPECTED: Record<string, string[]> = {
  // Цикл сообщается один раз — первым ребром обхода.
  "no-circular": [`${P}/clock/a.ts → ${P}/clock/b.ts`],
  "not-to-unresolvable": ["tooling/x/use.ts → ./missing.ts"],
  "module-public-api-only": [
    `${M}/receipts/application/use.ts → ${M}/transactions/domain/money.ts`,
  ],
  "domain-is-pure": [
    `${M}/receipts/domain/status.ts → ${M}/receipts/application/x.ts`,
    `${M}/receipts/domain/status.ts → ${P}/clock/clock.ts`,
  ],
  "api-thin": [
    `${M}/receipts/agent/tools.ts → ${M}/receipts/infrastructure/db/schema.ts`,
    `${M}/receipts/api/router.ts → ${M}/receipts/infrastructure/db/receipts.repo.ts`,
  ],
  "infrastructure-not-to-application": [
    `${M}/receipts/infrastructure/db/receipts.repo.ts → ${M}/receipts/api/router.ts`,
    `${M}/receipts/infrastructure/qr/zxing.ts → ${M}/receipts/application/recognize.ts`,
  ],
  "platform-not-to-modules": [`${P}/jobs/define-job.ts → ${M}/receipts/index.ts`],
  "server-not-to-web": [`apps/server/src/main/compose.ts → ${W}/lib/api.ts`],
  "web-not-to-server": [`${W}/lib/api.ts → apps/server/src/main/router.ts`],
  "web-only-shared-packages": [`${W}/features/dashboard/page.tsx → packages/calc/src/index.ts`],
  "web-layers-down": [
    `${W}/entities/account/card.tsx → ${W}/features/dashboard/page.tsx`,
    `${W}/features/dashboard/page.tsx → ${W}/routes/index.tsx`,
    `${W}/lib/api.ts → ${W}/ui/money.tsx`,
    `${W}/routes/index.tsx → ${W}/app/providers.tsx`,
    `${W}/ui/money.tsx → ${W}/entities/account/index.ts`,
  ],
  "web-feature-isolation": [`${W}/features/dashboard/page.tsx → ${W}/features/operations/index.ts`],
  "web-routes-thin": [
    `${W}/routes/operations.tsx → ${W}/entities/transaction/index.ts`,
    `${W}/routes/operations.tsx → ${W}/features/operations/page.tsx`,
    `${W}/routes/operations.tsx → ${W}/ui/money.tsx`,
  ],
  "ui-is-presentational": [
    `${W}/ui/components/money.tsx → ${W}/lib/api.ts`,
    `${W}/ui/components/money.tsx → ${W}/lib/events/stream.ts`,
    `${W}/ui/components/money.tsx → @tanstack/react-query`,
  ],
  "calc-only-kernel": [
    "packages/calc/src/free-balance.ts → date-fns",
    "packages/calc/src/free-balance.ts → fs",
  ],
  "kernel-only-zod": ["packages/kernel/src/money.ts → date-fns"],
  "contract-allowed-deps": [
    `packages/contract/src/receipts.ts → ${P}/http/procedures.ts`,
    "packages/contract/src/receipts.ts → @orpc/server",
  ],
  "i18n-allowed-deps": [
    "packages/i18n/src/format.ts → apps/web/src/main.ts",
    "packages/i18n/src/format.ts → date-fns",
    "packages/i18n/src/format.ts → packages/calc/src/index.ts",
  ],
  "testing-not-in-prod": [
    `${M}/receipts/application/recognize.ts → ${M}/receipts/__fixtures__/receipt.ts`,
    `${M}/receipts/application/recognize.ts → packages/testing/src/index.ts`,
  ],
  "schema-only-in-infrastructure": [
    `apps/server/src/main/compose.ts → ${M}/receipts/infrastructure/db/schema.ts`,
    `apps/server/src/main/compose.ts → ${P}/settings/schema.ts`,
    `${P}/secrets/secrets.repo.ts → ${P}/settings/schema.ts`,
    `${M}/receipts/application/recognize.ts → ${M}/receipts/infrastructure/db/schema.ts`,
    `${M}/receipts/infrastructure/db/receipts.repo.ts → ${M}/transactions/infrastructure/db/schema.ts`,
  ],
  "no-cross-module-repo": [
    `apps/server/src/main/compose.ts → ${M}/receipts/infrastructure/db/receipts.sql.ts`,
    `${M}/receipts/application/recognize.ts → ${M}/transactions/infrastructure/db/transactions.repo.ts`,
    `${M}/receipts/index.ts → ${M}/receipts/infrastructure/db/receipts.repo.ts`,
  ],
  "no-unsafe-db": [`${M}/receipts/infrastructure/db/receipts.repo.ts → ${P}/db/unsafe-raw.ts`],
  "db-internals-only-in-platform-db": [
    `apps/server/src/main/compose.ts → ${P}/db/audited.ts`,
    `${M}/receipts/infrastructure/db/receipts.repo.ts → ${P}/db/audit.ts`,
    `${M}/receipts/infrastructure/db/receipts.repo.ts → ${P}/db/audited.ts`,
    `${P}/jobs/define-job.ts → ${P}/db/connection.ts`,
  ],
  "cross-tenant-only-in-sweeps": [
    `${M}/calendar/infrastructure/db/reminders.repo.ts → ${P}/db/cross-tenant.ts`,
    `${M}/calendar/jobs/remind.job.ts → ${P}/db/cross-tenant.ts`,
  ],
  "boss-db-only-in-jobs": [
    `${M}/receipts/application/recognize.ts → ${P}/db/boss-db.ts`,
    `${P}/events/events.ts → ${P}/db/boss-db.ts`,
  ],
  "system-db-only-for-flagged-modules": [
    `${M}/files/infrastructure/db/files.repo.ts → ${P}/db/system-db.ts`,
    `${M}/fin/application/balance.ts → ${P}/db/system-db.ts`,
  ],
  "admin-no-user-data": [
    `${M}/admin/application/users.ts → ${M}/admin/infrastructure/db/schema.ts`,
    `${M}/admin/application/users.ts → ${M}/identity/application/list-users.ts`,
  ],
  "ai-sdk-only-in-llm": [`${M}/agent/application/run.ts → @ai-sdk/openai-compatible`],
  "ai-only-in-llm-agent-chat": [`${M}/receipts/application/recognize.ts → ai`],
  "otel-only-in-llm-telemetry": [
    `${M}/agent/application/run.ts → @opentelemetry/api`,
    `${P}/telemetry/telemetry.ts → @langfuse/otel`,
  ],
  "sharp-only-in-llm-images": [`${M}/receipts/application/recognize.ts → sharp`],
  "transformers-only-in-llm-masking": [`${M}/agent/application/run.ts → @huggingface/transformers`],
  "ai-only-in-web-assistant": [
    `${W}/features/accounts/AccountsPage.tsx → @ai-sdk/react`,
    `${W}/features/accounts/AccountsPage.tsx → ai`,
  ],
  "pg-boss-only-in-platform-jobs": [`${M}/receipts/jobs/recognize.job.ts → pg-boss`],
  "libpg-query-only-in-platform-db": [
    `${M}/receipts/infrastructure/db/receipts.repo.ts → libpg-query`,
  ],
  "grammy-only-in-telegram-infrastructure": [
    `${M}/telegram/application/send.ts → @grammyjs/runner`,
    `${M}/telegram/application/send.ts → grammy`,
  ],
  "better-auth-only-in-identity-infrastructure": [
    `${M}/identity/application/sign-in.ts → better-auth`,
    `${M}/identity/application/sign-in.ts → better-auth/adapters/drizzle`,
  ],
  "nodemailer-only-in-mail-infrastructure": [`${M}/identity/application/sign-up.ts → nodemailer`],
  "drizzle-and-pg-only-in-db": [
    `${M}/receipts/application/recognize.ts → drizzle-orm/pg-core`,
    `${P}/jobs/jobs.ts → drizzle-orm`,
    `${P}/settings/settings.ts → drizzle-orm`,
    "packages/testing/src/factories.ts → pg",
  ],
  "orpc-server-only-in-api": [
    `${M}/receipts/application/get-receipt.ts → @orpc/server`,
    `${M}/receipts/application/serve-openapi.ts → @orpc/openapi`,
  ],
};

const staticNames = [...new Set(allRules.map((r) => r.name))].filter((n) => !GENERATED.test(n));

describe("у каждого правила есть фикстура нарушения", () => {
  it("каждое правило — со своей статической фикстурой или строится из карты модулей", () => {
    const missing = staticNames.filter(
      (name) => EXPECTED[name] === undefined || !existsSync(join(fixtures, "rules", name)),
    );
    expect(missing).toEqual([]);
  });

  it("нет фикстур и ожиданий для правил, которых больше нет", () => {
    const stale = [...readdirSync(join(fixtures, "rules")), ...Object.keys(EXPECTED)].filter(
      (name) => !staticNames.includes(name),
    );
    expect(stale).toEqual([]);
  });
});

describe("правило ловит своё на фикстуре нарушения", () => {
  it.each(staticNames)("%s", async (name) => {
    const found = await violations(join(fixtures, "rules", name), rulesNamed(name));
    expect(found).toEqual((EXPECTED[name] ?? []).map((edge) => `${name}: ${edge}`).toSorted());
  });
});

describe("чистая фикстура", () => {
  it("проходит все правила разом: разрешённые связи не считаются нарушениями", async () => {
    expect(await violations(join(fixtures, "clean"), allRules)).toEqual([]);
  });
});

// Фикстуры deps-of-<id> и tier-<n>-no-upward строятся из карты: по одной на модуль и ярус.
describe("правила из карты модулей ловят своё", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  function materialize(files: Record<string, string[]>): string {
    const dir = mkdtempSync(join(tmpdir(), "kosht-rules-"));
    dirs.push(dir);
    const all = new Set([...Object.keys(files), ...Object.values(files).flat()]);
    for (const file of all) {
      const full = join(dir, file);
      mkdirSync(dirname(full), { recursive: true });
      const imports = (files[file] ?? []).map((target) => {
        const spec = relative(dirname(full), join(dir, target));
        return `import "${spec.startsWith(".") ? spec : `./${spec}`}";\n`;
      });
      writeFileSync(full, `${imports.join("")}export {};\n`);
    }
    return dir;
  }

  function moduleById(id: string): ModuleDef {
    const found = MODULES.find((m) => m.id === id);
    if (found === undefined) throw new Error(`нет модуля ${id}`);
    return found;
  }

  it.each(MODULES.map((m) => m.id))("deps-of-%s", async (id) => {
    const m = moduleById(id);
    const forbiddenDep = MODULES.find(
      (other) => other.id !== id && !m.dependsOn.includes(other.id),
    );
    if (forbiddenDep === undefined) throw new Error(`${id} зависит от всех — нечего запрещать`);
    const user = `${M}/${id}/application/use.ts`;
    const dir = materialize({
      [user]: [
        `${M}/${id}/domain/own.ts`,
        ...m.dependsOn.map((dep) => `${M}/${dep}/index.ts`),
        `${M}/${forbiddenDep.id}/index.ts`,
      ],
    });
    expect(await violations(dir, rulesNamed(`deps-of-${id}`))).toEqual([
      `deps-of-${id}: ${user} → ${M}/${forbiddenDep.id}/index.ts`,
    ]);
  });

  const tiers = [...new Set(allRules.map((r) => r.name).filter((n) => n.startsWith("tier-")))];

  it.each(tiers)("%s", async (name) => {
    const tier = Number(/^tier-(\d)/.exec(name)?.[1]);
    const low = MODULES.find((m) => m.tier === tier);
    const high = MODULES.find((m) => m.tier === tier + 1);
    const same = MODULES.filter((m) => m.tier === tier).at(-1);
    if (low === undefined || high === undefined || same === undefined) {
      throw new Error(`нет модулей для яруса ${tier}`);
    }
    const user = `${M}/${low.id}/application/use.ts`;
    const dir = materialize({
      [user]: [`${M}/${high.id}/index.ts`, `${M}/${same.id}/index.ts`],
    });
    expect(await violations(dir, rulesNamed(name))).toEqual([
      `${name}: ${user} → ${M}/${high.id}/index.ts`,
    ]);
  });
});

/**
 * Интеграционный обход всего репозитория dependency-cruiser (как make deps-check), а не юнит на фикстуре: один
 * занимает ~0,5 с, под make check с десятками процессов тестов — дольше 5 с по умолчанию. Срок — с запасом на такую
 * нагрузку; зависший обход всё равно упадёт по нему.
 */
const REPO_WALK_TIMEOUT_MS = 60_000;

describe("запрет библиотеки на настоящем пакете из node_modules (раскладка pnpm)", () => {
  it(
    "импорт установленного пакета остаётся в графе с путём .pnpm, и запрет по npmPattern его ловит",
    { timeout: REPO_WALK_TIMEOUT_MS },
    async () => {
      // Тот же обход, что у make deps-check, на настоящем файле репозитория: vitest установлен через pnpm.
      // Если настройки обхода выкинут пакеты из графа (exclude node_modules или dist/), запреты библиотек
      // в реальном коде молча перестанут работать — этот тест покраснеет.
      const probe: ForbiddenRule = {
        name: "probe-vitest",
        severity: "error",
        comment: "проверка раскладки pnpm",
        from: {},
        to: { path: npmPattern(["vitest"]) },
      };
      const found = await violations(repoRoot, [probe]).then((list) =>
        list.filter((v) => v.startsWith("probe-vitest: tooling/architecture/modules.test.ts → ")),
      );
      expect(found).toHaveLength(1);
      expect(found[0]).toMatch(/→ node_modules\/\.pnpm\/vitest@[^/]+\/node_modules\/vitest\//);
    },
  );
});

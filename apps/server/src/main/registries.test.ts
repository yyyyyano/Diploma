// ARCHITECTURE §3, §5: корень композиции раскладывает части модулей по реестрам. Реестры работают и на пустых
// списках (все 36 модулей пока пустые), а повторное имя — ошибка при старте, а не тихая подмена.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fxReceipts } from "../platform/db/__fixtures__/schema.ts";
import { defineUserData } from "../platform/db/user-data.ts";
import { defineEvent } from "../platform/events/define-event.ts";
import { defineSubscription } from "../platform/events/define-subscription.ts";
import { defineJob } from "../platform/jobs/define-job.ts";
import { defineSweep } from "../platform/jobs/sweep.ts";
import { defineModule } from "../platform/module/define-module.ts";
import { defineRateRule } from "../platform/rate-limit/rate-limit.ts";
import type { SecretDef } from "../platform/secrets/secrets.ts";
import type { SettingDef } from "../platform/settings/settings.ts";
import { defineTool } from "../platform/tools/define-tool.ts";
import { buildRegistries, RegistryError } from "./registries.ts";

const noop = async () => {};
const ids = z.object({ ids: z.array(z.string()) });

function tool(name: string) {
  return defineTool({
    name,
    toolset: "core",
    kind: "read",
    description: "Test tool.",
    input: z.object({}),
    output: z.object({}),
    execute: async () => ({}),
  });
}

describe("реестры на пустых модулях", () => {
  it("модули без частей — пустые реестры и пустое дерево веток", () => {
    const registries = buildRegistries([
      defineModule({ id: "files" }),
      defineModule({ id: "fx-rates" }),
    ]);
    expect(registries.routers).toEqual({});
    expect(registries.jobs).toEqual([]);
    expect(registries.subscriptions).toEqual([]);
    expect(registries.schedules).toEqual([]);
    expect(registries.sweeps).toEqual([]);
    for (const map of [
      registries.events,
      registries.tools,
      registries.deliveryChannels,
      registries.undo,
      registries.confirm,
      registries.userData,
      registries.settings,
      registries.secrets,
      registries.rateRules,
    ]) {
      expect(map.size).toBe(0);
    }
  });

  it("ветка роутера — под id модуля в camelCase; пустая ветка допустима", () => {
    const registries = buildRegistries([defineModule({ id: "legal-base", router: {} })]);
    expect(registries.routers).toEqual({ legalBase: {} });
  });
});

describe("части модулей попадают в свои реестры", () => {
  it("задачи модулей и задачи подписок — в один список очередей", () => {
    const changed = defineEvent({ name: "transactions.changed", payload: ids });
    const recheck = defineJob({ name: "budgets.recheck", payload: z.object({}), handle: noop });
    const registries = buildRegistries([
      defineModule({ id: "transactions", events: [changed] }),
      defineModule({
        id: "budgets",
        jobs: [recheck],
        subscriptions: [defineSubscription({ event: changed, module: "budgets", handle: noop })],
      }),
    ]);
    expect(registries.jobs.map((job) => job.name)).toEqual([
      "budgets.recheck",
      "evt.transactions.changed.budgets",
    ]);
    expect([...registries.events.keys()]).toEqual(["transactions.changed"]);
  });

  it("владелец данных — по id модуля (PRIV-06)", () => {
    const userData = defineUserData({ tables: [fxReceipts] });
    const registries = buildRegistries([defineModule({ id: "receipts", userData })]);
    expect(registries.userData.get("receipts")).toBe(userData);
  });
});

describe("повторное имя — ошибка при старте", () => {
  it("один модуль дважды", () => {
    expect(() =>
      buildRegistries([defineModule({ id: "files" }), defineModule({ id: "files" })]),
    ).toThrow(RegistryError);
  });

  it("инструмент с тем же именем в двух модулях — ошибка с именем и модулями", () => {
    const build = () =>
      buildRegistries([
        defineModule({ id: "transactions", tools: [tool("search")] }),
        defineModule({ id: "receipts", tools: [tool("search")] }),
      ]);
    expect(build).toThrow(/search.*transactions.*receipts/);
  });

  it("очередь обхода с именем задачи — ошибка; задача обхода, объявленная и в jobs, — нет", () => {
    const remind = defineJob({ name: "calendar.remind", payload: z.object({}), handle: noop });
    const sweep = defineSweep({
      name: "calendar.tick",
      cron: "* * * * *",
      find: () => {
        throw new Error("не вызывается");
      },
      job: remind,
      payload: () => ({}),
    });
    expect(() =>
      buildRegistries([defineModule({ id: "calendar", jobs: [remind], sweeps: [sweep] })]),
    ).not.toThrow();
    const clash = defineJob({ name: "calendar.tick", payload: z.object({}), handle: noop });
    expect(() =>
      buildRegistries([defineModule({ id: "calendar", jobs: [clash], sweeps: [sweep] })]),
    ).toThrow(/calendar\.tick/);
  });

  it("одна пользовательская таблица у двух владельцев данных", () => {
    const userData = defineUserData({ tables: [fxReceipts] });
    const build = () =>
      buildRegistries([
        defineModule({ id: "receipts", userData }),
        defineModule({ id: "files", userData }),
      ]);
    expect(build).toThrow(/fx_receipts/);
  });

  it("правило частоты с тем же именем — общие счётчики, поэтому ошибка", () => {
    const rule = defineRateRule({ name: "auth.login", limit: 5, windowMs: 60_000 });
    const build = () =>
      buildRegistries([
        defineModule({ id: "identity", rateRules: [rule] }),
        defineModule({ id: "telegram", rateRules: [{ ...rule }] }),
      ]);
    expect(build).toThrow(/auth\.login/);
  });

  it("обработчик подтверждения дважды в одном модуле невозможен, в двух — разные имена по id", () => {
    const registries = buildRegistries([
      defineModule({ id: "budgets", confirm: { "budgets.delete-goal": noop } }),
      defineModule({ id: "accounts", confirm: { "accounts.delete": noop } }),
    ]);
    expect([...registries.confirm.keys()]).toEqual(["budgets.delete-goal", "accounts.delete"]);
  });
});

describe("ARCHITECTURE §6.4: источник сессий и проверка scope задач — от модуля входа", () => {
  const sessions = async () => undefined;
  const scopes = async () => true;

  it("модуль входа отдаёт источник сессий и проверку scope; без них — пусто", () => {
    expect(buildRegistries([defineModule({ id: "files" })])).toMatchObject({
      sessionSource: undefined,
      scopeVerifier: undefined,
    });
    const registries = buildRegistries([
      defineModule({ id: "identity", sessionSource: sessions, scopeVerifier: scopes }),
    ]);
    expect(registries.sessionSource).toBe(sessions);
    expect(registries.scopeVerifier).toBe(scopes);
  });

  it("второй источник сессий или вторая проверка scope — ошибка с обоими модулями", () => {
    expect(() =>
      buildRegistries([
        defineModule({ id: "identity", sessionSource: sessions }),
        defineModule({ id: "telegram", sessionSource: sessions }),
      ]),
    ).toThrow(/identity и telegram/);
    expect(() =>
      buildRegistries([
        defineModule({ id: "identity", scopeVerifier: scopes }),
        defineModule({ id: "demo", scopeVerifier: scopes }),
      ]),
    ).toThrow(/identity и demo/);
  });
});

describe("PRIV-02, ADR-0009: облачное согласие и остановка модулей", () => {
  it("источник согласия — один на процесс; второй — ошибка с обоими модулями", () => {
    const consent = async () => false;
    expect(
      buildRegistries([defineModule({ id: "privacy", consentSource: consent })]).consentSource,
    ).toBe(consent);
    expect(() =>
      buildRegistries([
        defineModule({ id: "privacy", consentSource: consent }),
        defineModule({ id: "profile", consentSource: consent }),
      ]),
    ).toThrow(/privacy и profile/);
  });

  it("остановки модулей — в порядке, обратном созданию", () => {
    const first = async () => {};
    const second = async () => {};
    const { stops } = buildRegistries([
      defineModule({ id: "agent", stop: first }),
      defineModule({ id: "chat", stop: second }),
    ]);
    expect(stops).toEqual([second, first]);
  });
});

describe("T-007 находка: ключи настроек и секретов — с префиксом владельца", () => {
  const setting = (key: string) =>
    ({ key, schema: z.string(), default: "" }) as unknown as SettingDef<unknown>;
  const secret = (name: string): SecretDef => ({ name });

  it("настройка и секрет модуля — с префиксом его id, платформенные — с чужим всем модулям префиксом", () => {
    const own = setting("mail.smtp-host");
    const registries = buildRegistries(
      [
        defineModule({ id: "mail", settings: [own], secrets: [secret("mail.smtp-password")] }),
        defineModule({ id: "system" }),
      ],
      { settings: [own, setting("clock.time-zone")], secrets: [secret("mail.smtp-password")] },
    );
    expect([...registries.settings.keys()]).toEqual(["mail.smtp-host"]);
  });

  it("настройка модуля с чужим префиксом — ошибка старта", () => {
    expect(() =>
      buildRegistries([defineModule({ id: "mail", settings: [setting("identity.x")] })]),
    ).toThrow(/настройка «identity\.x» модуля mail.*префикс «mail\.»/);
  });

  it("секрет модуля с чужим префиксом — ошибка старта", () => {
    expect(() =>
      buildRegistries([defineModule({ id: "llm", secrets: [secret("mail.key")] })]),
    ).toThrow(/секрет «mail\.key» модуля llm/);
  });

  it("платформенная настройка с префиксом модуля (system.time-zone при модуле system) — ошибка старта", () => {
    expect(() =>
      buildRegistries([defineModule({ id: "system" })], {
        settings: [setting("system.time-zone")],
        secrets: [],
      }),
    ).toThrow(/«system\.time-zone» платформы.*совпадает с модулем system/);
  });

  it("модуль с дефисом в id — префикс с дефисом допустим", () => {
    const own = setting("legal-base.crawl-delay-seconds");
    expect(() =>
      buildRegistries([defineModule({ id: "legal-base", settings: [own] })], {
        settings: [own],
        secrets: [],
      }),
    ).not.toThrow();
  });
});

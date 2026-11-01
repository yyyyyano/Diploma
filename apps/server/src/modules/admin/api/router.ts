// Процедуры admin (contract.admin.*): все — `admin` (сессия и роль администратора проверяет сервер; обычный
// пользователь — FORBIDDEN). Тонко: вход контрактом → фасад соседа → DTO. Данные — только admin-фасады модулей
// (PRIV-07): учётные записи identity, флаг режима privacy, система и почта.
import type { AdminUser, JobRun, SystemOverview } from "@kosht/contract";
import type { IdentityFacade } from "../../identity/index.ts";
import type { LegalBaseFacade } from "../../legal-base/index.ts";
import type { LlmAdminFacade } from "../../llm/index.ts";
import type { MailFacade } from "../../mail/index.ts";
import type { NormTablesFacade } from "../../norm-tables/index.ts";
import type { TelegramFacade } from "../../telegram/index.ts";
import type { SystemFacade } from "../../system/index.ts";
import { admin } from "../../../platform/http/procedures.ts";
import type { AdminUserView } from "../application/admin-users.ts";

type Run = Awaited<ReturnType<SystemFacade["view"]>>["jobs"]["running"][number];

function toRun(run: Run): JobRun {
  return {
    kind: run.kind,
    status: run.status,
    progress: run.progress,
    errorCode: run.errorCode,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}

function toUser(user: AdminUserView): AdminUser {
  return { ...user, registeredAt: user.registeredAt.toISOString() };
}

export function adminRouter(d: {
  readonly users: (actor: Parameters<IdentityFacade["removeUser"]>[0]) => Promise<AdminUserView[]>;
  readonly identity: Pick<
    IdentityFacade,
    "setStatus" | "setRole" | "removeUser" | "resetUserPassword" | "emailOf"
  >;
  readonly system: SystemFacade;
  /** Токен Telegram-бота (ADM-60): только статус и запись. */
  readonly telegram: Pick<TelegramFacade["admin"], "tokenStatus" | "setToken">;
  readonly mail: Pick<MailFacade, "smtp">;
  /** Админка ИИ (ADM-20, ADM-50): цифры и настройки — без текстов запросов (ADM-22). */
  readonly llm: LlmAdminFacade["admin"];
  /** Вкладка «Законы» (LAW-40): состояние правовой базы, кнопки и справочники — только метаданные общей базы. */
  readonly laws: LegalBaseFacade["admin"];
  /** Таблица ставок (ADM-11): значения нормы с источником, подтверждение человеком. */
  readonly rates: NormTablesFacade["admin"];
}) {
  /** Ответил ли самотест локальной модели эмбеддингов: от него зависит «ждём модель» в прогрессе векторов. */
  async function lawsOverview() {
    const models = await d.llm.localModels();
    return d.laws.overview(models.selfTest.state === "ok");
  }

  async function overview(): Promise<SystemOverview> {
    const view = await d.system.view();
    return {
      jobs: {
        running: view.jobs.running.map(toRun),
        failures: view.jobs.failures.map(toRun),
        schedules: view.jobs.schedules.map((schedule) => ({
          name: schedule.name,
          cron: schedule.cron,
          lastRun: schedule.lastRun === null ? null : toRun(schedule.lastRun),
        })),
      },
      mail: await d.mail.smtp.view(),
      timeZone: view.timeZone,
      lan: view.lan,
      langfuse: view.langfuse,
      telegram: { token: await d.telegram.tokenStatus() },
    };
  }

  return {
    users: admin.admin.users.handler(async ({ context }) => ({
      items: (await d.users(context.s.scope)).map(toUser),
    })),
    setUserStatus: admin.admin.setUserStatus.handler(async ({ input }) => {
      await d.identity.setStatus(input.id, input.status);
      return { ok: true as const };
    }),
    setUserRole: admin.admin.setUserRole.handler(async ({ input }) => {
      await d.identity.setRole(input.id, input.role);
      return { ok: true as const };
    }),
    deleteUser: admin.admin.deleteUser.handler(async ({ input, context }) => {
      await d.identity.removeUser(context.s.scope, input.id, input.email);
      return { ok: true as const };
    }),
    resetUserPassword: admin.admin.resetUserPassword.handler(({ input, context }) =>
      d.identity.resetUserPassword(context.s.scope, input.id),
    ),
    system: admin.admin.system.handler(() => overview()),
    setMail: admin.admin.setMail.handler(async ({ input }) => {
      await d.mail.smtp.save(input);
      return overview();
    }),
    sendTestMail: admin.admin.sendTestMail.handler(async ({ context }) => {
      await d.mail.smtp.sendTest(await d.identity.emailOf(context.s));
      return { ok: true as const };
    }),
    setTelegramToken: admin.admin.setTelegramToken.handler(async ({ input }) => {
      await d.telegram.setToken(input.token);
      return overview();
    }),
    setTimeZone: admin.admin.setTimeZone.handler(async ({ input }) => {
      await d.system.setTimeZone(input.timeZone);
      return overview();
    }),
    setLan: admin.admin.setLan.handler(async ({ input }) => {
      await d.system.setLan(input);
      return overview();
    }),
    aiProviders: admin.admin.aiProviders.handler(() => d.llm.providers()),
    setAiChain: admin.admin.setAiChain.handler(({ input }) =>
      d.llm.setChain(input.task, input.models),
    ),
    setAiModelEnabled: admin.admin.setAiModelEnabled.handler(({ input }) =>
      d.llm.enable(input.id, input.enabled),
    ),
    saveAiModel: admin.admin.saveAiModel.handler(({ input }) => d.llm.saveModel(input)),
    testAiProvider: admin.admin.testAiProvider.handler(({ input }) =>
      d.llm.testConnection(input.id),
    ),
    setAiKey: admin.admin.setAiKey.handler(({ input }) => d.llm.setKey(input.provider, input.key)),
    aiUsage: admin.admin.aiUsage.handler(({ input }) => d.llm.usage(input.period)),
    localModels: admin.admin.localModels.handler(() => d.llm.localModels()),
    downloadLocalModels: admin.admin.downloadLocalModels.handler(({ context }) =>
      d.llm.downloadLocalModels(context.s),
    ),
    selfTestLocalModels: admin.admin.selfTestLocalModels.handler(() => d.llm.selfTestLocalModels()),
    setAiPrice: admin.admin.setAiPrice.handler(({ input }) => d.llm.setPrice(input.id, input)),
    lawsOverview: admin.admin.lawsOverview.handler(() => lawsOverview()),
    setLawsSettings: admin.admin.setLawsSettings.handler(async ({ input }) => {
      await d.laws.setSettings(input);
      return lawsOverview();
    }),
    lawsActs: admin.admin.lawsActs.handler(({ input }) => d.laws.acts(input.status, input.page)),
    lawsUpdates: admin.admin.lawsUpdates.handler(async () => ({ items: await d.laws.updates() })),
    lawsFetches: admin.admin.lawsFetches.handler(async () => ({ items: await d.laws.fetches() })),
    lawsCandidates: admin.admin.lawsCandidates.handler(async () => ({
      items: await d.laws.candidates(),
    })),
    decideLawCandidate: admin.admin.decideLawCandidate.handler(async ({ input, context }) => ({
      items: await d.laws.decide(context.s, input.id, input.decision),
    })),
    lawsCheckNow: admin.admin.lawsCheckNow.handler(async ({ context }) => {
      await d.laws.checkNow(context.s);
      return { ok: true as const };
    }),
    lawsCheckText: admin.admin.lawsCheckText.handler(async ({ input, context }) => {
      await d.laws.checkText(context.s, input.pravoId);
      return { ok: true as const };
    }),
    addLawActs: admin.admin.addLawActs.handler(({ input, context }) =>
      d.laws.addActs(context.s, input.links),
    ),
    excludeLawAct: admin.admin.excludeLawAct.handler(async ({ input }) => {
      await d.laws.exclude(input.pravoId);
      return { ok: true as const };
    }),
    lawsDictionary: admin.admin.lawsDictionary.handler(({ input }) =>
      d.laws.dictionaries.list(input.kind),
    ),
    lawsDictionaryUpsert: admin.admin.lawsDictionaryUpsert.handler(({ input }) =>
      d.laws.dictionaries.upsert(input.kind, input.id, input.values),
    ),
    lawsDictionaryRemove: admin.admin.lawsDictionaryRemove.handler(({ input }) =>
      d.laws.dictionaries.remove(input.kind, input.id),
    ),
    rates: admin.admin.rates.handler(() => d.rates.table()),
    proposeRate: admin.admin.proposeRate.handler(({ input }) => d.rates.propose(input)),
    confirmRate: admin.admin.confirmRate.handler(({ input, context }) =>
      d.rates.confirm(context.s, input.id),
    ),
    rejectRate: admin.admin.rejectRate.handler(({ input }) => d.rates.reject(input.id)),
  };
}

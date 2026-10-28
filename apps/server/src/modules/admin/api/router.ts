// Процедуры admin (contract.admin.*): все — `admin` (сессия и роль администратора проверяет сервер; обычный
// пользователь — FORBIDDEN). Тонко: вход контрактом → фасад соседа → DTO. Данные — только admin-фасады модулей
// (PRIV-07): учётные записи identity, флаг режима privacy, система и почта.
import type { AdminUser, JobRun, SystemOverview } from "@kosht/contract";
import type { IdentityFacade } from "../../identity/index.ts";
import type { MailFacade } from "../../mail/index.ts";
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
  readonly mail: Pick<MailFacade, "smtp">;
}) {
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
      d.identity.resetUserPassword(context.s.scope, input.id, {
        listener: context.listener,
        host: context.reqHeaders?.get("host") ?? undefined,
      }),
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
    setTimeZone: admin.admin.setTimeZone.handler(async ({ input }) => {
      await d.system.setTimeZone(input.timeZone);
      return overview();
    }),
    setLan: admin.admin.setLan.handler(async ({ input }) => {
      await d.system.setLan(input);
      return overview();
    }),
  };
}

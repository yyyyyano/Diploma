// ADR-0005, ARCHITECTURE §9: дерево процедур контракта. Каждая процедура объявляет ошибки только из каталога — со
// статусом каталога и данными { requestId, params }; это проверяется по самому дереву, а не по договорённости.
import {
  getEventIteratorSchemaDetails,
  isContractProcedure,
  type AnyContractProcedure,
  type AnyContractRouter,
  type ErrorMap,
} from "@orpc/contract";
import { describe, expect, it } from "vitest";
import { ERROR_CODES, ERRORS, ErrorData } from "./errors.ts";
import { contract } from "./router.ts";

function procedures(router: AnyContractRouter, path = ""): [string, AnyContractProcedure][] {
  if (isContractProcedure(router)) return [[path, router]];
  return Object.entries(router).flatMap(([key, child]) =>
    procedures(child, path === "" ? key : `${path}.${key}`),
  );
}

const all = procedures(contract);

describe("дерево процедур", () => {
  it("процедуры: платформа, почта, вход, согласия, действия, объяснения, файлы, уведомления, профиль, счета, категории, операции, чат, выбор модели и админка", () => {
    expect(all.map(([path]) => path)).toEqual([
      "system.health",
      "events.stream",
      "mail.status",
      "mail.mailbox",
      "identity.status",
      "identity.setup",
      "identity.signIn",
      "identity.register",
      "identity.verifyEmail",
      "identity.resendVerification",
      "identity.requestPasswordReset",
      "identity.resetPassword",
      "identity.recoverWithCode",
      "identity.recoveryCodeStatus",
      "identity.createRecoveryCode",
      "identity.changePassword",
      "identity.adminResetNotice",
      "identity.acknowledgeAdminReset",
      "identity.deleteAccount",
      "identity.signOut",
      "identity.me",
      "privacy.state",
      "privacy.setCloudConsent",
      "privacy.dataExport",
      "privacy.requestExport",
      "actions.undo",
      "actions.decision",
      "actions.answer",
      "explain.get",
      "files.upload",
      "files.download",
      "notifications.list",
      "notifications.markRead",
      "notifications.markAllRead",
      "notifications.preferences",
      "notifications.setPreference",
      "notifications.adminList",
      "notifications.adminMarkRead",
      "profile.facts",
      "profile.onboarding",
      "profile.completeOnboarding",
      "profile.setFact",
      "profile.confirmFact",
      "profile.deleteFact",
      "accounts.list",
      "accounts.create",
      "accounts.rename",
      "accounts.setInitialBalance",
      "accounts.requestDelete",
      "accounts.explain",
      "recurring.list",
      "recurring.confirm",
      "recurring.exclude",
      "recurring.end",
      "recurring.resume",
      "recurring.stillComing",
      "recurring.edit",
      "recurring.create",
      "recurring.explain",
      "recurring.markers",
      "fin.freeBalance",
      "budgets.overview",
      "budgets.setLimit",
      "budgets.requestDeleteLimit",
      "budgets.createGoal",
      "budgets.updateGoal",
      "budgets.contribute",
      "budgets.requestDeleteGoal",
      "budgets.previewGoal",
      "dashboard.overview",
      "categories.list",
      "categories.create",
      "categories.rename",
      "categories.setHidden",
      "transactions.list",
      "transactions.get",
      "transactions.create",
      "transactions.update",
      "transactions.requestDelete",
      "transactions.requestChangeCategory",
      "transactions.requestMarkTransfer",
      "transactions.explainRate",
      "transactions.linkReceipt",
      "transactions.unlinkReceipt",
      "receipts.start",
      "receipts.list",
      "receipts.get",
      "receipts.confirm",
      "receipts.updateItems",
      "receipts.cancel",
      "statements.start",
      "statements.list",
      "statements.get",
      "statements.confirm",
      "statements.fixColumns",
      "statements.cancel",
      "statements.rollbackInfo",
      "statements.rollback",
      "chat.history",
      "chat.send",
      "chat.stop",
      "llm.localModelsProgress",
      "llm.models",
      "llm.setPreferredModel",
      "legalBase.startupProgress",
      "admin.users",
      "admin.setUserStatus",
      "admin.setUserRole",
      "admin.deleteUser",
      "admin.resetUserPassword",
      "admin.system",
      "admin.setMail",
      "admin.sendTestMail",
      "admin.setTimeZone",
      "admin.setLan",
      "admin.aiProviders",
      "admin.setAiChain",
      "admin.setAiModelEnabled",
      "admin.saveAiModel",
      "admin.testAiProvider",
      "admin.setAiKey",
      "admin.aiUsage",
      "admin.localModels",
      "admin.downloadLocalModels",
      "admin.selfTestLocalModels",
      "admin.setAiPrice",
    ]);
  });

  it("у каждой процедуры есть метод и путь REST/OpenAPI (oc.route)", () => {
    expect(all.filter(([, p]) => !p["~orpc"].route.method || !p["~orpc"].route.path)).toEqual([]);
  });

  it("каждая процедура объявляет только коды каталога — со статусом каталога и ErrorData", () => {
    const wrong = all.flatMap(([path, p]) => {
      const errorMap: ErrorMap = p["~orpc"].errorMap;
      return Object.entries(errorMap)
        .filter(([code, item]) => {
          const known = ERROR_CODES.find((c) => c === code);
          return (
            known === undefined || item?.status !== ERRORS[known].status || item.data !== ErrorData
          );
        })
        .map(([code]) => `${path}: ${code}`);
    });
    expect(wrong).toEqual([]);
  });
});

describe("system.health", () => {
  const health = contract.system.health["~orpc"];

  it("без входа и без ошибок: отвечает всегда, пока процесс жив", () => {
    expect(health.inputSchema).toBeUndefined();
    expect(health.errorMap).toEqual({});
  });

  it('ответ — { status: "ok" }, другого не бывает', () => {
    expect(health.outputSchema?.["~standard"].validate({ status: "ok" })).toEqual({
      value: { status: "ok" },
    });
    expect(health.outputSchema?.["~standard"].validate({ status: "degraded" })).toHaveProperty(
      "issues",
    );
  });
});

describe("events.stream", () => {
  const stream = contract.events.stream["~orpc"];

  it("ответ — поток событий сайта (итератор), а не разовый объект", () => {
    expect(getEventIteratorSchemaDetails(stream.outputSchema)).toBeDefined();
  });

  it("поток только для вошедшего: единственная ошибка — UNAUTHORIZED", () => {
    expect(Object.keys(stream.errorMap)).toEqual(["UNAUTHORIZED"]);
  });
});

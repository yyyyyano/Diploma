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
  it("процедуры бетонной фазы: платформа, вход (identity) и счета (accounts)", () => {
    expect(all.map(([path]) => path)).toEqual([
      "system.health",
      "events.stream",
      "identity.status",
      "identity.setup",
      "identity.signIn",
      "identity.signOut",
      "identity.me",
      "accounts.list",
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

// Области коммитов (scope-enum commitlint): id модулей из modules.ts + служебные области корневого CLAUDE.md
// «Git». Список не копируется руками — новый модуль сразу становится допустимой областью.
import { describe, expect, it } from "vitest";
import { commitScopes, parseServiceScopes } from "./commit-scopes.ts";
import { MODULES } from "./modules.ts";

describe("parseServiceScopes", () => {
  it("строка областей, перенесённая на следующую строку, читается целиком", () => {
    const text = [
      "  Область необязательна; если указана — id модуля из `docs/CAPABILITIES.md` или `web`, `server`,",
      "  `kernel`, `deps`, `plan`.",
      "  Пример: `feat(receipts): перепроверять спорные строки чека моделью`.",
    ].join("\n");
    expect(parseServiceScopes(text)).toEqual(["web", "server", "kernel", "deps", "plan"]);
  });

  it("строка в одну строку тоже читается, пример после точки не попадает в список", () => {
    const text =
      "Область — id модуля из `docs/CAPABILITIES.md` или `web`, `docs`. Пример: `feat(receipts): x`.";
    expect(parseServiceScopes(text)).toEqual(["web", "docs"]);
  });

  it("нет строки со служебными областями — понятная ошибка с указанием места", () => {
    expect(() => parseServiceScopes("# Кошт\n\nНичего про области.")).toThrow(
      /CLAUDE\.md.*«Git».*служебн/s,
    );
  });

  it("строка есть, но областей в ней нет — тоже ошибка, а не пустой список", () => {
    expect(() => parseServiceScopes("id модуля из `docs/CAPABILITIES.md` или ничего.")).toThrow(
      /служебн/,
    );
  });
});

describe("commitScopes", () => {
  it("содержит все 36 id модулей и служебные области корневого CLAUDE.md, включая plan", () => {
    const scopes = commitScopes();
    expect(scopes).toEqual(expect.arrayContaining(MODULES.map((m) => m.id)));
    expect(scopes).toEqual(
      expect.arrayContaining([
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
      ]),
    );
  });

  it("области не повторяются", () => {
    const scopes = commitScopes();
    expect(new Set(scopes).size).toBe(scopes.length);
  });
});

// Общая основа своих проверок (T-056): разметка исходника на код, комментарии и строки без парсера
// и обход корней с общими исключениями. От точности разметки зависит, не ослепнут ли проверки.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkResult, findAll, listFiles, splitSource } from "./source-text.mjs";

describe("splitSource: код, комментарии и строки — отдельно, с теми же позициями", () => {
  it("строчный и блочный комментарий уходят из кода, переводы строк сохраняются", () => {
    const parts = splitSource("a(); // TODO x\n/* b\n c */ d();\n");
    expect(parts.code).toBe("a();          \n    \n      d();\n");
    expect(parts.comments).toBe("        TODO x\n   b\n c        \n");
  });

  it("строки в кавычках остаются в коде только кавычками, текст — в strings", () => {
    const parts = splitSource(`f("makeScope", 'as Scope');`);
    expect(parts.code).toBe(`f("         ", '        ');`);
    expect(parts.strings).toBe(`   makeScope    as Scope   `);
  });

  it("экранированная кавычка не закрывает строку", () => {
    const parts = splitSource(String.raw`x = "a\"b"; y();`);
    expect(parts.code).toBe(`x = "    "; y();`);
  });

  it("незакрытая строка заканчивается на переводе строки и не съедает следующие строки", () => {
    const parts = splitSource("<p>It's</p>\nmakeScope();\n");
    expect(parts.code.split("\n")[1]).toBe("makeScope();");
  });

  it("в шаблонной строке текст — строка, а выражения ${…} — код, в том числе вложенные шаблоны", () => {
    const parts = splitSource("t = `a ${b(`c ${d}`)} e`;");
    expect(parts.code).toBe("t = `  ${b(`  ${d}`)}  `;");
    expect(parts.strings).toBe("     a      c         e  ");
  });

  it("фигурные скобки внутри ${…} не закрывают выражение раньше времени", () => {
    const parts = splitSource("`${ {a: 1}.a } x` + y");
    expect(parts.code).toBe("`${ {a: 1}.a }  ` + y");
  });

  it("регулярное выражение не считается ни кодом, ни строкой — кавычка внутри него не ломает разметку", () => {
    const parts = splitSource(`const r = /it\\.fails"/; makeScope();`);
    expect(parts.code).toBe(`const r = /          /; makeScope();`);
  });

  it("деление после идентификатора и скобки — это код, а не регулярное выражение", () => {
    const parts = splitSource("a = b / c / (d) / 2; // x");
    expect(parts.code).toBe("a = b / c / (d) / 2;     ");
  });

  it("класс символов с косой чертой не закрывает регулярное выражение", () => {
    const parts = splitSource("s.split(/[/]/); x();");
    expect(parts.code).toBe("s.split(/   /); x();");
  });
});

describe("findAll: совпадения с номерами строк", () => {
  it("называет строку каждого совпадения и само совпадение", () => {
    expect(findAll("a\nfoo bar\nfoo", /foo/g)).toEqual([
      { line: 2, match: "foo", lineText: "foo bar" },
      { line: 3, match: "foo", lineText: "foo" },
    ]);
  });
});

describe("listFiles: обход корней с общими исключениями", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function tree(files: string[]): string {
    const base = mkdtempSync(join(tmpdir(), "source-text-"));
    dirs.push(base);
    for (const file of files) {
      mkdirSync(dirname(join(base, file)), { recursive: true });
      writeFileSync(join(base, file), "x\n");
    }
    return base;
  }

  it("берёт файлы нужных расширений, пропускает node_modules, dist, __fixtures__, __cassettes__ и фикстуры tooling", () => {
    const base = tree([
      "apps/server/src/a.ts",
      "apps/server/src/b.md",
      "apps/server/src/node_modules/c.ts",
      "apps/server/src/dist/d.ts",
      "apps/server/src/m/__fixtures__/e.ts",
      "apps/server/src/m/__cassettes__/f.ts",
      "tooling/architecture/fixtures/g.ts",
      "tooling/h.mjs",
    ]);
    const found = listFiles(base, ["apps/server/src", "tooling"], { extensions: ["ts", "mjs"] });
    expect(found).toEqual({
      roots: ["apps/server/src", "tooling"],
      files: ["apps/server/src/a.ts", "tooling/h.mjs"],
    });
  });

  it("корня нет — он не попадает в roots и не считается ошибкой", () => {
    const base = tree(["packages/calc/a.ts"]);
    expect(listFiles(base, ["apps/web/src", "packages/calc"], { extensions: ["ts"] })).toEqual({
      roots: ["packages/calc"],
      files: ["packages/calc/a.ts"],
    });
  });

  it("свой фильтр skip исключает файлы по относительному пути", () => {
    const base = tree(["packages/calc/a.ts", "packages/calc/a.test.ts"]);
    const found = listFiles(base, ["packages/calc"], {
      extensions: ["ts"],
      skip: (path) => path.endsWith(".test.ts"),
    });
    expect(found.files).toEqual(["packages/calc/a.ts"]);
  });
});

describe("checkResult: код выхода по общим правилам", () => {
  const finding = { file: "packages/calc/a.ts", line: 3, rule: "r", message: "уберите Date.now()" };

  it("нарушение — код 1 и сообщение «файл:строка — что исправить»", () => {
    const result = checkResult({
      roots: ["packages/calc"],
      files: ["packages/calc/a.ts"],
      findings: [finding],
    });
    expect(result).toMatchObject({
      code: 1,
      files: 1,
      messages: ["packages/calc/a.ts:3 — уберите Date.now()"],
    });
  });

  it("корень есть, а файлов в нём 0 — код 2, даже без нарушений", () => {
    const result = checkResult({
      roots: ["packages/calc", "apps/web/src"],
      files: ["packages/calc/a.ts"],
      findings: [],
    });
    expect(result.code).toBe(2);
    expect(result.messages.join("\n")).toContain("apps/web/src");
  });

  it("корней нет вовсе — код 0 и 0 файлов: код ещё не написан", () => {
    expect(checkResult({ roots: [], files: [], findings: [] })).toMatchObject({
      code: 0,
      files: 0,
    });
  });
});

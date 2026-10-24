// NFR-19, i18n.md: весь текст сайта — через t(). jsx-literals.mjs: правило Oxlint react/jsx-no-literals (настоящий
// разбор JSX) + строка в фигурных скобках у текстовых атрибутов, которую Oxlint пропускает. Литерал — текст
// хотя бы с одной буквой: знаки, числа, «—» и &nbsp; разрешены. Тесты и /dev/gallery не проверяются.
// Тексты бота, писем и уведомлений эта проверка не видит — они остаются ревью.
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runJsxLiterals } from "./jsx-literals.mjs";

const fixtures = fileURLToPath(
  new URL("../architecture/fixtures/checks/jsx-literals/", import.meta.url),
);
const page = "apps/web/src/features/operations/OperationsPage.tsx";

describe("jsx-literals: текст литералом в JSX", () => {
  const result = runJsxLiterals({ baseDir: join(fixtures, "violation") });
  const found = result.findings.map((f) => `${f.line} ${/«([^»]+)»/.exec(f.message)?.[1]}`);

  it("текст между тегами и строка в {…} среди детей", () => {
    expect(found).toEqual(expect.arrayContaining(["4 Операции", "5 Найдено", "11 BYN"]));
  });

  it("текстовые атрибуты — и в кавычках, и строкой или шаблоном в {…}", () => {
    expect(found).toEqual(
      expect.arrayContaining([
        '6 label="Поиск"',
        "6 placeholder={`Например, такси`}",
        '7 aria-label={"Удалить"}',
        "7 title='Удалить операцию'",
        '10 alt="Логотип"',
      ]),
    );
  });

  it("ничего лишнего: ровно 8 нарушений, код 1, сообщение называет ключ i18n", () => {
    expect({ code: result.code, count: found.length }).toEqual({ code: 1, count: 8 });
    expect(result.messages).toContain(
      `${page}:4 — текст «Операции» литералом в JSX (NFR-19): выведите его через t("ns:экран.ключ") ` +
        "из словаря @kosht/i18n.",
    );
  });
});

describe("jsx-literals: законный код не ловится", () => {
  it('t(), знаки, числа, «—», &nbsp;, alt="", служебные атрибуты; тесты и /dev/gallery пропущены', () => {
    const clean = runJsxLiterals({ baseDir: join(fixtures, "clean") });
    expect({ code: clean.code, files: clean.files, findings: clean.findings }).toEqual({
      code: 0,
      files: 2,
      findings: [],
    });
  });

  it("сайта ещё нет — код 0 и 0 файлов, Oxlint не запускается", () => {
    const empty = mkdtempSync(join(tmpdir(), "jsx-literals-"));
    try {
      expect(runJsxLiterals({ baseDir: empty })).toMatchObject({ code: 0, files: 0 });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("jsx-literals: не смог проверить — код 2, а не «чисто»", () => {
  function fakeOxlint(stdout: string): { bin: string; dir: string } {
    const dir = mkdtempSync(join(tmpdir(), "jsx-literals-bin-"));
    const bin = join(dir, "oxlint");
    writeFileSync(bin, `#!/bin/sh\necho '${stdout}'\n`);
    chmodSync(bin, 0o755);
    return { bin, dir };
  }

  it("Oxlint проверил меньше файлов, чем передано, — код 2 с объяснением", () => {
    const { bin, dir } = fakeOxlint('{"diagnostics":[],"number_of_files":0}');
    try {
      const result = runJsxLiterals({ baseDir: join(fixtures, "clean"), oxlint: bin });
      expect(result.code).toBe(2);
      expect(result.messages.join("\n")).toContain("Oxlint проверил файлов: 0, а передано 2");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("Oxlint вернул не JSON — код 2", () => {
    const { bin, dir } = fakeOxlint("panic");
    try {
      expect(runJsxLiterals({ baseDir: join(fixtures, "clean"), oxlint: bin }).code).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

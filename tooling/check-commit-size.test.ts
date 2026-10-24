// Размер коммита (ADR-0001, CONSTRAINTS.md «Коммиты»): чистая функция на фикстурах numstat и CLI в
// одноразовом git-репозитории во временной папке.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { checkCommitSize, parseNumstat, readTrailers } from "./check-commit-size.mjs";

// Строка `git diff --numstat -z`: «добавлено<TAB>удалено<TAB>путь<NUL>».
function numstat(...rows: Array<[number | "-", number | "-", string]>): string {
  return rows.map(([added, deleted, path]) => `${added}\t${deleted}\t${path}\0`).join("");
}

function manyFiles(count: number, linesEach: number): string {
  return numstat(
    ...Array.from({ length: count }, (_, i): [number, number, string] => [
      linesEach,
      0,
      `src/f${i}.ts`,
    ]),
  );
}

describe("parseNumstat: разбор вывода git --numstat -z", () => {
  it("читает добавленные и удалённые строки обычного файла", () => {
    expect(parseNumstat(numstat([10, 2, "src/a.ts"]))).toEqual([
      { path: "src/a.ts", added: 10, deleted: 2, binary: false },
    ]);
  });

  it("переименование учитывается по новому пути", () => {
    expect(parseNumstat("3\t1\t\0src/old.ts\0src/new.ts\0")).toEqual([
      { path: "src/new.ts", added: 3, deleted: 1, binary: false },
    ]);
  });

  it("бинарный файл помечается и не даёт строк", () => {
    expect(parseNumstat(numstat(["-", "-", "img/logo.png"]))).toEqual([
      { path: "img/logo.png", added: 0, deleted: 0, binary: true },
    ]);
  });

  it("ведущий перевод строки от git show --format= не мешает разбору", () => {
    expect(parseNumstat("\n" + numstat([1, 0, "a.ts"]))).toEqual([
      { path: "a.ts", added: 1, deleted: 0, binary: false },
    ]);
  });
});

describe("readTrailers: настоящие git-трейлеры", () => {
  it("находит трейлер в последнем абзаце сообщения", () => {
    const message = "feat: большой импорт\n\nТело.\n\nLarge-Commit: сгенерированный справочник\n";
    expect(readTrailers(message).get("large-commit")).toBe("сгенерированный справочник");
  });

  it("строка «Large-Commit:» в середине тела — не трейлер", () => {
    const message = "feat: большой импорт\n\nLarge-Commit: причина\n\nЕщё абзац текста.\n";
    expect(readTrailers(message).has("large-commit")).toBe(false);
  });

  it("заголовок не считается трейлером", () => {
    expect(readTrailers("Large-Commit: причина\n").has("large-commit")).toBe(false);
  });
});

describe("checkCommitSize: пороги размера", () => {
  it("коммит на 120 строк в 3 файлах проходит без замечаний", () => {
    const result = checkCommitSize({
      message: "feat(tooling): добавить проверку",
      numstat: numstat([100, 0, "a.ts"], [10, 5, "b.ts"], [5, 0, "c.ts"]),
    });
    expect(result).toEqual({ files: 3, lines: 120, errors: [], warnings: [] });
  });

  it("коммит на 900 добавленных строк без трейлера отклоняется и подсказывает, что делать", () => {
    const result = checkCommitSize({
      message: "feat: большой коммит без причины",
      numstat: numstat([900, 0, "src/big.ts"]),
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("900 строк");
    expect(result.errors[0]).toContain("Large-Commit: <причина>");
  });

  it("ровно 800 строк ещё допустимо (порог «≤ 800»), но с предупреждением", () => {
    const result = checkCommitSize({
      message: "feat: коммит на границе порога",
      numstat: numstat([800, 0, "src/a.ts"]),
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });

  it("801 строка без трейлера — отказ", () => {
    const result = checkCommitSize({
      message: "feat: на строку больше порога",
      numstat: numstat([700, 101, "src/a.ts"]),
    });
    expect(result.errors).toHaveLength(1);
  });

  it("удалённые строки считаются вместе с добавленными", () => {
    const result = checkCommitSize({
      message: "refactor: переписать модуль",
      numstat: numstat([500, 400, "src/a.ts"]),
    });
    expect(result.lines).toBe(900);
    expect(result.errors).toHaveLength(1);
  });

  it("41 файл без трейлера — отказ по числу файлов", () => {
    const result = checkCommitSize({ message: "feat: много файлов", numstat: manyFiles(41, 1) });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("41 файл");
  });

  it("21 файл — только предупреждение", () => {
    const result = checkCommitSize({ message: "feat: много файлов", numstat: manyFiles(21, 1) });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });

  it("401 строка — предупреждение, коммит проходит", () => {
    const result = checkCommitSize({
      message: "feat: крупный коммит",
      numstat: numstat([401, 0, "src/a.ts"]),
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });

  it("900 строк с трейлером Large-Commit и причиной проходят", () => {
    const result = checkCommitSize({
      message: "feat: большой коммит\n\nLarge-Commit: первая миграция схемы\n",
      numstat: numstat([900, 0, "src/big.ts"]),
    });
    expect(result.errors).toEqual([]);
  });

  it("трейлер Large-Commit без причины не принимается", () => {
    const result = checkCommitSize({
      message: "feat: большой коммит\n\nLarge-Commit:\n",
      numstat: numstat([900, 0, "src/big.ts"]),
    });
    expect(result.errors).toHaveLength(1);
  });

  it("lock-файл, снимки миграций и кассеты не считаются", () => {
    const result = checkCommitSize({
      message: "chore(deps): обновить зависимости",
      numstat: numstat(
        [3000, 2000, "pnpm-lock.yaml"],
        [1500, 0, "apps/server/drizzle/meta/0001_snapshot.json"],
        [900, 0, "apps/server/src/modules/receipts/__cassettes__/recheck.json"],
        [4, 1, "package.json"],
      ),
    });
    expect(result).toEqual({ files: 1, lines: 5, errors: [], warnings: [] });
  });

  it("бинарные файлы считаются по числу файлов", () => {
    const rows = Array.from({ length: 41 }, (_, i): ["-", "-", string] => [
      "-",
      "-",
      `img/p${i}.png`,
    ]);
    const result = checkCommitSize({ message: "feat: картинки", numstat: numstat(...rows) });
    expect(result.files).toBe(41);
    expect(result.errors).toHaveLength(1);
  });
});

describe("checkCommitSize: слишком мелкие коммиты", () => {
  it("feat на 2 строки отклоняется", () => {
    const result = checkCommitSize({
      message: "feat: крошечная правка",
      numstat: numstat([1, 1, "src/a.ts"]),
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Small-Commit: <причина>");
  });

  it.each(["docs", "chore", "style", "fix", "revert"])("%s на 1 строку разрешён", (type) => {
    const result = checkCommitSize({
      message: `${type}: однострочная правка`,
      numstat: numstat([1, 0, "src/a.ts"]),
    });
    expect(result.errors).toEqual([]);
  });

  it("feat(scope)! на 1 строку с трейлером Small-Commit проходит", () => {
    const result = checkCommitSize({
      message: "feat(tooling)!: включить правило\n\nSmall-Commit: одна строка конфигурации\n",
      numstat: numstat([1, 0, ".oxlintrc.json"]),
    });
    expect(result.errors).toEqual([]);
  });

  it("3 строки — уже не мелкий коммит", () => {
    const result = checkCommitSize({
      message: "test: добавить проверку",
      numstat: numstat([3, 0, "src/a.test.ts"]),
    });
    expect(result.errors).toEqual([]);
  });

  it("feat с одной картинкой (бинарный файл без строк) не считается мелким", () => {
    const result = checkCommitSize({
      message: "feat: добавить логотип",
      numstat: numstat(["-", "-", "img/logo.png"]),
    });
    expect(result.errors).toEqual([]);
  });

  it("коммит только из lock-файла не считается мелким", () => {
    const result = checkCommitSize({
      message: "build: пересобрать lock-файл",
      numstat: numstat([10, 10, "pnpm-lock.yaml"]),
    });
    expect(result.errors).toEqual([]);
  });

  it('git revert с заголовком Revert "…" считается типом revert', () => {
    const result = checkCommitSize({
      message: 'Revert "feat: крошечная правка"\n\nThis reverts commit abc.\n',
      numstat: numstat([1, 1, "src/a.ts"]),
    });
    expect(result.errors).toEqual([]);
  });

  it("слияние (Merge …) не проверяется", () => {
    const result = checkCommitSize({
      message: "Merge branch 'task/T-001'",
      numstat: numstat([5000, 0, "src/a.ts"]),
    });
    expect(result.errors).toEqual([]);
  });

  it("строки-комментарии git не мешают найти заголовок и трейлер", () => {
    const result = checkCommitSize({
      message:
        "feat: большой коммит\n\nLarge-Commit: генерация\n# Please enter the commit message\n",
      numstat: numstat([900, 0, "src/big.ts"]),
    });
    expect(result.errors).toEqual([]);
  });
});

describe("CLI tooling/check-commit-size.mjs", () => {
  const script = fileURLToPath(new URL("./check-commit-size.mjs", import.meta.url));
  let repo = "";

  function git(...args: string[]) {
    return execFileSync(
      "git",
      [
        "-c",
        "user.name=test",
        "-c",
        "user.email=test@example.com",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd: repo, encoding: "utf8" },
    );
  }

  function makeRepo(lines: number) {
    repo = mkdtempSync(join(tmpdir(), "commit-size-"));
    git("init", "-q");
    writeFileSync(join(repo, "big.ts"), "x\n".repeat(lines));
    git("add", "big.ts");
  }

  function run(...args: string[]) {
    return spawnSync(process.execPath, [script, ...args], { cwd: repo, encoding: "utf8" });
  }

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("commit-msg: 900 staged-строк без трейлера — код 1 и понятное сообщение", () => {
    makeRepo(900);
    writeFileSync(join(repo, "MSG"), "feat: большой коммит\n");
    const result = run(join(repo, "MSG"));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Коммит слишком большой");
  });

  it("commit-msg: 900 staged-строк с трейлером Large-Commit — код 0", () => {
    makeRepo(900);
    writeFileSync(join(repo, "MSG"), "feat: большой коммит\n\nLarge-Commit: генерация\n");
    expect(run(join(repo, "MSG")).status).toBe(0);
  });

  it("--commit <hash>: готовый коммит проверяется по git show", () => {
    makeRepo(900);
    git("commit", "-q", "-m", "feat: большой коммит");
    const result = run("--commit", "HEAD");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("900 строк");
  });

  it("без аргументов — код 2 и подсказка по запуску", () => {
    makeRepo(1);
    const result = run();
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("check-commit-size");
  });
});

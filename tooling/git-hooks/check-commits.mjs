#!/usr/bin/env node
// make check-commits: коммиты ветки относительно базы (по умолчанию main) — те же правила, что у хука
// commit-msg: commitlint, размер коммита, запрет подписей ИИ. Ловит то, что прошло мимо хуков (ADR-0001).
//   node tooling/git-hooks/check-commits.mjs [база]
// Код выхода: 0 — всё чисто или проверять нечего, 1 — есть нарушения.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import lint from "@commitlint/lint";
import load from "@commitlint/load";
import { checkCommitSize } from "../check-commit-size.mjs";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const attributionScript = fileURLToPath(new URL("./check-no-ai-attribution.mjs", import.meta.url));

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

async function commitlintProblems(config, message) {
  const result = await lint(message, config.rules, {
    defaultIgnores: config.defaultIgnores ?? true,
    ...(config.parserPreset?.parserOpts ? { parserOpts: config.parserPreset.parserOpts } : {}),
  });
  return result.errors.map((e) => `${e.message} [${e.name}]`);
}

// Скрипт подписей ИИ — тот же, что вызывает хук; ему нужен файл сообщения.
function attributionProblems(message, dir) {
  const file = join(dir, "COMMIT_MSG");
  writeFileSync(file, message);
  const result = spawnSync(process.execPath, [attributionScript, file], { encoding: "utf8" });
  return result.status === 0 ? [] : [result.stderr.trim()];
}

async function main(base) {
  const revs = git(["rev-list", "--reverse", "--no-merges", `${base}..HEAD`])
    .split("\n")
    .filter(Boolean);
  if (revs.length === 0) {
    console.log(`Нет коммитов относительно ${base} — проверять нечего.`);
    return 0;
  }

  const config = await load({}, { cwd: projectRoot });
  const dir = mkdtempSync(join(tmpdir(), "check-commits-"));
  let failed = 0;
  try {
    for (const rev of revs) {
      const message = git(["log", "-1", "--format=%B", rev]);
      const numstat = git(["show", "--numstat", "-M", "-z", "--format=", rev]);
      const problems = [
        ...(await commitlintProblems(config, message)),
        ...checkCommitSize({ message, numstat }).errors,
        ...attributionProblems(message, dir),
      ];
      if (problems.length === 0) continue;
      failed += 1;
      const title = git(["log", "-1", "--format=%h %s", rev]).trim();
      console.error(`\n✖ ${title}`);
      for (const problem of problems) console.error(`  ${problem.replaceAll("\n", "\n  ")}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (failed > 0) {
    console.error(
      `\nНарушения в ${failed} из ${revs.length} коммитов относительно ${base}. Историю не переписываем:\n` +
        "сообщите о них в итоге задачи; новые коммиты делайте по правилам (корневой CLAUDE.md «Git»).",
    );
    return 1;
  }
  console.log(`Коммиты относительно ${base} в порядке: ${revs.length}.`);
  return 0;
}

process.exitCode = await main(process.argv[2] ?? "main");

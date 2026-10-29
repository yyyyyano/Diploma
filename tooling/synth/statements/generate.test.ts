// T-025, NFR-18, QA-01: набор datasets/statements — ровно то, что даёт генератор, и эталон внутренне согласован.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { Expected } from "./cases.ts";
import { writeDataset } from "./generate.ts";

const committed = fileURLToPath(new URL("../../../datasets/statements/", import.meta.url));
const fresh = mkdtempSync(join(tmpdir(), "kosht-synth-"));
afterAll(() => rmSync(fresh, { recursive: true, force: true }));

const caseIds = () => readdirSync(committed).filter((name) => !name.endsWith(".md"));
const expectedOf = (dir: string, id: string) =>
  JSON.parse(readFileSync(join(dir, id, "expected.json"), "utf8")) as Expected;
const statementFile = (dir: string, id: string) =>
  readdirSync(join(dir, id)).find((file) => file.startsWith("statement.")) ?? "";

describe("синтетические выписки", () => {
  it("набор в репозитории совпадает с генератором: те же случаи и эталоны", async () => {
    const ids = await writeDataset(fresh);
    expect(caseIds().toSorted()).toEqual(ids.toSorted());
    const changed = ids.filter(
      (id) => JSON.stringify(expectedOf(committed, id)) !== JSON.stringify(expectedOf(fresh, id)),
    );
    expect(changed).toEqual([]);
  }, 60_000);

  it("файлы набора устарели, если байты не совпали (картинки-сканы сравниваются по эталону): make synth-statements", () => {
    const stale = caseIds().filter((id) => {
      if (expectedOf(committed, id).scan) return false;
      const name = statementFile(committed, id);
      return !readFileSync(join(committed, id, name)).equals(readFileSync(join(fresh, id, name)));
    });
    expect(stale).toEqual([]);
  });

  it("цепочка остатков эталона сходится там, где остатки известны, и называет расхождение там, где его заложили", () => {
    const wrong = caseIds().filter((id) => {
      const e = expectedOf(committed, id);
      if (e.openingMinor === null || e.closingMinor === null) return e.balanceCheck !== "unknown";
      const sum = e.rows.reduce((acc, row) => acc + row.amountMinor, 0);
      const difference = e.closingMinor - (e.openingMinor + sum);
      return (
        difference !== e.differenceMinor ||
        e.balanceCheck !== (difference === 0 ? "ok" : "mismatch")
      );
    });
    expect(wrong).toEqual([]);
  });

  it("в наборе есть случаи на каждый формат: csv, xlsx, xls, pdf, скан-картинка и скан-PDF", () => {
    const formats = new Set(caseIds().map((id) => statementFile(committed, id).split(".")[1]));
    expect([...formats].toSorted((a, b) => String(a).localeCompare(String(b)))).toEqual([
      "csv",
      "pdf",
      "png",
      "xls",
      "xlsx",
    ]);
  });
});

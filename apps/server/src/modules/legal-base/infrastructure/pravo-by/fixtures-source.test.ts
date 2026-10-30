// NFR-11: источник из сохранённых страниц и сами фикстуры — у каждой в первой строке адрес источника и дата сохранения
// (.claude/rules/testing.md), нет файла — «текста нет» (как 404 на pravo.by), ID вне правила реквизитов не читается.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ActTextNotFound } from "../../application/ports.ts";
import { createFixturesSource } from "./fixtures-source.ts";

const DIR = fileURLToPath(new URL("../../__fixtures__/pravo-by", import.meta.url));
const NOW = new Date("2026-10-30T09:00:00Z");
const source = createFixturesSource({ dir: async () => DIR, now: () => NOW });

describe("фикстуры pravo.by", () => {
  it("в первой строке каждой — адрес источника на pravo.by и дата сохранения 2026-10-30", () => {
    const files = readdirSync(DIR).filter((name) => !name.endsWith(".ts"));
    expect(files.toSorted()).toEqual([
      "C21300569.html",
      "H10200090.html",
      "Hk0900071.html",
      "card-C20200778.html",
      "card-H10800369.html",
      "novye-postupleniya.html",
      "robots.txt",
    ]);
    for (const name of files) {
      const first = readFileSync(`${DIR}/${name}`, "utf8").split("\n", 1)[0] ?? "";
      expect([
        name,
        /Источник: https:\/\/pravo\.by\/\S+ · сохранено 2026-10-30/u.test(first),
      ]).toEqual([name, true]);
    }
  });

  it("в сохранённых страницах нет адреса электронной почты оператора загрузчика", () => {
    for (const name of readdirSync(DIR).filter((n) => !n.endsWith(".ts"))) {
      const text = readFileSync(`${DIR}/${name}`, "utf8");
      expect([name, /mailto:|User-Agent: Kosht/u.test(text)]).toEqual([name, false]);
    }
  });
});

describe("LegalSource из сохранённых страниц", () => {
  it("отдаёт страницу акта и момент получения из Clock", async () => {
    const page = await source.fetchActText("H10200090");
    expect(page.html).toContain("О защите прав потребителей");
    expect(page.fetchedAt).toEqual(NOW);
  });

  it("акта без страницы нет — «текста нет»; чужой ID не читается", async () => {
    await expect(source.fetchActText("H99999999")).rejects.toBeInstanceOf(ActTextNotFound);
    await expect(source.fetchActText("../etc/passwd")).rejects.toBeInstanceOf(RangeError);
  });
});

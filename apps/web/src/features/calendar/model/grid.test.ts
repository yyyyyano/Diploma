// CAL-01: сетка месяца — недели с понедельника, события по дням, соседние месяцы серые; переход между месяцами через границу года.
import type { CalendarEntry } from "@kosht/contract";
import { LocalDate } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import { buildCells, shiftMonth } from "./grid.ts";

const entry = (id: string, on: string | null): CalendarEntry =>
  ({ id, on }) as unknown as CalendarEntry;

describe("CAL-01: сетка месяца", () => {
  const cells = buildCells(
    "2026-10",
    LocalDate.parse("2026-09-28"),
    LocalDate.parse("2026-11-01"),
    [
      entry("a", "2026-10-23"),
      entry("b", "2026-10-23"),
      entry("c", "2026-09-30"),
      entry("d", null),
    ],
  );

  it("35 ячеек — пять недель с 28 сентября по 1 ноября", () => {
    expect(cells).toHaveLength(35);
    expect(cells[0]?.on).toBe("2026-09-28");
    expect(cells.at(-1)?.on).toBe("2026-11-01");
  });

  it("дни соседних месяцев — не «в месяце»; события — в своём дне, без даты — нигде", () => {
    expect(cells.filter((c) => c.inMonth)).toHaveLength(31);
    expect(cells.find((c) => c.on === "2026-10-23")?.entries.map((e) => e.id)).toEqual(["a", "b"]);
    expect(cells.find((c) => c.on === "2026-09-30")?.inMonth).toBe(false);
    expect(cells.flatMap((c) => c.entries).map((e) => e.id)).not.toContain("d");
  });

  it("соседний месяц: через границу года", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
    expect(shiftMonth("2026-10", 1)).toBe("2026-11");
  });
});

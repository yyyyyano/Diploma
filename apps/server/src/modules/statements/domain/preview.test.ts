// STMT-04, STMT-07: числа предпросмотра считает код.
import { describe, expect, it } from "vitest";
import { summarize } from "./preview.ts";

describe("STMT-04: итоги предпросмотра", () => {
  it("47 найдено, 12 уже были — к импорту 35; дубли и ошибки не смешиваются", () => {
    const rows = [
      ...Array.from({ length: 12 }, () => ({ duplicate: true, doubtful: false })),
      ...Array.from({ length: 35 }, (_, i) => ({ duplicate: false, doubtful: i < 3 })),
      { duplicate: false, doubtful: false, skipped: true },
    ];
    expect(summarize(rows)).toEqual({
      found: 47,
      duplicates: 12,
      newCount: 35,
      doubtful: 3,
      skipped: 1,
    });
  });

  it("повторная загрузка той же выписки: 0 новых", () => {
    const rows = Array.from({ length: 5 }, () => ({ duplicate: true, doubtful: true }));
    expect(summarize(rows)).toMatchObject({ found: 5, duplicates: 5, newCount: 0, doubtful: 0 });
  });
});

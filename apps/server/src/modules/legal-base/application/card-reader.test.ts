// T-039: карточка читается одним вызовом — повторное чтение того же акта в пределах срока не ходит на сайт.
import { FakeClock } from "@kosht/testing";
import { describe, expect, it } from "vitest";
import { makeCardReader } from "./card-reader.ts";

const HTML = `<html><body><b>Название акта</b><div>Тест</div></body></html>`;

function setup() {
  const clock = new FakeClock("2026-10-31T01:00:00Z");
  const asked: string[] = [];
  const read = makeCardReader({
    source: async () => ({
      fetchActCard: async (id) => {
        asked.push(id);
        return { html: HTML, fetchedAt: clock.now() };
      },
    }),
    clock,
  });
  return { clock, asked, read };
}

describe("карточка акта одним вызовом", () => {
  it("второе чтение той же карточки — из кэша, на сайт не ходим", async () => {
    const { asked, read } = setup();
    expect((await read("H10200090")).title).toBe("Тест");
    await read("H10200090");
    expect(asked).toEqual(["H10200090"]);
  });

  it("другой акт читается отдельно", async () => {
    const { asked, read } = setup();
    await read("H10200090");
    await read("Hk0900071");
    expect(asked).toEqual(["H10200090", "Hk0900071"]);
  });

  it("через 6 часов карточка читается заново: утрата силы не должна ждать вчерашней карточки", async () => {
    const { asked, read, clock } = setup();
    await read("H10200090");
    clock.advance(6 * 3_600_000 + 1);
    await read("H10200090");
    expect(asked).toEqual(["H10200090", "H10200090"]);
  });
});

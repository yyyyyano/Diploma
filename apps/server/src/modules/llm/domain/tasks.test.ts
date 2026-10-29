// ADM-50: состав задач и возможностей на проводе (контракт админки) и в шлюзе — один; задача без цепочки или
// возможность без подписи на сайте не появятся молча.
import { AI_CAPABILITIES, AI_TASKS } from "@kosht/contract";
import { describe, expect, it } from "vitest";
import { CAPABILITIES, LOCAL_ONLY_TASKS, TASKS } from "./tasks.ts";

describe("ADM-50: задачи и возможности — одни на проводе и в шлюзе", () => {
  it("задачи контракта совпадают с TASKS шлюза", () => {
    expect([...AI_TASKS].toSorted()).toEqual(Object.keys(TASKS).toSorted());
  });

  it("возможности контракта совпадают с CAPABILITIES шлюза", () => {
    expect([...AI_CAPABILITIES]).toEqual([...CAPABILITIES]);
  });

  it("NFR-05: «только локально» — векторы", () => {
    expect([...LOCAL_ONLY_TASKS]).toEqual(["embed"]);
  });
});

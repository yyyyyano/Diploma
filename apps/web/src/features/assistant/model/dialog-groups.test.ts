// CHAT-01: список диалогов — группы «Сегодня», «Вчера», «Ранее» по дню последнего сообщения в поясе системы.
import type { ConversationItem } from "@kosht/contract";
import { LocalDate } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import { groupDialogs, groupKeyOf } from "./dialog-groups.ts";

const TODAY = LocalDate.parse("2026-10-31");
const item = (id: string, updatedAt: string): ConversationItem => ({
  id: `0190f0a0-0000-7000-8000-00000000000${id}` as ConversationItem["id"],
  title: `Диалог ${id}`,
  updatedAt,
  preview: "",
});

describe("CHAT-01: группы диалогов", () => {
  it("день считается по Минску: 22:30 UTC 30 октября — уже 31-е, «сегодня»", () => {
    expect(groupKeyOf("2026-10-30T22:30:00.000Z", TODAY)).toBe("today");
    expect(groupKeyOf("2026-10-30T20:59:00.000Z", TODAY)).toBe("yesterday");
    expect(groupKeyOf("2026-10-12T10:00:00.000Z", TODAY)).toBe("earlier");
  });

  it("порядок внутри группы сохранён, пустые группы не возвращаются", () => {
    const groups = groupDialogs(
      [
        item("1", "2026-10-31T09:00:00.000Z"),
        item("2", "2026-10-31T07:00:00.000Z"),
        item("3", "2026-10-12T10:00:00.000Z"),
      ],
      TODAY,
    );
    expect(groups.map((group) => [group.key, group.items.map((d) => d.title)])).toEqual([
      ["today", ["Диалог 1", "Диалог 2"]],
      ["earlier", ["Диалог 3"]],
    ]);
  });

  it("нет диалогов — нет групп", () => {
    expect(groupDialogs([], TODAY)).toEqual([]);
  });
});

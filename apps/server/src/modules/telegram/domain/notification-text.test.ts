// NOTIF-01, BUD-03, CAL-07, TAX-20, TXN-10: текст уведомления в боте — по виду и параметрам, как на сайте.
import type { UserNotification } from "@kosht/contract";
import { createT } from "@kosht/i18n";
import { describe, expect, it } from "vitest";
import { notificationView } from "./notification-text.ts";

const t = createT();
const base = {
  id: "0194f3a2-7c1e-7b52-9a3d-4e5f6a7b8c9d",
  objectRef: null,
  decisionId: null,
  undoToken: null,
  read: false,
  createdAt: "2026-11-01T09:00:00.000Z",
} as const;
const note = (
  kind: UserNotification["kind"],
  params: UserNotification["params"] = {},
  extra: Partial<UserNotification> = {},
): UserNotification => ({ ...base, kind, params, ...extra });
const names = (key: string) => (key === "system:cafes" ? "Кафе, рестораны" : key);
const nbsp = (text: string) => text.replaceAll(" ", " ");

describe("текст уведомления для бота", () => {
  it("лимит 80 %: категория, суммы в BYN и «до конца месяца»; «Показать» — команда /limits", () => {
    const view = notificationView(
      t,
      note("limit", {
        category: "system:cafes",
        threshold: 80,
        percent: 84,
        spent: 42_000,
        limit: 50_000,
        daysLeft: 10,
      }),
      names,
    );
    expect(nbsp(view.text)).toBe(
      "Вы потратили 84% лимита на «Кафе, рестораны»: 420,00 BYN из 500,00 BYN. До конца месяца 10 дн.",
    );
    expect(view.show).toEqual({ command: "limits" });
  });

  it("лимит 100 % — «исчерпан»", () => {
    const view = notificationView(
      t,
      note("limit", {
        category: "system:cafes",
        threshold: 100,
        percent: 103,
        spent: 51_500,
        limit: 50_000,
        daysLeft: 3,
      }),
      names,
    );
    expect(view.text).toContain("исчерпан");
  });

  it("напоминание календаря: гарантия, срок по правилу, событие со своим названием", () => {
    const warranty = notificationView(
      t,
      note("calendar-reminder", { type: "warranty", title: "Холодильник", days: 7 }),
      names,
    );
    expect(warranty.text).toBe(
      "Гарантия на «Холодильник» заканчивается через 7 дней — проверьте, всё ли работает.",
    );
    const rule = notificationView(
      t,
      note("calendar-reminder", { type: "tax", rule: "transport-tax", days: 1 }),
      names,
    );
    expect(rule.text).toBe("Срок уплаты транспортного налога — завтра.");
    const own = notificationView(
      t,
      note("calendar-reminder", { title: "Страховка", days: 0 }),
      names,
    );
    expect(own.text).toBe("Напоминание: «Страховка» — сегодня.");
  });

  it("вычет на обучение называет сумму; цель — по причине; чек: привязан или вопрос", () => {
    expect(
      nbsp(
        notificationView(t, note("deduction", { kind: "education", amount: 26_000 }), names).text,
      ),
    ).toBe("Найден вычет на обучение: можно вернуть до 260,00 BYN.");
    expect(
      notificationView(t, note("goal", { reason: "done", name: "Отпуск", percent: 100 }), names)
        .text,
    ).toBe("Цель «Отпуск» достигнута: накоплено 100%.");
    const linked = notificationView(
      t,
      note(
        "receipt-match",
        { store: "Евроопт", date: "12.10", bankDate: "13.10" },
        { undoToken: "0194f3a2-7c1e-7b52-9a3d-4e5f6a7b8c01" },
      ),
      names,
    );
    expect(linked.text).toContain("привязан к платежу");
    const question = notificationView(
      t,
      note("receipt-match", { store: "Евроопт", date: "12.10", bankDate: "13.10" }),
      names,
    );
    expect(question.text).toContain("Это одна покупка?");
  });

  it("«Показать» ведёт к объекту; без объекта — кнопки нет", () => {
    const ref = { entity: "receipt", id: "0194f3a2-7c1e-7b52-9a3d-4e5f6a7b8c02" };
    expect(notificationView(t, note("receipt-review", {}, { objectRef: ref }), names).show).toEqual(
      { objectRef: ref },
    );
    expect(notificationView(t, note("data-export-ready"), names).show).toBeUndefined();
  });
});

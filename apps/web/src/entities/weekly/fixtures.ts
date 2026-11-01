// Ответ сервера «итоги недели» для тестов карточки главной и настроек: пример WEEK-01 (312 BYN — на 18 % больше обычного,
// лимит кафе 85 %, платежи недели 74 BYN). Тесты ничего не считают — проверяют показ.
import { WeeklySummary } from "@kosht/contract";

export const TRACE = "0190f0a0-0000-7000-8000-0000000000a1";
const byn = (minor: number) => ({ minor, currency: "BYN" });
const amount = (minor: number) => ({ amount: byn(minor), traceId: TRACE });

export const SUMMARY = WeeklySummary.parse({
  id: "0190f0a0-0000-7000-8000-0000000000c1",
  weekStart: "2026-10-26",
  weekEnd: "2026-11-01",
  spent: amount(31_200),
  average: amount(26_441),
  deviation: { percent: 18, traceId: TRACE },
  weeksUsed: 8,
  categories: [{ key: "system:taxi", name: "Такси", amount: amount(9000) }],
  limits: [{ name: "Кафе", percent: 85, limit: byn(20_000), traceId: TRACE }],
  upcoming: {
    from: "2026-11-02",
    to: "2026-11-08",
    payments: amount(7400),
    items: [
      { title: "Интернет", on: "2026-11-03", amount: byn(3000) },
      { title: "Рассрочка", on: "2026-11-05", amount: byn(4400) },
    ],
  },
  foundDeductions: 0,
  text: "На прошлой неделе вы потратили 312,00 BYN, на 18 % больше обычного. Больше всего — на Такси.",
  textSource: "template",
  createdAt: "2026-11-02T06:00:00.000Z",
});

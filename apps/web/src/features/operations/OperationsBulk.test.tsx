// TXN-04, CAT-05, AGT-07, P5: выбор строк → панель действий → вопрос «Да/Нет» с числом («Да, перенести 2») → «Отменить»;
// смена категории в карточке запоминает правило и спрашивает «Применить к N прошлым?».
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw.ts";
import {
  baseHandlers,
  coffee,
  DECISION,
  list,
  page,
  phone,
  renderPage,
  steam,
  T1,
  TOKEN,
} from "./__fixtures__/harness.tsx";

const NEXT = "0199f0a0-0000-7000-8000-0000000000de";

function decision(key: string, params: Record<string, string | number>) {
  return http.get("*/api/actions/decision", () =>
    HttpResponse.json({
      id: DECISION,
      status: "pending",
      summary: { key, params },
      createdAt: "2026-10-28T09:00:00.000Z",
    }),
  );
}

async function selectBoth() {
  await screen.findByText("Кофейня «Зерно»");
  await userEvent.click(
    screen.getByRole("checkbox", { name: "Выбрать операцию: Кофейня «Зерно»" }),
  );
  await userEvent.click(screen.getByRole("checkbox", { name: "Выбрать операцию: Steam" }));
}

describe("TXN-04: выбор строк и панель действий", () => {
  it("галочки строк — «Выбрано: 2» и действия; «Выбрать все показанные» и «Снять выделение»", async () => {
    server.use(
      ...baseHandlers(),
      list(() => page([coffee, steam])),
    );
    renderPage();
    await selectBoth();
    const bar = screen.getByRole("region", { name: "Действия с выбранными" });
    expect(within(bar).getByText("Выбрано: 2")).toBeInTheDocument();
    for (const name of ["Сменить категорию", "Пометить переводом", "Удалить", "Снять выделение"]) {
      expect(within(bar).getByRole("button", { name })).toBeInTheDocument();
    }
    await userEvent.click(within(bar).getByRole("button", { name: "Снять выделение" }));
    expect(screen.queryByRole("region", { name: "Действия с выбранными" })).toBeNull();
    await userEvent.click(screen.getByRole("checkbox", { name: "Выбрать все показанные" }));
    expect(screen.getByText("Выбрано: 2")).toBeInTheDocument();
  });

  it("выбор сбрасывается, когда меняется фильтр: «Расходы» — панели нет", async () => {
    server.use(
      ...baseHandlers(),
      list(() => page([coffee, steam])),
    );
    renderPage();
    await selectBoth();
    await userEvent.click(screen.getByRole("radio", { name: "Расходы" }));
    await expect
      .poll(() => screen.queryByRole("region", { name: "Действия с выбранными" }))
      .toBeNull();
  });

  it("телефон: галочка есть у каждой карточки", async () => {
    phone();
    server.use(
      ...baseHandlers(),
      list(() => page([coffee, steam])),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Выбрать операцию: Steam" }));
    expect(screen.getByText("Выбрано: 1")).toBeInTheDocument();
  });
});

describe("AGT-07, TXN-04: «Удалить» выбранные — вопрос с числом, «Да», «Отменить»", () => {
  it("«Да, удалить 2» шлёт ответ, «Удалил операций: 2» с «Отменить» шлёт undoToken", async () => {
    let asked: unknown;
    let answered: unknown;
    let undone: unknown;
    server.use(
      ...baseHandlers(),
      list(() => page([coffee, steam])),
      http.post("*/api/transactions/delete", async ({ request }) => {
        asked = await request.json();
        return HttpResponse.json({ decisionId: DECISION });
      }),
      decision("decisions.transactionsDelete", {
        count: 2,
        examples: "Кофейня «Зерно» 6,50 BYN; Steam 9,99 USD",
      }),
      http.post("*/api/actions/answer", async ({ request }) => {
        answered = await request.json();
        return HttpResponse.json({ status: "yes", undoToken: TOKEN });
      }),
      http.post("*/api/actions/undo", async ({ request }) => {
        undone = await request.json();
        return HttpResponse.json({ status: "undone" });
      }),
    );
    renderPage();
    await selectBoth();
    await userEvent.click(screen.getByRole("button", { name: "Удалить" }));
    await expect.poll(() => asked).toEqual({ ids: [T1, expect.any(String)] });
    expect(await screen.findByText(/Удалить 2 операции/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Да, удалить 2" }));
    expect(await screen.findByText("Удалил операций: 2.")).toBeInTheDocument();
    expect(answered).toMatchObject({ id: DECISION, answer: "yes" });
    expect(screen.queryByRole("region", { name: "Действия с выбранными" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Отменить" }));
    await expect.poll(() => undone).toEqual({ token: TOKEN });
  });
});

describe("TXN-04: «Пометить переводом» и «Сменить категорию»", () => {
  it("«Пометить переводом» → вопрос → «Да, пометить 2»", async () => {
    let asked: unknown;
    server.use(
      ...baseHandlers(),
      list(() => page([coffee, steam])),
      http.post("*/api/transactions/mark-transfer", async ({ request }) => {
        asked = await request.json();
        return HttpResponse.json({ decisionId: DECISION });
      }),
      decision("decisions.transactionsTransfer", {
        count: 2,
        examples: "Кофейня «Зерно» 6,50 BYN",
      }),
      http.post("*/api/actions/answer", () =>
        HttpResponse.json({ status: "yes", undoToken: TOKEN }),
      ),
    );
    renderPage();
    await selectBoth();
    await userEvent.click(screen.getByRole("button", { name: "Пометить переводом" }));
    await expect.poll(() => asked).toEqual({ ids: [T1, expect.any(String)] });
    await userEvent.click(await screen.findByRole("button", { name: "Да, пометить 2" }));
    expect(await screen.findByText("Пометил переводом: 2.")).toBeInTheDocument();
  });

  it("«Сменить категорию» → выбор «Такси» → «Продолжить» → вопрос → «Да, перенести 2»", async () => {
    let asked: unknown;
    server.use(
      ...baseHandlers(),
      list(() => page([coffee, steam])),
      http.post("*/api/transactions/change-category", async ({ request }) => {
        asked = await request.json();
        return HttpResponse.json({ decisionId: DECISION });
      }),
      decision("decisions.transactionsCategory", {
        count: 2,
        category: "Такси",
        examples: "Steam 9,99 USD",
      }),
      http.post("*/api/actions/answer", () =>
        HttpResponse.json({ status: "yes", undoToken: TOKEN }),
      ),
    );
    renderPage();
    await selectBoth();
    await userEvent.click(screen.getByRole("button", { name: "Сменить категорию" }));
    const dialog = await screen.findByRole("dialog", { name: "Сменить категорию" });
    expect(within(dialog).getByRole("button", { name: "Продолжить" })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("combobox", { name: "Категория" }));
    await userEvent.click(await screen.findByRole("option", { name: "Такси" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Продолжить" }));
    await expect
      .poll(() => asked)
      .toEqual({
        ids: [T1, expect.any(String)],
        category: { type: "system", code: "taxi" },
      });
    expect(await screen.findByText(/в «Такси»\?/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Да, перенести 2" }));
    expect(await screen.findByText("Перенёс операций: 2.")).toBeInTheDocument();
  });
});

describe("CAT-05: смена категории в карточке — правило и «Применить к N прошлым?»", () => {
  it("ответ с applyToPast открывает вопрос «Да, применить к 5»; «Да» — «Применил правило к операциям: 5»", async () => {
    let updated: unknown;
    let answered: unknown;
    server.use(
      ...baseHandlers(),
      list(() => page([coffee])),
      http.get("*/api/transactions/item", () =>
        HttpResponse.json({ transaction: coffee, rate: null, history: [] }),
      ),
      http.post("*/api/transactions/update", async ({ request }) => {
        updated = await request.json();
        return HttpResponse.json({
          transaction: { ...coffee, category: { type: "system", code: "taxi" }, version: 2 },
          undoToken: TOKEN,
          applyToPast: { decisionId: DECISION, count: 5 },
        });
      }),
      decision("decisions.transactionsApplyRule", {
        count: 5,
        merchant: "Кофейня «Зерно»",
        category: "Такси",
      }),
      http.post("*/api/actions/answer", async ({ request }) => {
        answered = await request.json();
        return HttpResponse.json({ status: "yes", undoToken: NEXT });
      }),
    );
    renderPage(`/operations?op=${T1}`);
    const panel = await screen.findByRole("dialog", { name: "Операция" });
    await userEvent.click(await within(panel).findByRole("combobox", { name: "Категория" }));
    await userEvent.click(await screen.findByRole("option", { name: "Такси" }));
    await expect
      .poll(() => updated)
      .toEqual({
        id: T1,
        expectedVersion: 1,
        patch: { category: { type: "system", code: "taxi" } },
      });
    expect(await screen.findByText(/Запомнили: «Кофейня «Зерно»» — «Такси»/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Да, применить к 5" }));
    expect(await screen.findByText("Применил правило к операциям: 5.")).toBeInTheDocument();
    expect(answered).toMatchObject({ id: DECISION, answer: "yes" });
  });
});

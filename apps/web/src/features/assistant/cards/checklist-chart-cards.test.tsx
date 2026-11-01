// LEGAL-12, AGT-02, DES-14, CHAT-04: чек-лист с сохраняемыми галочками и мини-график. Сеть — MSW.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { server } from "../../../test/msw.ts";
import { renderWithProviders } from "../../../test/render.tsx";
import { ChartCard } from "./ChartCard.tsx";
import { ChecklistCard } from "./ChecklistCard.tsx";

const MESSAGE = "0190f0a0-0000-7000-8000-0000000000b1";

function render(ui: ReactElement) {
  const root = createRootRoute();
  const page = createRoute({ getParentRoute: () => root, path: "/", component: () => ui });
  const stub = (path: string) =>
    createRoute({ getParentRoute: () => root, path, component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([page, stub("/operations"), stub("/documents")]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  renderWithProviders(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const conflict = {
  defined: true,
  code: "CONFLICT",
  status: 409,
  message: "CONFLICT",
  data: { requestId: "req-00000001", params: {} },
};

describe("LEGAL-12, CHAT-04: чек-лист с сохраняемыми галочками", () => {
  const view = (checked: boolean) => ({
    id: "return-good-quality",
    title: "Возврат товара надлежащего качества",
    summary: "Что сделать, чтобы вернуть товар.",
    items: [
      {
        id: "claim",
        kind: "step",
        text: "Напишите заявление продавцу",
        instance: { id: "seller", label: "Продавец" },
        deadline: "в течение 14 дней",
        norm: {
          ref: "ст. 28 Закона № 90-З",
          url: "https://pravo.by/document/?guid=3871&p0=H10200090",
          unsaved: false,
        },
        act: null,
        checked,
      },
      {
        id: "know",
        kind: "note",
        text: "Чек не обязателен",
        instance: null,
        deadline: null,
        norm: null,
        act: null,
        checked: null,
      },
    ],
    done: checked ? 1 : 0,
    total: 1,
  });

  it("состояние берётся у сервера за этим сообщением; отметка шлёт subject message и обновляет прогресс", async () => {
    const asked: unknown[] = [];
    const checked: unknown[] = [];
    server.use(
      http.post("*/api/legal-consult/checklist", async ({ request }) => {
        asked.push(await request.json());
        return HttpResponse.json(view(false));
      }),
      http.post("*/api/legal-consult/checklist/check", async ({ request }) => {
        checked.push(await request.json());
        return HttpResponse.json(view(true));
      }),
    );
    render(<ChecklistCard output={{ id: "return-good-quality" }} messageId={MESSAGE} />);
    const box = await screen.findByRole("checkbox", { name: "Напишите заявление продавцу" });
    expect(box).not.toBeChecked();
    expect(screen.getByText("Отмечено 0 из 1")).toBeInTheDocument();
    expect(screen.getByText("Срок: в течение 14 дней")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ст. 28 Закона № 90-З" })).toHaveAttribute(
      "href",
      "https://pravo.by/document/?guid=3871&p0=H10200090",
    );
    // У заметки галочки нет.
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    await userEvent.click(box);
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeChecked());
    expect(screen.getByText("Отмечено 1 из 1")).toBeInTheDocument();
    expect(asked[0]).toEqual({
      id: "return-good-quality",
      subject: { kind: "message", id: MESSAGE },
    });
    expect(checked).toEqual([
      {
        id: "return-good-quality",
        subject: { kind: "message", id: MESSAGE },
        item: "claim",
        done: true,
      },
    ]);
  });

  it("сохранить не удалось — сообщение, галочка остаётся прежней", async () => {
    server.use(
      http.post("*/api/legal-consult/checklist", () => HttpResponse.json(view(false))),
      http.post("*/api/legal-consult/checklist/check", () =>
        HttpResponse.json({ ...conflict, code: "INTERNAL", status: 500 }, { status: 500 }),
      ),
    );
    render(<ChecklistCard output={{ id: "return-good-quality" }} messageId={MESSAGE} />);
    await userEvent.click(await screen.findByRole("checkbox", { name: /заявление/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось сохранить отметку");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });
});

describe("AGT-02, DES-14: мини-график", () => {
  const chart = {
    kind: "bar",
    title: "Кафе по месяцам",
    unit: "money",
    currency: "BYN",
    labels: ["июн", "июл", "авг"],
    series: [{ name: "Кафе", values: [12000, 34050, 5000] }],
  };

  it("подписи и значения — готовые из данных (копейки → «340,50 BYN»), полоса длиннее у большего значения", () => {
    renderWithProviders(<ChartCard data={chart} />);
    const figure = screen.getByRole("figure", { name: "График «Кафе по месяцам»" });
    expect(figure).toHaveTextContent("июл");
    expect(figure).toHaveTextContent(/340,50\sBYN/);
    expect(figure).toHaveTextContent(/120,00\sBYN/);
    const fills = [...figure.querySelectorAll<HTMLElement>("span[style*=width]")];
    expect(fills.map((fill) => fill.style.width)).toEqual(["35%", "100%", "15%"]);
  });

  it("несколько рядов — легенда текстом, у линии — таблица значений для диктора", () => {
    renderWithProviders(
      <ChartCard
        data={{
          ...chart,
          kind: "line",
          series: [
            { name: "Кафе", values: [1, 2, 3] },
            { name: "Такси", values: [3, 2, 1] },
          ],
          unit: "count",
          currency: null,
        }}
      />,
    );
    expect(screen.getByText("Такси", { selector: "li" })).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Значения графика «Кафе по месяцам»" });
    expect(within(table).getAllByRole("row")).toHaveLength(4);
  });

  it("семь рядов или чужая форма — запасной вид, а не график", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      name: `р${String(i)}`,
      values: [1, 2, 3],
    }));
    renderWithProviders(<ChartCard data={{ ...chart, series: many }} />);
    expect(screen.getByText(/Карточка недоступна/)).toBeInTheDocument();
    expect(screen.queryByRole("figure")).toBeNull();
  });
});

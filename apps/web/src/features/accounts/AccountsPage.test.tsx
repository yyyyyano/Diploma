// DES-16, STMT-01: «Счета» в четырёх состояниях — загрузка, ошибка с повтором, пусто, список.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { AccountsPage } from "./AccountsPage.tsx";

const cash = {
  id: "0190f0a0-0000-7000-8000-0000000000c1",
  kind: "cash",
  name: null,
  balance: { minor: 0, currency: "BYN" },
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <AccountsPage />
    </QueryClientProvider>,
  );
}

describe("DES-16: состояния экрана «Счета»", () => {
  it("загрузка — скелетоны с «Загрузка…» для экранного диктора", async () => {
    server.use(
      http.get("*/api/accounts", async () => {
        await delay("infinite");
        return HttpResponse.json({ items: [] });
      }),
    );
    renderPage();
    expect(await screen.findAllByText("Загрузка…")).not.toHaveLength(0);
  });

  it("успех — «Наличные · 0,00 BYN» и счётчик «1 счёт»", async () => {
    server.use(http.get("*/api/accounts", () => HttpResponse.json({ items: [cash] })));
    renderPage();
    expect(await screen.findByRole("article", { name: "Наличные" })).toHaveTextContent("0,00");
    expect(screen.getByRole("heading", { level: 1, name: "Счета" })).toBeInTheDocument();
    expect(screen.getByText("1 счёт")).toBeInTheDocument();
  });

  it("пусто — что здесь будет", async () => {
    server.use(http.get("*/api/accounts", () => HttpResponse.json({ items: [] })));
    renderPage();
    expect(await screen.findByRole("heading", { name: "Счетов пока нет" })).toBeInTheDocument();
  });

  it("ошибка — что случилось, а «Попробовать ещё раз» загружает снова", async () => {
    let fail = true;
    server.use(
      http.get("*/api/accounts", () =>
        fail
          ? HttpResponse.json(
              {
                defined: false,
                code: "INTERNAL",
                status: 500,
                message: "INTERNAL",
                data: { requestId: "req-00000001", params: {} },
              },
              { status: 500 },
            )
          : HttpResponse.json({ items: [cash] }),
      ),
    );
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "Не удалось загрузить счета" }),
    ).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Попробовать ещё раз" }));
    expect(await screen.findByRole("article", { name: "Наличные" })).toBeInTheDocument();
  });
});

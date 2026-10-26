// AUTH-03: страница подтверждения сама шлёт POST один раз; ссылка устарела — LINK_INVALID; в адресе нет кода — так и
// сказано, запроса нет.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import type { VerifyEmailSearch } from "./model/verify-search.ts";
import { VerifyEmailPage } from "./VerifyEmailPage.tsx";

const TOKEN = "AbcDEF_ghij-KLMN0123456789abcdefghijklmnopq";

function renderVerify(search: VerifyEmailSearch) {
  const root = createRootRoute();
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: "/verify-email",
        component: () => <VerifyEmailPage search={search} />,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/verify-email"] }),
  });
  renderWithProviders(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("AUTH-03: подтверждение адреса", () => {
  it("код из ссылки уходит POST-запросом один раз — «Адрес подтверждён»", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post("*/api/identity/verify-email", async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ ok: true });
      }),
    );
    renderVerify({ token: TOKEN });
    expect(await screen.findByText(/Адрес подтверждён/)).toBeInTheDocument();
    expect(bodies).toEqual([{ token: TOKEN }]);
    expect(screen.getByRole("link", { name: "Перейти в Кошт" })).toHaveAttribute("href", "/");
  });

  it("ссылка использована или устарела — LINK_INVALID из словаря в role=alert", async () => {
    server.use(
      http.post("*/api/identity/verify-email", () =>
        HttpResponse.json(
          {
            defined: true,
            code: "LINK_INVALID",
            status: 410,
            message: "LINK_INVALID",
            data: { requestId: "req-00000001", params: {} },
          },
          { status: 410 },
        ),
      ),
    );
    renderVerify({ token: TOKEN });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ссылка уже использована или устарела. Запросите новое письмо.",
    );
  });

  it("в адресе нет кода — объяснение без запроса к серверу", async () => {
    renderVerify({});
    expect(await screen.findByRole("alert")).toHaveTextContent("В ссылке нет кода подтверждения");
  });
});

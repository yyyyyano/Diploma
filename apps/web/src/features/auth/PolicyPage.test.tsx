// PRIV-01: политика простым языком — цели, данные, хранение, сроки, права, кто видит; версия текста; закон на pravo.by.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { PolicyPage } from "./PolicyPage.tsx";

describe("PRIV-01: политика обработки персональных данных", () => {
  it("разделы, права списком, версия текста и ссылка на закон № 99-З", async () => {
    const root = createRootRoute();
    const router = createRouter({
      routeTree: root.addChildren([
        createRoute({ getParentRoute: () => root, path: "/policy", component: PolicyPage }),
      ]),
      history: createMemoryHistory({ initialEntries: ["/policy"] }),
    });
    renderWithProviders(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Политика обработки персональных данных",
      }),
    ).toBeInTheDocument();
    for (const name of [
      "Какие данные",
      "Зачем",
      "Где хранятся",
      "Сколько храним",
      "Ваши права",
      "Кто видит ваши данные",
    ]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
    const rights = screen.getByRole("heading", { name: "Ваши права" }).closest("section");
    if (rights === null) throw new Error("нет раздела прав");
    expect(within(rights).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText(/Версия текста от 26\.10\.2026/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Закон № 99-З на pravo.by" })).toHaveAttribute(
      "href",
      expect.stringMatching(/^https:\/\/pravo\.by\//),
    );
  });
});

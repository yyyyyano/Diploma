// PRIV-02: вкладка «Конфиденциальность». Облачное согласие: дать — окно с текстом и отметкой «прочитал(а)», на сервер
// уходит версия текста; отозвать — сразу, без окна; история решений с версией текста и ссылка на политику.
import { CONSENT_VERSIONS } from "@kosht/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { SettingsSearch } from "./model/search.ts";
import { SettingsPage } from "./SettingsPage.tsx";

const consentRecord = (id: number, kind: "personal-data" | "cloud", granted: boolean) => ({
  id: `019a2b3c-0000-7000-8000-00000000010${id}`,
  kind,
  granted,
  textVersion: "2026-10-26",
  at: "2026-10-26T09:00:00.000Z",
});

function renderTab(tab: "privacy") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute();
  const settingsRoute = createRoute({
    getParentRoute: () => root,
    path: "/settings",
    validateSearch: SettingsSearch,
    component: () => <SettingsPage search={settingsRoute.useSearch()} />,
  });
  const router = createRouter({
    routeTree: root.addChildren([
      settingsRoute,
      createRoute({ getParentRoute: () => root, path: "/login", component: () => <p>Вход</p> }),
      createRoute({
        getParentRoute: () => root,
        path: "/policy",
        component: () => <p>Политика</p>,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: [`/settings?tab=${tab}`] }),
  });
  renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { queryClient };
}

describe("PRIV-02: вкладка «Конфиденциальность»", () => {
  it("облака нет — «Локальный режим»; включение — окно согласия, «Дать согласие» ждёт отметки, уходит версия текста", async () => {
    const sent: unknown[] = [];
    server.use(
      http.get("*/api/privacy", () =>
        HttpResponse.json({
          cloud: { granted: false, since: null, outdated: false },
          history: [consentRecord(1, "cloud", false), consentRecord(2, "personal-data", true)],
        }),
      ),
      http.post("*/api/privacy/cloud-consent", async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({
          cloud: { granted: true, since: "2026-10-28T09:00:00.000Z", outdated: false },
          history: [
            { ...consentRecord(3, "cloud", true), at: "2026-10-28T09:00:00.000Z" },
            consentRecord(1, "cloud", false),
            consentRecord(2, "personal-data", true),
          ],
        });
      }),
    );
    renderTab("privacy");
    expect(await screen.findByRole("heading", { name: "Локальный режим" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: "Разрешить облачные ИИ-модели" }));
    const dialog = await screen.findByRole("dialog", { name: "Согласие на облачную обработку" });
    const submit = within(dialog).getByRole("button", { name: "Дать согласие" });
    expect(submit).toBeDisabled();
    expect(sent).toEqual([]);
    await userEvent.click(within(dialog).getByRole("checkbox"));
    await userEvent.click(submit);
    expect(
      await screen.findByRole("heading", { name: "Облачные ИИ-модели: разрешены с 28.10.2026" }),
    ).toBeInTheDocument();
    expect(sent).toEqual([{ granted: true, version: CONSENT_VERSIONS.cloud }]);
    expect(screen.getByText("Согласие дано — облачные модели работают.")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(4);
  });

  it("T-023: условия обновились — «Нужно подтвердить», облако выключено, повторное согласие — через окно с новым текстом", async () => {
    server.use(
      http.get("*/api/privacy", () =>
        HttpResponse.json({
          cloud: { granted: false, since: null, outdated: true },
          history: [consentRecord(1, "cloud", true)],
        }),
      ),
    );
    renderTab("privacy");
    expect(
      await screen.findByRole("heading", { name: "Условия обновились — облако выключено" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Нужно подтвердить")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Разрешить облачные ИИ-модели" })).not.toBeChecked();
    await userEvent.click(screen.getByRole("switch", { name: "Разрешить облачные ИИ-модели" }));
    const dialog = await screen.findByRole("dialog", { name: "Согласие на облачную обработку" });
    expect(within(dialog).getByText(/сканы выписок/)).toBeInTheDocument();
  });

  it("отзыв — сразу, без окна: уходит granted: false, локальный режим включён", async () => {
    const sent: unknown[] = [];
    server.use(
      http.get("*/api/privacy", () =>
        HttpResponse.json({
          cloud: { granted: true, since: "2026-10-26T09:00:00.000Z", outdated: false },
          history: [consentRecord(1, "cloud", true)],
        }),
      ),
      http.post("*/api/privacy/cloud-consent", async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({
          cloud: { granted: false, since: null, outdated: false },
          history: [consentRecord(2, "cloud", false), consentRecord(1, "cloud", true)],
        });
      }),
    );
    renderTab("privacy");
    await userEvent.click(
      await screen.findByRole("switch", { name: "Разрешить облачные ИИ-модели" }),
    );
    expect(
      await screen.findByText("Согласие отозвано — локальный режим включён сразу."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sent).toEqual([{ granted: false, version: CONSENT_VERSIONS.cloud }]);
    expect(screen.getByRole("heading", { name: "Локальный режим" })).toBeInTheDocument();
  });

  it("история: вид согласия, версия текста, дата и статус; ссылка на политику", async () => {
    server.use(
      http.get("*/api/privacy", () =>
        HttpResponse.json({
          cloud: { granted: false, since: null, outdated: false },
          history: [consentRecord(1, "cloud", false), consentRecord(2, "personal-data", true)],
        }),
      ),
    );
    renderTab("privacy");
    const rows = await screen.findAllByRole("row");
    expect(rows.slice(1).map((row) => row.textContent)).toEqual([
      "Облачные ИИ-моделиТекст от 26.10.202626.10.2026Не дано",
      "Обработка персональных данныхТекст от 26.10.202626.10.2026Дано",
    ]);
    expect(screen.getByRole("link", { name: "Политика обработки данных" })).toHaveAttribute(
      "href",
      "/policy",
    );
  });
});

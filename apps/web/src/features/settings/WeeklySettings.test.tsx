// WEEK-03: настройки «Итоги недели» — выключить, день недели и время; сохраняется сразу; выключенные поля неактивны. Сеть — MSW.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { WeeklySettings } from "./WeeklySettings.tsx";

interface Saved {
  enabled: boolean;
  weekday: number;
  time: string;
}

function backend(initial: Saved = { enabled: true, weekday: 1, time: "09:00" }) {
  const saved: Saved[] = [];
  let current = initial;
  server.use(
    http.get("*/api/weekly/preferences", () => HttpResponse.json(current)),
    http.post("*/api/weekly/preferences", async ({ request }) => {
      current = (await request.json()) as Saved;
      saved.push(current);
      return HttpResponse.json(current);
    }),
  );
  renderWithProviders(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <WeeklySettings />
    </QueryClientProvider>,
  );
  return saved;
}

describe("WEEK-03: настройки итогов недели", () => {
  it("значения с сервера: включено, понедельник, 09:00", async () => {
    backend();
    expect(await screen.findByRole("switch", { name: "Присылать итоги недели" })).toBeChecked();
    expect(screen.getByLabelText("День недели")).toHaveValue("1");
    expect(screen.getByLabelText("Время")).toHaveValue("09:00");
  });

  it("день недели сохраняется сразу, с прежним временем и флагом", async () => {
    const saved = backend();
    await userEvent.selectOptions(await screen.findByLabelText("День недели"), "5");
    await waitFor(() => expect(saved.at(-1)).toEqual({ enabled: true, weekday: 5, time: "09:00" }));
  });

  it("время сохраняется, когда поле покинули и оно верное", async () => {
    const saved = backend();
    const time = await screen.findByLabelText("Время");
    await userEvent.clear(time);
    await userEvent.type(time, "18:30");
    await userEvent.tab();
    await waitFor(() => expect(saved.at(-1)).toEqual({ enabled: true, weekday: 1, time: "18:30" }));
  });

  it("выключение сохраняется, день и время становятся неактивными", async () => {
    const saved = backend();
    await userEvent.click(await screen.findByRole("switch", { name: "Присылать итоги недели" }));
    await waitFor(() => expect(saved.at(-1)?.enabled).toBe(false));
    await waitFor(() => expect(screen.getByLabelText("День недели")).toBeDisabled());
    expect(screen.getByLabelText("Время")).toBeDisabled();
  });

  it("настройки не загрузились — строка с причиной", async () => {
    server.use(
      http.get("*/api/weekly/preferences", () =>
        HttpResponse.json(
          {
            defined: true,
            code: "INTERNAL",
            status: 500,
            message: "INTERNAL",
            data: { requestId: "r-1", params: {} },
          },
          { status: 500 },
        ),
      ),
    );
    renderWithProviders(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <WeeklySettings />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Не удалось сохранить настройки итогов недели",
    );
  });
});

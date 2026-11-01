// CAL-06, AGT-05, CHAT-04, P5: карточка события в чате — результат `create_event`: название, день, когда напомню, «Отменить» по токену
// и «Показать в календаре». Не по схеме — ничего лишнего. Сеть — MSW.
import { assistantTexts } from "@kosht/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../../test/msw.ts";
import { renderWithProviders } from "../../../test/render.tsx";
import { EventCard } from "./EventCard.tsx";

const TOKEN = "0190f0a0-0000-7000-8000-0000000000aa";
const UNAVAILABLE = assistantTexts.cards.unavailable;
const EVENT = {
  id: "0190f0a0-0000-7000-8000-0000000000f2",
  type: "own",
  title: "Оплатить кружок",
  rule: null,
  on: "2026-12-01",
  amount: null,
  approx: false,
  direction: null,
  traceId: null,
  stored: true,
  remindDays: [7, 1],
  canDelete: true,
  origin: { kind: "chat", params: {} },
  ref: null,
};

function render(output: unknown) {
  renderWithProviders(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <EventCard output={output} />
    </QueryClientProvider>,
  );
}

describe("CAL-06, CHAT-04: карточка события в чате", () => {
  it("«Создал событие», название, день недели и дата, когда напомню; ссылка на календарь", async () => {
    render({ event: EVENT, undoToken: TOKEN });
    expect(await screen.findByText("Создал событие")).toBeInTheDocument();
    expect(screen.getByText("Оплатить кружок")).toBeInTheDocument();
    expect(
      screen.getByText(/Вторник, 1 декабря 2026 · Напомню: за 7 дней и за 1 день/u),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Показать в календаре" })).toHaveAttribute(
      "href",
      `/calendar?event=${EVENT.id}`,
    );
  });

  it("«Отменить» шлёт токен и сообщает, что напоминания не будет", async () => {
    let body: unknown;
    server.use(
      http.post("*/api/actions/undo", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ status: "undone" });
      }),
    );
    render({ event: EVENT, undoToken: TOKEN });
    await userEvent.click(await screen.findByRole("button", { name: "Отменить" }));
    await waitFor(() => expect(body).toEqual({ token: TOKEN }));
    expect(await screen.findByText(/Событие отменено — напоминания не будет/u)).toBeInTheDocument();
  });

  it("результат не по схеме — «недоступно», а не пустая карточка", async () => {
    render({ nothing: true });
    expect(screen.queryByText("Создал событие")).toBeNull();
    expect(screen.getByText(UNAVAILABLE)).toBeInTheDocument();
  });
});

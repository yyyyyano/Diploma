// P5, AGT-07: «Отменить» шлёт undoToken в actions.undo и сообщает итог; «Да» шлёт ответ в actions.answer, вопрос —
// из словаря по ключу решения с параметрами (нет текста — запасной).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { DecisionDialog } from "./DecisionDialog.tsx";
import { UndoActionToast, type UndoResult } from "./UndoActionToast.tsx";

const TOKEN = "0199f0a0-0000-7000-8000-0000000000c1";
const DECISION = "0199f0a0-0000-7000-8000-0000000000d1";

function render(ui: ReactElement) {
  renderWithProviders(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>,
  );
}

describe("P5: «Отменить»", () => {
  it("кнопка шлёт undoToken, итог — отменено", async () => {
    let body: unknown;
    const results: UndoResult[] = [];
    server.use(
      http.post("*/api/actions/undo", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ status: "undone" });
      }),
    );
    render(
      <UndoActionToast
        token={TOKEN}
        message="Записал в «Кафе»"
        opened
        onClose={() => {}}
        onResult={(r) => results.push(r)}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Отменить" }));
    await expect.poll(() => results).toEqual([{ ok: true }]);
    expect(body).toEqual({ token: TOKEN });
  });

  it("объект уже правили (CONFLICT) — итог с ошибкой", async () => {
    const results: UndoResult[] = [];
    server.use(
      http.post("*/api/actions/undo", () =>
        HttpResponse.json(
          {
            defined: true,
            code: "CONFLICT",
            status: 409,
            message: "CONFLICT",
            data: { requestId: "req-00000001", params: {} },
          },
          { status: 409 },
        ),
      ),
    );
    render(
      <UndoActionToast
        token={TOKEN}
        message="Записал"
        opened
        onClose={() => {}}
        onResult={(r) => results.push(r)}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Отменить" }));
    await expect.poll(() => results.map((r) => r.ok)).toEqual([false]);
  });
});

describe("AGT-07: ожидающее решение «Да/Нет»", () => {
  it("вопрос из словаря (запасной для неизвестного ключа), «Да, выполнить» шлёт ответ yes", async () => {
    let body: unknown;
    const answered: string[] = [];
    server.use(
      http.get("*/api/actions/decision", () =>
        HttpResponse.json({
          id: DECISION,
          status: "pending",
          summary: { key: "decisions.unknownKind", params: { count: 23 } },
          createdAt: "2026-10-26T09:00:00.000Z",
        }),
      ),
      http.post("*/api/actions/answer", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ status: "yes" });
      }),
    );
    render(
      <DecisionDialog
        decisionId={DECISION}
        opened
        onClose={() => {}}
        onAnswered={(s) => answered.push(s)}
      />,
    );
    expect(await screen.findByText("Выполнить это действие?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Да, выполнить" }));
    await expect.poll(() => answered).toEqual(["yes"]);
    expect(body).toEqual({ id: DECISION, answer: "yes" });
  });

  it("решение уже принято — окно не показывается", async () => {
    server.use(
      http.get("*/api/actions/decision", () =>
        HttpResponse.json({
          id: DECISION,
          status: "yes",
          summary: { key: "decisions.fallback", params: {} },
          createdAt: "2026-10-26T09:00:00.000Z",
        }),
      ),
    );
    render(<DecisionDialog decisionId={DECISION} opened onClose={() => {}} />);
    await expect.poll(() => screen.queryByRole("dialog")).toBeNull();
  });

  it("«Да» отдаёт undoToken — страница показывает «Отменить» после удаления", async () => {
    const answered: { status: string; undoToken: string | null }[] = [];
    server.use(
      http.get("*/api/actions/decision", () =>
        HttpResponse.json({
          id: DECISION,
          status: "pending",
          summary: { key: "decisions.fallback", params: {} },
          createdAt: "2026-10-26T09:00:00.000Z",
        }),
      ),
      http.post("*/api/actions/answer", () =>
        HttpResponse.json({ status: "yes", undoToken: TOKEN }),
      ),
    );
    render(
      <DecisionDialog
        decisionId={DECISION}
        opened
        onClose={() => {}}
        onAnswered={(status, undoToken) => answered.push({ status, undoToken })}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Да, выполнить" }));
    await expect.poll(() => answered).toEqual([{ status: "yes", undoToken: TOKEN }]);
  });

  it("STMT-01: «Да» на удаление счёта с операциями — CONFLICT с понятным текстом, окно остаётся", async () => {
    server.use(
      http.get("*/api/actions/decision", () =>
        HttpResponse.json({
          id: DECISION,
          status: "pending",
          summary: { key: "decisions.accountDelete", params: { name: "Карта" } },
          createdAt: "2026-10-26T09:00:00.000Z",
        }),
      ),
      http.post("*/api/actions/answer", () =>
        HttpResponse.json(
          {
            defined: true,
            code: "CONFLICT",
            status: 409,
            message: "CONFLICT",
            data: { requestId: "req-00000001", params: { reason: "account-has-transactions" } },
          },
          { status: 409 },
        ),
      ),
    );
    render(<DecisionDialog decisionId={DECISION} opened onClose={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Да, выполнить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "В этом счёте есть операции — удалить его нельзя.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("кнопка «Да» может называть действие с числом («Да, перенести 13»)", async () => {
    server.use(
      http.get("*/api/actions/decision", () =>
        HttpResponse.json({
          id: DECISION,
          status: "pending",
          summary: { key: "decisions.fallback", params: {} },
          createdAt: "2026-10-26T09:00:00.000Z",
        }),
      ),
    );
    render(
      <DecisionDialog
        decisionId={DECISION}
        opened
        onClose={() => {}}
        confirmLabel="Да, перенести 13"
      />,
    );
    expect(await screen.findByRole("button", { name: "Да, перенести 13" })).toBeInTheDocument();
  });
});

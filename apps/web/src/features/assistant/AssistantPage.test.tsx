// CHAT-02, DES-16: «Ассистент» — история, поток ответа (подпись шага из словаря, карточка счёта, текст), «Остановить»
// зовёт chat.stop(runId), ошибка загрузки — что случилось и повтор. Сеть — MSW: SSE в форме OpenAPIHandler oRPC.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { AssistantPage } from "./AssistantPage.tsx";

const RUN = "0190f0a0-0000-7000-8000-0000000000a1";
const DIALOG = "0190f0a0-0000-7000-8000-0000000000d1";
const ACCOUNT = "0190f0a0-0000-7000-8000-0000000000c1";
const cash = { id: ACCOUNT, kind: "cash", name: null, balance: { minor: 0, currency: "BYN" } };

function sseText(chunks: readonly unknown[]): string {
  return `${chunks.map((chunk) => `event: message\ndata: ${JSON.stringify(chunk)}\n\n`).join("")}event: done\n\n`;
}

const answer = [
  {
    type: "start",
    messageId: "0190f0a0-0000-7000-8000-0000000000m1",
    messageMetadata: { runId: RUN, conversationId: DIALOG },
  },
  { type: "start-step" },
  { type: "tool-input-start", toolCallId: "call-1", toolName: "list_accounts" },
  { type: "tool-input-available", toolCallId: "call-1", toolName: "list_accounts", input: {} },
  { type: "tool-output-available", toolCallId: "call-1", output: { items: [cash] } },
  { type: "finish-step" },
  { type: "start-step" },
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: "Вот ваши счета." },
  { type: "text-end", id: "t1" },
  { type: "finish-step" },
  { type: "finish" },
];

function emptyHistory() {
  server.use(
    http.get("*/api/chat/history", () => HttpResponse.json({ conversationId: null, messages: [] })),
  );
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <AssistantPage />
    </QueryClientProvider>,
  );
}

async function ask(question: string) {
  await userEvent.type(await screen.findByRole("textbox", { name: "Вопрос ассистенту" }), question);
  await userEvent.click(screen.getByRole("button", { name: "Отправить" }));
}

describe("CHAT-02: поток ответа", () => {
  it("вопрос → карточка «Наличные» по результату list_accounts и текст ответа; вехи — в живой области", async () => {
    emptyHistory();
    let sent: unknown;
    server.use(
      http.post("*/api/chat/send", async ({ request }) => {
        sent = await request.json();
        return new HttpResponse(sseText(answer), {
          headers: { "content-type": "text/event-stream" },
        });
      }),
    );
    renderPage();
    expect(
      await screen.findByText("Спросите, например: «Какие у меня счета?»"),
    ).toBeInTheDocument();
    await ask("Какие у меня счета?");
    const feed = screen.getByRole("log", { name: "Переписка с ассистентом" });
    expect(feed).toHaveAttribute("aria-live", "off");
    expect(await within(feed).findByText("Вот ваши счета.")).toBeInTheDocument();
    expect(within(feed).getByRole("article", { name: "Наличные" })).toHaveTextContent("0,00");
    expect(within(feed).getByText("Какие у меня счета?")).toBeInTheDocument();
    expect(sent).toEqual({ text: "Какие у меня счета?" });
    expect(screen.getByText("Ответ готов.")).toBeInTheDocument();
  });

  it("пока идёт шаг — подпись из словаря tools; «Остановить» зовёт chat.stop с runId", async () => {
    emptyHistory();
    let stopped: unknown;
    server.use(
      http.post("*/api/chat/send", () => {
        const encoder = new TextEncoder();
        const body = new ReadableStream({
          async start(controller) {
            controller.enqueue(
              encoder.encode(sseText(answer.slice(0, 4)).replace("event: done\n\n", "")),
            );
            await delay("infinite");
          },
        });
        return new HttpResponse(body, { headers: { "content-type": "text/event-stream" } });
      }),
      http.post("*/api/chat/stop", async ({ request }) => {
        stopped = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    renderPage();
    await ask("Какие у меня счета?");
    expect(await screen.findByText("Смотрю ваши счета…")).toBeInTheDocument();
    expect(screen.getByText("Ассистент отвечает…")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Остановить ответ" }));
    await waitFor(() => expect(stopped).toEqual({ runId: RUN }));
    expect(await screen.findByText("Ответ остановлен.")).toBeInTheDocument();
  });
});

describe("DES-16: состояния", () => {
  it("история: прошлый вопрос и ответ с карточкой видны сразу; оборванный ответ помечен", async () => {
    server.use(
      http.get("*/api/chat/history", () =>
        HttpResponse.json({
          conversationId: DIALOG,
          messages: [
            {
              id: "0190f0a0-0000-7000-8000-0000000000e1",
              role: "user",
              status: "complete",
              parts: [{ type: "text", text: "Какие у меня счета?" }],
            },
            {
              id: "0190f0a0-0000-7000-8000-0000000000e2",
              role: "assistant",
              status: "interrupted",
              parts: [
                {
                  type: "tool-list_accounts",
                  toolCallId: "call-1",
                  state: "output-available",
                  input: {},
                  output: { items: [cash] },
                },
              ],
            },
          ],
        }),
      ),
    );
    renderPage();
    expect(await screen.findByRole("article", { name: "Наличные" })).toBeInTheDocument();
    expect(screen.getByText("Ответ прерван — задайте вопрос ещё раз.")).toBeInTheDocument();
  });

  it("история не загрузилась — что случилось и «Попробовать ещё раз»", async () => {
    let fail = true;
    server.use(
      http.get("*/api/chat/history", () =>
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
          : HttpResponse.json({ conversationId: null, messages: [] }),
      ),
    );
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "Не удалось загрузить переписку" }),
    ).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Попробовать ещё раз" }));
    expect(await screen.findByRole("textbox", { name: "Вопрос ассистенту" })).toBeInTheDocument();
  });

  it("загрузка истории — скелетон с «Загрузка…»", async () => {
    server.use(
      http.get("*/api/chat/history", async () => {
        await delay("infinite");
        return HttpResponse.json({ conversationId: null, messages: [] });
      }),
    );
    renderPage();
    expect(await screen.findByText("Загрузка…")).toBeInTheDocument();
  });
});

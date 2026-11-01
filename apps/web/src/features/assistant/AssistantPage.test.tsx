// CHAT-01, CHAT-02, CHAT-08, CHAT-09, LLM-10, PRIV-02, NFR-21, DES-16: страница «Ассистент» — диалоги (список, смена,
// переименование, удаление), поток ответа (шаг из словаря, карточка счёта, Markdown), контекст страницы в вопросе,
// подсказки, плашка «Локальный режим», выбор модели, «ещё отвечает», ограничение частоты. Сеть — MSW: SSE в форме oRPC.
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
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { orpc } from "../../lib/api.ts";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { AssistantPage } from "./AssistantPage.tsx";
import { AssistantSearch } from "./model/search.ts";

const RUN = "0190f0a0-0000-7000-8000-0000000000a1";
const D1 = "0190f0a0-0000-7000-8000-0000000000d1";
const D2 = "0190f0a0-0000-7000-8000-0000000000d2";
const ACCOUNT = "0190f0a0-0000-7000-8000-0000000000c1";
const cash = {
  id: ACCOUNT,
  kind: "cash",
  name: null,
  bank: null,
  mask: null,
  balance: { minor: 0, currency: "BYN" },
  balanceOn: "2026-10-28",
  balanceSource: "manual",
  initialBalance: { minor: 0, currency: "BYN" },
  balanceInByn: null,
  rate: null,
};

function sseText(chunks: readonly unknown[]): string {
  return `${chunks.map((chunk) => `event: message\ndata: ${JSON.stringify(chunk)}\n\n`).join("")}event: done\n\n`;
}

const start = {
  type: "start",
  messageId: "0190f0a0-0000-7000-8000-0000000000b1",
  messageMetadata: { runId: RUN, conversationId: D1 },
};

const answer = [
  start,
  { type: "start-step" },
  { type: "tool-input-start", toolCallId: "call-1", toolName: "list_accounts" },
  { type: "tool-input-available", toolCallId: "call-1", toolName: "list_accounts", input: {} },
  { type: "tool-output-available", toolCallId: "call-1", output: { items: [cash] } },
  { type: "finish-step" },
  { type: "start-step" },
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: "Вот ваши **счета**." },
  { type: "text-end", id: "t1" },
  { type: "finish-step" },
  { type: "finish" },
];

const item = (id: string, title: string, updatedAt: string, preview = "") => ({
  id,
  title,
  updatedAt,
  preview,
});

interface Backend {
  readonly conversations?: readonly ReturnType<typeof item>[];
  readonly histories?: Readonly<Record<string, { title: string | null; messages: unknown[] }>>;
  readonly cloud?: boolean;
  readonly models?: { items: unknown[]; selected: string | null };
}

/** Общие ответы сервера; тест дописывает свои `server.use` до вызова renderPage — они приоритетнее. */
function backend(b: Backend = {}) {
  server.use(
    http.get("*/api/chat/conversations", () => HttpResponse.json({ items: b.conversations ?? [] })),
    http.get("*/api/chat/history", ({ request }) => {
      const id = new URL(request.url).searchParams.get("conversationId") ?? "";
      const found = b.histories?.[id];
      return found === undefined
        ? HttpResponse.json({ conversationId: null, title: null, messages: [] })
        : HttpResponse.json({ conversationId: id, ...found });
    }),
    http.get("*/api/privacy", () =>
      HttpResponse.json({
        cloud: { granted: b.cloud ?? true, since: null, outdated: false },
        history: [],
      }),
    ),
    http.get("*/api/llm/models", () =>
      HttpResponse.json(b.models ?? { items: [], selected: null }),
    ),
  );
}

function renderPage(search: Record<string, unknown> = {}) {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: "/assistant",
    validateSearch: AssistantSearch,
    staticData: { page: "assistant" },
    component: () => <AssistantPage search={page.useSearch()} />,
  });
  const stub = (path: string) =>
    createRoute({ getParentRoute: () => root, path, component: () => null });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const query = new URLSearchParams(search as Record<string, string>).toString();
  const router = createRouter({
    routeTree: root.addChildren([page, stub("/memory"), stub("/settings")]),
    history: createMemoryHistory({
      initialEntries: [`/assistant${query === "" ? "" : `?${query}`}`],
    }),
    context: {},
  });
  renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { queryClient, router };
}

async function ask(question: string) {
  await userEvent.type(await screen.findByRole("textbox", { name: "Вопрос ассистенту" }), question);
  await userEvent.click(screen.getByRole("button", { name: "Отправить" }));
}

function sendOnce(chunks: readonly unknown[]) {
  const sent: unknown[] = [];
  server.use(
    http.post("*/api/chat/send", async ({ request }) => {
      sent.push(await request.json());
      return new HttpResponse(sseText(chunks), {
        headers: { "content-type": "text/event-stream" },
      });
    }),
  );
  return sent;
}

describe("CHAT-02: поток ответа", () => {
  it("вопрос → шаг из словаря, карточка «Наличные», текст как Markdown; вехи — в живой области, лента без aria-live", async () => {
    backend();
    const sent = sendOnce(answer);
    renderPage();
    await ask("Какие у меня счета?");
    const feed = screen.getByRole("log", { name: "Переписка с ассистентом" });
    expect(feed).toHaveAttribute("aria-live", "off");
    expect(await within(feed).findByText("счета")).toHaveProperty("tagName", "STRONG");
    expect(within(feed).getByText("Смотрю ваши счета…")).toBeInTheDocument();
    expect(within(feed).getByRole("article", { name: "Наличные" })).toHaveTextContent("0,00");
    expect(within(feed).getByText("Какие у меня счета?")).toBeInTheDocument();
    expect(screen.getByText("Ответ готов.")).toBeInTheDocument();
    expect(sent).toHaveLength(1);
  });

  it("CHAT-08: вместе с вопросом уходит контекст страницы — маршрут и параметры адреса", async () => {
    backend();
    const sent = sendOnce(answer);
    renderPage();
    await ask("Почему так много на такси?");
    await screen.findByText("Ответ готов.");
    expect(sent[0]).toMatchObject({
      text: "Почему так много на такси?",
      page: { route: "/assistant" },
    });
  });

  it("пока идёт шаг — подпись из словаря; «Остановить» зовёт chat.stop с runId", async () => {
    backend();
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

  it("SEC-02: слишком частые вопросы — «Попробуйте через N мин.» из ответа сервера", async () => {
    backend();
    server.use(
      http.post("*/api/chat/send", () =>
        HttpResponse.json(
          {
            defined: true,
            code: "RATE_LIMITED",
            status: 429,
            message: "RATE_LIMITED",
            data: { requestId: "req-00000001", params: { retryAfterMinutes: 2 } },
          },
          { status: 429 },
        ),
      ),
    );
    renderPage();
    await ask("Ещё вопрос");
    expect(
      await screen.findAllByText("Слишком много вопросов подряд. Попробуйте через 2 мин."),
    ).not.toHaveLength(0);
  });
});

describe("SEC-05: вредная разметка в ответе", () => {
  it("ссылка на чужой сайт и картинка не рисуются, ссылка на pravo.by — рисуется", async () => {
    backend();
    sendOnce([
      start,
      { type: "text-start", id: "t1" },
      {
        type: "text-delta",
        id: "t1",
        delta:
          "[чужая](https://evil.example/) ![х](https://evil.example/x.png) [НК](https://pravo.by/document/?guid=1)",
      },
      { type: "text-end", id: "t1" },
      { type: "finish" },
    ]);
    renderPage();
    await ask("Покажи ссылки");
    const feed = screen.getByRole("log", { name: "Переписка с ассистентом" });
    expect(await within(feed).findByRole("link", { name: "НК" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
    expect(within(feed).queryByRole("link", { name: "чужая" })).toBeNull();
    expect(feed.querySelector("img")).toBeNull();
  });
});

describe("CHAT-09: подсказки", () => {
  it("пустой диалог — приветствие и четыре группы подсказок; нажатие отправляет вопрос", async () => {
    backend();
    const sent = sendOnce(answer);
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "Здравствуйте! Чем помочь?" }),
    ).toBeInTheDocument();
    for (const group of ["Траты", "Вычеты", "Права потребителя", "Крупная покупка"]) {
      expect(screen.getByRole("heading", { name: group })).toBeInTheDocument();
    }
    await userEvent.click(screen.getByRole("button", { name: "Какие вычеты мне положены?" }));
    await screen.findByText("Ответ готов.");
    expect(sent[0]).toMatchObject({ text: "Какие вычеты мне положены?" });
  });

  it("после ответа — подсказки «А в прошлом месяце?», «Показать операции»", async () => {
    backend();
    sendOnce(answer);
    renderPage();
    await ask("Какие у меня счета?");
    const follow = await screen.findByRole("list", { name: "Что спросить дальше" });
    expect(within(follow).getByRole("button", { name: "А в прошлом месяце?" })).toBeInTheDocument();
    expect(within(follow).getByRole("button", { name: "Показать операции" })).toBeInTheDocument();
  });
});

describe("CHAT-01: диалоги", () => {
  const TODAY = new Date().toISOString();
  const OLD = "2026-09-01T10:00:00.000Z";
  const base = {
    conversations: [
      item(D1, "Кофе и такси", TODAY, "Записал: кафе, 15,00 BYN"),
      item(D2, "Ноутбук за 3 000", OLD, "Три сценария покупки"),
    ],
    histories: {
      [D1]: {
        title: "Кофе и такси",
        messages: [
          {
            id: "0190f0a0-0000-7000-8000-0000000000e1",
            role: "user",
            status: "complete",
            parts: [{ type: "text", text: "Потратил 15 рублей на кофе" }],
          },
          {
            id: "0190f0a0-0000-7000-8000-0000000000e2",
            role: "assistant",
            status: "complete",
            parts: [{ type: "text", text: "Записал: кафе, 15,00 BYN" }],
          },
        ],
      },
      [D2]: {
        title: "Ноутбук за 3 000",
        messages: [
          {
            id: "0190f0a0-0000-7000-8000-0000000000e3",
            role: "user",
            status: "complete",
            parts: [{ type: "text", text: "Могу ли я купить ноутбук за 3 000?" }],
          },
        ],
      },
    },
  };

  it("открывается последний диалог, список — по группам «Сегодня» и «Ранее» с началом последнего сообщения", async () => {
    backend(base);
    renderPage();
    expect(await screen.findByText("Потратил 15 рублей на кофе")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Кофе и такси" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Диалоги" });
    expect(within(nav).getByRole("heading", { name: "Сегодня" })).toBeInTheDocument();
    expect(within(nav).getByRole("heading", { name: "Ранее" })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "Диалог «Кофе и такси»" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(within(nav).getByText(/Три сценария покупки/)).toBeInTheDocument();
  });

  it("выбор другого диалога загружает его переписку", async () => {
    backend(base);
    renderPage();
    await screen.findByText("Потратил 15 рублей на кофе");
    await userEvent.click(screen.getByRole("button", { name: "Диалог «Ноутбук за 3 000»" }));
    expect(await screen.findByText("Могу ли я купить ноутбук за 3 000?")).toBeInTheDocument();
    expect(screen.queryByText("Потратил 15 рублей на кофе")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Ноутбук за 3 000" })).toBeInTheDocument();
  });

  it("«Новый диалог» — пустая переписка с приветствием", async () => {
    backend(base);
    renderPage();
    await screen.findByText("Потратил 15 рублей на кофе");
    await userEvent.click(screen.getByRole("button", { name: "Новый диалог" }));
    expect(
      await screen.findByRole("heading", { name: "Здравствуйте! Чем помочь?" }),
    ).toBeInTheDocument();
    const feed = screen.getByRole("log", { name: "Переписка с ассистентом" });
    expect(within(feed).queryByText("Потратил 15 рублей на кофе")).toBeNull();
  });

  it("диалог из адреса (?c=) открывается первым, а не последний", async () => {
    backend(base);
    renderPage({ c: D2 });
    expect(await screen.findByText("Могу ли я купить ноутбук за 3 000?")).toBeInTheDocument();
  });

  it("переименование: название уходит на сервер, поле — по «Переименовать»", async () => {
    backend(base);
    let renamed: unknown;
    server.use(
      http.post("*/api/chat/rename", async ({ request }) => {
        renamed = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    renderPage();
    await screen.findByText("Потратил 15 рублей на кофе");
    await userEvent.click(
      screen.getByRole("button", { name: "Действия с диалогом «Кофе и такси»" }),
    );
    await userEvent.click(await screen.findByRole("menuitem", { name: "Переименовать" }));
    const field = screen.getByRole("textbox", { name: "Название диалога" });
    await userEvent.clear(field);
    await userEvent.type(field, "Вычет за учёбу");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(renamed).toEqual({ conversationId: D1, title: "Вычет за учёбу" }));
  });

  it("удаление — после подтверждения «Да, удалить»; открытый диалог сменяется новым", async () => {
    backend(base);
    let removed: unknown;
    server.use(
      http.post("*/api/chat/remove", async ({ request }) => {
        removed = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    renderPage();
    await screen.findByText("Потратил 15 рублей на кофе");
    await userEvent.click(
      screen.getByRole("button", { name: "Действия с диалогом «Кофе и такси»" }),
    );
    await userEvent.click(await screen.findByRole("menuitem", { name: "Удалить" }));
    expect(removed).toBeUndefined();
    const dialog = await screen.findByRole("dialog", { name: "Удалить диалог?" });
    expect(within(dialog).getByText(/Диалог «Кофе и такси» и вся переписка/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Да, удалить" }));
    await waitFor(() => expect(removed).toEqual({ conversationId: D1 }));
    expect(
      await screen.findByRole("heading", { name: "Здравствуйте! Чем помочь?" }),
    ).toBeInTheDocument();
  });
});

describe("CHAT-02: ответ, который пишет сервер", () => {
  const user = {
    id: "0190f0a0-0000-7000-8000-0000000000e1",
    role: "user",
    status: "complete",
    parts: [{ type: "text", text: "Какие у меня счета?" }],
  };

  it("«идёт» в истории — «Ассистент ещё отвечает…»; по сигналу история обновляется и ответ появляется", async () => {
    let running = true;
    server.use(
      http.get("*/api/chat/conversations", () =>
        HttpResponse.json({ items: [item(D1, "Счета", new Date().toISOString())] }),
      ),
      http.get("*/api/chat/history", () =>
        HttpResponse.json({
          conversationId: D1,
          title: "Счета",
          messages: [
            user,
            {
              id: "0190f0a0-0000-7000-8000-0000000000e2",
              role: "assistant",
              status: running ? "streaming" : "complete",
              parts: running ? [] : [{ type: "text", text: "Готово: один счёт." }],
            },
          ],
        }),
      ),
      http.get("*/api/privacy", () =>
        HttpResponse.json({ cloud: { granted: true, since: null, outdated: false }, history: [] }),
      ),
      http.get("*/api/llm/models", () => HttpResponse.json({ items: [], selected: null })),
    );
    const { queryClient } = renderPage();
    expect(await screen.findAllByText("Ассистент ещё отвечает…")).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: "Отправить" })).toBeDisabled();
    running = false;
    // Сигнал chat-message (events.stream) сводится к перезапросу запросов чата.
    await queryClient.invalidateQueries({ queryKey: orpc.chat.key() });
    expect(await screen.findByText("Готово: один счёт.")).toBeInTheDocument();
    expect(screen.queryByText("Ассистент ещё отвечает…")).toBeNull();
  });

  it("оборванный ответ помечен; карточка счёта из сохранённых частей видна", async () => {
    backend({
      conversations: [item(D1, "Счета", new Date().toISOString())],
      histories: {
        [D1]: {
          title: "Счета",
          messages: [
            user,
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
        },
      },
    });
    renderPage();
    expect(await screen.findByRole("article", { name: "Наличные" })).toBeInTheDocument();
    expect(screen.getByText("Ответ прерван — задайте вопрос ещё раз.")).toBeInTheDocument();
  });
});

describe("LLM-10: кто ответил", () => {
  it("сохранённая пометка: «Модель groq/llama недоступна, ответила zai/glm»", async () => {
    backend({
      conversations: [item(D1, "Счета", new Date().toISOString())],
      histories: {
        [D1]: {
          title: "Счета",
          messages: [
            {
              id: "0190f0a0-0000-7000-8000-0000000000e2",
              role: "assistant",
              status: "complete",
              parts: [{ type: "text", text: "Ответ." }],
              answeredBy: { model: "zai/glm", unavailable: ["groq/llama"] },
            },
          ],
        },
      },
    });
    renderPage();
    expect(
      await screen.findByText("Модель groq/llama недоступна, ответила zai/glm."),
    ).toBeInTheDocument();
  });

  it("живой ответ: пометка из куска finish", async () => {
    backend();
    sendOnce([
      start,
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "Ответ." },
      { type: "text-end", id: "t1" },
      {
        type: "finish",
        messageMetadata: { answeredBy: { model: "llama/qwen", unavailable: ["groq/a", "zai/b"] } },
      },
    ]);
    renderPage();
    await ask("Вопрос");
    expect(
      await screen.findByText("Модели groq/a, zai/b недоступны, ответила llama/qwen."),
    ).toBeInTheDocument();
  });

  it("выбор модели: «Авто» и список; выбор уходит на сервер", async () => {
    backend({
      models: {
        items: [
          { id: "groq/gpt", provider: "groq", model: "gpt-oss-120b", cloud: true },
          { id: "llama/qwen", provider: "llama", model: "qwen3.5-4b", cloud: false },
        ],
        selected: null,
      },
    });
    let chosen: unknown;
    server.use(
      http.post("*/api/llm/preferred-model", async ({ request }) => {
        chosen = await request.json();
        return HttpResponse.json({ items: [], selected: "llama/qwen" });
      }),
    );
    renderPage();
    const picker = await screen.findByRole("combobox", { name: "Модель ответа" });
    expect(
      within(picker).getByRole("option", { name: "Авто (рекомендуется)" }),
    ).toBeInTheDocument();
    expect(
      within(picker).getByRole("option", { name: "gpt-oss-120b · облако" }),
    ).toBeInTheDocument();
    await userEvent.selectOptions(picker, "qwen3.5-4b · этот компьютер");
    await waitFor(() => expect(chosen).toEqual({ modelId: "llama/qwen" }));
  });
});

describe("PRIV-02: локальный режим", () => {
  it("без облачного согласия — плашка «Локальный режим» со ссылкой на настройку", async () => {
    backend({ cloud: false });
    renderPage();
    const note = await screen.findByRole("note");
    expect(note).toHaveTextContent(
      "Локальный режим: ответы медленнее, данные не покидают компьютер.",
    );
    expect(within(note).getByRole("link", { name: "Настроить" })).toHaveAttribute(
      "href",
      "/settings?tab=privacy",
    );
  });

  it("с согласием плашки нет", async () => {
    backend({ cloud: true });
    renderPage();
    await screen.findByRole("heading", { name: "Здравствуйте! Чем помочь?" });
    expect(screen.queryByText(/Локальный режим/)).toBeNull();
  });
});

describe("DES-16: состояния", () => {
  it("список диалогов не загрузился — что случилось и «Попробовать ещё раз»", async () => {
    let fail = true;
    server.use(
      http.get("*/api/chat/conversations", () =>
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
          : HttpResponse.json({ items: [] }),
      ),
      http.get("*/api/privacy", () =>
        HttpResponse.json({ cloud: { granted: true, since: null, outdated: false }, history: [] }),
      ),
      http.get("*/api/llm/models", () => HttpResponse.json({ items: [], selected: null })),
    );
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "Не удалось загрузить переписку" }),
    ).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Попробовать ещё раз" }));
    expect(await screen.findByRole("textbox", { name: "Вопрос ассистенту" })).toBeInTheDocument();
  });

  it("загрузка — скелетон с «Загрузка…»", async () => {
    server.use(
      http.get("*/api/chat/conversations", async () => {
        await delay("infinite");
        return HttpResponse.json({ items: [] });
      }),
    );
    renderPage();
    expect(await screen.findByText("Загрузка…")).toBeInTheDocument();
  });
});

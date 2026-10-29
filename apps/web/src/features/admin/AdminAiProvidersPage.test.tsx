// ADM-50, LLM-08, LLM-09, NFR-16: «Провайдеры ИИ» — цепочки по задачам (порядок, включение, «Проверить связь»), ключи
// только для записи (после сохранения — «задан», значение не показывается), реестр моделей (изменить, разрешить выбор),
// состояния загрузки и ошибки.
import type { AiModel, AiProviders } from "@kosht/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { AdminAiProvidersPage } from "./AdminAiProvidersPage.tsx";

const noLimits = { rpm: null, tpm: null, rpd: null, tpd: null };

const model = (id: string, patch: Partial<AiModel> = {}): AiModel => {
  const [provider = "", ...rest] = id.split("/");
  return {
    id,
    provider,
    model: rest.join("/"),
    cloud: provider !== "llama",
    capabilities: ["text", "tools", "structured"],
    priority: 100,
    enabled: true,
    userSelectable: false,
    contextTokens: 8192,
    inputMicrosPerMillion: 0,
    outputMicrosPerMillion: 0,
    limits: noLimits,
    ...patch,
  };
};

const models = [
  model("groq/openai/gpt-oss-120b", { userSelectable: true }),
  model("zai/glm-4.7-flash"),
  model("llama/qwen3.5-4b"),
];

const view = (patch: Partial<AiProviders> = {}): AiProviders => ({
  providers: [
    { id: "groq", cloud: true, key: "set" },
    { id: "zai", cloud: true, key: "unset" },
    { id: "llama", cloud: false, key: "none" },
  ],
  models,
  chains: [
    { task: "chat", custom: true, models: models.map((m) => m.id) },
    { task: "receipt.extract", custom: false, models: [] },
    { task: "statement.columns", custom: false, models: [] },
    { task: "classify.category", custom: false, models: [] },
    { task: "classify.off-topic", custom: false, models: [] },
    { task: "law.topic", custom: false, models: [] },
    { task: "embed", custom: false, models: [] },
    { task: "transcribe", custom: false, models: [] },
  ],
  ...patch,
});

function renderPage(data: AiProviders = view()) {
  server.use(http.get("*/api/admin/ai/providers", () => HttpResponse.json(data)));
  renderWithProviders(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AdminAiProvidersPage />
    </QueryClientProvider>,
  );
}

const chatCard = () => screen.getByRole("region", { name: "Чат и агент" });

describe("ADM-50: цепочка задачи", () => {
  it("модели по порядку: место, провайдер, модель, облако или этот компьютер", async () => {
    renderPage();
    const card = await screen.findByRole("region", { name: "Чат и агент" });
    const rows = within(card).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("1Groqopenai/gpt-oss-120b · облако");
    expect(rows[1]).toHaveTextContent("2Z.aiglm-4.7-flash · облако");
    expect(rows[2]).toHaveTextContent("3Локальная модельqwen3.5-4b · на этом компьютере");
  });

  it("«Ниже» меняет порядок: на сервер уходит вся цепочка в новом порядке, ответ сервера перерисовывает список", async () => {
    const sent: unknown[] = [];
    renderPage();
    server.use(
      http.post("*/api/admin/ai/chain", async ({ request }) => {
        const body = (await request.json()) as { task: string; models: string[] };
        sent.push(body);
        return HttpResponse.json(
          view({
            chains: [
              { task: "chat", custom: true, models: body.models },
              ...view().chains.slice(1),
            ],
          }),
        );
      }),
    );
    await screen.findByRole("region", { name: "Чат и агент" });
    await userEvent.click(
      within(chatCard()).getByRole("button", { name: "Ниже: Groq · openai/gpt-oss-120b" }),
    );
    expect(sent).toEqual([
      {
        task: "chat",
        models: ["zai/glm-4.7-flash", "groq/openai/gpt-oss-120b", "llama/qwen3.5-4b"],
      },
    ]);
    const rows = await within(chatCard()).findAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("1Z.ai");
  });

  it("у первой модели «Выше» недоступно, у последней — «Ниже»", async () => {
    renderPage();
    await screen.findByRole("region", { name: "Чат и агент" });
    expect(
      within(chatCard()).getByRole("button", { name: "Выше: Groq · openai/gpt-oss-120b" }),
    ).toBeDisabled();
    expect(
      within(chatCard()).getByRole("button", { name: "Ниже: Локальная модель · qwen3.5-4b" }),
    ).toBeDisabled();
  });

  it("отказ сервера — текст ошибки из каталога", async () => {
    renderPage();
    server.use(
      http.post("*/api/admin/ai/chain", () =>
        HttpResponse.json(
          {
            defined: true,
            code: "VALIDATION",
            status: 400,
            message: "VALIDATION",
            data: { requestId: "r", params: {} },
          },
          { status: 400 },
        ),
      ),
    );
    await screen.findByRole("region", { name: "Чат и агент" });
    await userEvent.click(
      within(chatCard()).getByRole("button", { name: "Ниже: Groq · openai/gpt-oss-120b" }),
    );
    expect(await within(chatCard()).findByRole("alert")).toBeInTheDocument();
  });

  it("выключатель включает и выключает модель реестра", async () => {
    const sent: unknown[] = [];
    renderPage();
    server.use(
      http.post("*/api/admin/ai/model-enabled", async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json(view());
      }),
    );
    await screen.findByRole("region", { name: "Чат и агент" });
    await userEvent.click(
      within(chatCard()).getByRole("switch", { name: "Groq · openai/gpt-oss-120b включена" }),
    );
    expect(sent).toEqual([{ id: "groq/openai/gpt-oss-120b", enabled: false }]);
  });
});

describe("LLM-08: «Проверить связь»", () => {
  it("связь есть — время ответа; ошибка — причина словами", async () => {
    renderPage();
    server.use(
      http.post("*/api/admin/ai/test", async ({ request }) => {
        const { id } = (await request.json()) as { id: string };
        return HttpResponse.json(
          id.startsWith("groq") ? { ok: true, ms: 142 } : { ok: false, reason: "no-key" },
        );
      }),
    );
    await screen.findByRole("region", { name: "Чат и агент" });
    expect(within(chatCard()).getAllByText("Связь не проверялась")).toHaveLength(3);
    await userEvent.click(
      within(chatCard()).getByRole("button", {
        name: "Проверить связь: Groq · openai/gpt-oss-120b",
      }),
    );
    expect(await within(chatCard()).findByText("Связь есть · 142 мс")).toBeInTheDocument();
    await userEvent.click(
      within(chatCard()).getByRole("button", { name: "Проверить связь: Z.ai · glm-4.7-flash" }),
    );
    expect(await within(chatCard()).findByText("Ключ API не задан")).toBeInTheDocument();
  });
});

describe("NFR-16: ключи API — только запись", () => {
  const SECRET = "gsk_ключ-который-нельзя-показывать";

  it("статус «Задан» и «Не задан»; без ввода «Сохранить» недоступно", async () => {
    renderPage();
    const keys = await screen.findByRole("region", { name: "Ключи API" });
    expect(within(keys).getByText("Задан")).toBeInTheDocument();
    expect(within(keys).getByText("Не задан")).toBeInTheDocument();
    expect(within(keys).getByRole("button", { name: "Сохранить ключ Z.ai" })).toBeDisabled();
  });

  it("сохранение отправляет ключ, поле очищается, значение нигде не показывается", async () => {
    const sent: unknown[] = [];
    renderPage();
    server.use(
      http.post("*/api/admin/ai/key", async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json(
          view({
            providers: [
              { id: "groq", cloud: true, key: "set" },
              { id: "zai", cloud: true, key: "set" },
              { id: "llama", cloud: false, key: "none" },
            ],
          }),
        );
      }),
    );
    const keys = await screen.findByRole("region", { name: "Ключи API" });
    await userEvent.type(within(keys).getByLabelText("Новый ключ Z.ai"), SECRET);
    await userEvent.click(within(keys).getByRole("button", { name: "Сохранить ключ Z.ai" }));
    expect(sent).toEqual([{ provider: "zai", key: SECRET }]);
    expect(await within(keys).findByText("Ключ Z.ai сохранён.")).toBeInTheDocument();
    expect(within(keys).getAllByText("Задан")).toHaveLength(2);
    expect(within(keys).getByLabelText("Новый ключ Z.ai")).toHaveValue("");
    expect(document.body).not.toHaveTextContent(SECRET);
  });

  it("«Убрать ключ» шлёт key: null", async () => {
    const sent: unknown[] = [];
    renderPage();
    server.use(
      http.post("*/api/admin/ai/key", async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json(view());
      }),
    );
    const keys = await screen.findByRole("region", { name: "Ключи API" });
    await userEvent.click(within(keys).getByRole("button", { name: "Убрать ключ Groq" }));
    expect(sent).toEqual([{ provider: "groq", key: null }]);
  });
});

describe("LLM-09, LLM-10: реестр моделей", () => {
  it("разрешение выбора в чате шлёт запись целиком с новым флагом", async () => {
    const sent: unknown[] = [];
    renderPage();
    server.use(
      http.post("*/api/admin/ai/model", async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json(view());
      }),
    );
    const registry = await screen.findByRole("region", { name: "Реестр моделей" });
    await userEvent.click(
      within(registry).getByRole("switch", {
        name: "Пользователи могут выбрать Z.ai · glm-4.7-flash",
      }),
    );
    expect(sent).toEqual([
      {
        provider: "zai",
        model: "glm-4.7-flash",
        capabilities: ["text", "tools", "structured"],
        priority: 100,
        userSelectable: true,
        contextTokens: 8192,
        inputMicrosPerMillion: 0,
        outputMicrosPerMillion: 0,
        limits: noLimits,
      },
    ]);
  });

  it("новая модель: провайдер из списка, идентификатор, цена в долларах → микродоллары", async () => {
    const sent: unknown[] = [];
    renderPage();
    server.use(
      http.post("*/api/admin/ai/model", async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json(view());
      }),
    );
    const registry = await screen.findByRole("region", { name: "Реестр моделей" });
    const save = within(registry).getByRole("button", { name: "Сохранить модель" });
    expect(save).toBeDisabled();
    await userEvent.click(
      within(registry)
        .getAllByLabelText("Провайдер")
        .find((element) => element.tagName === "INPUT") as HTMLElement,
    );
    await userEvent.click(await screen.findByRole("option", { name: "Z.ai" }));
    await userEvent.type(within(registry).getByLabelText("Идентификатор модели"), "glm-next");
    const input = within(registry).getByLabelText("Цена входа, $ за 1 млн токенов");
    await userEvent.clear(input);
    await userEvent.type(input, "0,59");
    await userEvent.click(save);
    expect(sent).toMatchObject([
      {
        provider: "zai",
        model: "glm-next",
        inputMicrosPerMillion: 590_000,
        outputMicrosPerMillion: 0,
      },
    ]);
    expect(await within(registry).findByText("Модель glm-next сохранена.")).toBeInTheDocument();
  });

  it("«Изменить» подставляет запись в форму; провайдер и идентификатор не правятся", async () => {
    renderPage();
    const registry = await screen.findByRole("region", { name: "Реестр моделей" });
    await userEvent.click(
      within(registry).getByRole("button", { name: "Изменить Z.ai · glm-4.7-flash" }),
    );
    expect(within(registry).getByLabelText("Идентификатор модели")).toHaveValue("glm-4.7-flash");
    expect(within(registry).getByLabelText("Идентификатор модели")).toBeDisabled();
    expect(within(registry).getByRole("heading", { name: "Изменить модель" })).toBeInTheDocument();
  });
});

describe("DES-16: загрузка и ошибка", () => {
  it("ошибка загрузки — что случилось и что сделать", async () => {
    server.use(http.get("*/api/admin/ai/providers", () => HttpResponse.error()));
    renderWithProviders(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AdminAiProvidersPage />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Не удалось загрузить провайдеров ИИ",
    );
  });
});

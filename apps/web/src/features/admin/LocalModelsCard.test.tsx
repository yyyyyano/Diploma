// ADM-50, NFR-25: «Локальные модели» — состояние моделей, прогресс скачивания с опросом раз в 2 с, «Скачать»,
// «Проверить модели», запасной режим на процессоре, ошибки по машинным кодам.
import type { LocalModelsOverview } from "@kosht/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { LocalModelsCard } from "./LocalModelsCard.tsx";

const file = (
  path: string,
  size: number,
  state: "ready" | "absent" | "downloading" | "failed",
  done = 0,
) => ({
  path,
  size,
  state,
  bytesDone: state === "ready" ? size : done,
  errorCode: state === "failed" ? "NO_SPACE" : null,
});

const overview = (patch: Partial<LocalModelsOverview> = {}): LocalModelsOverview => ({
  state: "downloading",
  bytesDone: 1_500_000_000,
  bytesTotal: 4_400_000_000,
  models: [
    {
      id: "qwen3.5-4b",
      kind: "chat",
      state: "downloading",
      bytesDone: 1_500_000_000,
      bytesTotal: 3_413_000_000,
      errorCode: null,
      files: [
        file("llm/qwen3.5-4b/Qwen3.5-4B-Q4_K_M.gguf", 3_413_000_000, "downloading", 1_500_000_000),
      ],
    },
    {
      id: "bge-m3",
      kind: "embedding",
      state: "ready",
      bytesDone: 634_553_760,
      bytesTotal: 634_553_760,
      errorCode: null,
      files: [file("embed/bge-m3-q8_0.gguf", 634_553_760, "ready")],
    },
    {
      id: "ner-ru",
      kind: "ner",
      state: "absent",
      bytesDone: 0,
      bytesTotal: 178_470_706,
      errorCode: null,
      files: [file("ner/onnx/model_int8.onnx", 178_470_706, "absent")],
    },
  ],
  selfTest: { state: "unknown", problem: null, cpuFallback: false },
  ...patch,
});

function renderCard() {
  renderWithProviders(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <LocalModelsCard />
    </QueryClientProvider>,
  );
}

const card = () => screen.findByRole("region", { name: "Локальные модели" });

describe("NFR-25: состояние локальных моделей", () => {
  it("модели словами, размер «скачано из всего», состояния; у скачивающейся — полоса с подписью", async () => {
    server.use(http.get("*/api/admin/ai/local-models", () => HttpResponse.json(overview())));
    renderCard();
    const region = await card();
    expect(within(region).getByText("Чат и распознавание чеков")).toBeInTheDocument();
    expect(within(region).getByText("Скачивается")).toBeInTheDocument();
    expect(within(region).getByText("Установлена")).toBeInTheDocument();
    expect(within(region).getByText("Не скачана")).toBeInTheDocument();
    const bar = within(region).getByRole("progressbar", { name: "Чат и распознавание чеков" });
    expect(bar).toHaveAttribute("value", "1500000000");
    expect(within(region).getAllByRole("progressbar")).toHaveLength(1);
  });

  it("идёт скачивание — «Скачать» недоступно; опрос раз в 2 с подхватывает готовность без перезагрузки страницы", async () => {
    let calls = 0;
    server.use(
      http.get("*/api/admin/ai/local-models", () => {
        calls += 1;
        return HttpResponse.json(
          calls === 1
            ? overview()
            : overview({
                state: "ready",
                bytesDone: 4_400_000_000,
                models: overview().models.map((model) => ({
                  ...model,
                  state: "ready" as const,
                  bytesDone: model.bytesTotal,
                })),
              }),
        );
      }),
    );
    renderCard();
    const region = await card();
    expect(
      within(region).getByRole("button", { name: /Продолжить скачивание|Скачать/ }),
    ).toBeDisabled();
    await waitFor(() => expect(within(region).queryByText("Скачивается")).toBeNull(), {
      timeout: 4500,
    });
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(
      within(region).queryByRole("button", { name: /Скачать|Продолжить скачивание/ }),
    ).toBeNull();
  });
});

describe("ADM-50: «Скачать» и «Проверить модели»", () => {
  it("«Скачать» шлёт запрос и показывает ответ сервера; нет модели — первое нажатие, ничего не скачано", async () => {
    const sent: string[] = [];
    server.use(
      http.get("*/api/admin/ai/local-models", () =>
        HttpResponse.json(
          overview({
            state: "absent",
            bytesDone: 0,
            models: overview().models.map((m) => ({
              ...m,
              state: "absent" as const,
              bytesDone: 0,
            })),
          }),
        ),
      ),
      http.post("*/api/admin/ai/local-models/download", () => {
        sent.push("download");
        return HttpResponse.json(overview());
      }),
    );
    renderCard();
    const region = await card();
    await userEvent.click(within(region).getByRole("button", { name: "Скачать" }));
    expect(await within(region).findByText(/Скачивание запущено/)).toBeInTheDocument();
    expect(sent).toEqual(["download"]);
  });

  it("ошибка скачивания — «Повторить» и текст по коду («Не хватает места»)", async () => {
    server.use(
      http.get("*/api/admin/ai/local-models", () =>
        HttpResponse.json(
          overview({
            state: "failed",
            models: [
              {
                ...overview().models[0]!,
                state: "failed",
                errorCode: "NO_SPACE",
              },
            ],
          }),
        ),
      ),
    );
    renderCard();
    const region = await card();
    expect(within(region).getByText("Не хватает места на диске.")).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Повторить" })).toBeEnabled();
  });

  it("«Проверить модели» — самотест; сервис не запущен, мусор → запасной режим на процессоре, сбой с кодом проблемы", async () => {
    const answers: LocalModelsOverview["selfTest"][] = [
      { state: "down", problem: "LLAMA_DOWN", cpuFallback: false },
      { state: "ok", problem: null, cpuFallback: true },
      { state: "failed", problem: "CHAT_GARBAGE", cpuFallback: false },
    ];
    let index = 0;
    server.use(
      http.get("*/api/admin/ai/local-models", () =>
        HttpResponse.json(
          overview({
            state: "ready",
            selfTest: { state: "unknown", problem: null, cpuFallback: false },
          }),
        ),
      ),
      http.post("*/api/admin/ai/local-models/self-test", () => {
        const selfTest = answers[index++] ?? answers[0]!;
        return HttpResponse.json(overview({ state: "ready", selfTest }));
      }),
    );
    renderCard();
    const region = await card();
    expect(within(region).getByText("Проверка не запускалась")).toBeInTheDocument();
    const button = within(region).getByRole("button", { name: "Проверить модели" });
    await userEvent.click(button);
    expect(await within(region).findByText(/Сервис моделей не запущен/)).toBeInTheDocument();
    await userEvent.click(button);
    expect(await within(region).findByText(/Проверка пройдена/)).toBeInTheDocument();
    expect(within(region).getByText(/запасной режим/)).toBeInTheDocument();
    await userEvent.click(button);
    expect(
      await within(region).findByText("Проверка не пройдена: CHAT_GARBAGE"),
    ).toBeInTheDocument();
    expect(within(region).queryByText(/запасной режим/)).toBeNull();
  });

  it("ошибка загрузки состояния — понятный текст", async () => {
    server.use(http.get("*/api/admin/ai/local-models", () => HttpResponse.error()));
    renderCard();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Не удалось загрузить состояние локальных моделей",
    );
  });
});

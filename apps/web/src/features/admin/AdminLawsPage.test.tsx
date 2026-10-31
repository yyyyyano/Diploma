// ADM-10, LAW-40: вкладка «Законы» — сводка, прогресс «N из 28», расписание и контакт, список актов по состояниям, очередь
// кандидатов, журналы и общий редактор справочников. Ответы сервера — MSW; сайт ничего не считает, только показывает.
import type { LawAdminActs, LawCandidates, LawDictionary, LawsOverview } from "@kosht/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { AdminLawsPage } from "./AdminLawsPage.tsx";

const overview = (extra: Partial<LawsOverview> = {}): LawsOverview => ({
  summary: {
    inIndex: 184,
    cardOnly: 212,
    repealed: 37,
    candidates: 2,
    withChanges: 11,
    quarantined: 1,
    failed: 1,
  },
  startup: { state: "loading", done: 14, total: 28, problems: 0, stopReason: null },
  vectors: { state: "working", total: 27_418, embedded: 23_854, model: "bge-m3" },
  schedule: {
    autoUpdate: true,
    checkTime: "04:00",
    windowFrom: "02:00",
    windowTo: "06:00",
    lastCheck: {
      at: { day: "2026-10-21", time: "04:00" },
      ok: true,
      updated: 1,
      problems: 0,
      stopReason: null,
    },
    nextCheck: { day: "2026-10-22", time: "04:00" },
  },
  newActsMode: "auto",
  loaderContact: "admin@kosht.local",
  userAgent: "KoshtBot/1.0 (+admin@kosht.local)",
  ...extra,
});

const acts = (extra: Partial<LawAdminActs> = {}): LawAdminActs => ({
  items: [
    {
      pravoId: "Hk0900071",
      title: "Налоговый кодекс (Особенная часть)",
      topic: "taxes",
      status: "has-changes",
      problem: null,
      pendingChanges: 1,
      repealedOn: null,
      editionOn: "2026-10-21",
      checkedOn: "2026-10-21",
    },
    {
      pravoId: "C20200778",
      title: "ПСМ № 778 (невозвратные товары)",
      topic: "consumer",
      status: "card-only",
      problem: null,
      pendingChanges: 0,
      repealedOn: null,
      editionOn: null,
      checkedOn: "2026-10-21",
    },
    {
      pravoId: "HK9900296",
      title: "Трудовой кодекс",
      topic: "work",
      status: "quarantined",
      problem: "load-failed",
      pendingChanges: 0,
      repealedOn: null,
      editionOn: "2026-10-20",
      checkedOn: "2026-10-21",
    },
  ],
  total: 3,
  counts: {
    all: 3,
    active: 0,
    "has-changes": 1,
    "card-only": 1,
    repealed: 0,
    quarantined: 1,
    failed: 0,
    pending: 0,
  },
  page: 1,
  pageSize: 50,
  ...extra,
});

const dictionary = (rows: LawDictionary["rows"] = []): LawDictionary => ({
  kind: "title-patterns",
  fields: [{ name: "pattern", type: "text", required: true }],
  rows,
});

function render(data: LawsOverview = overview()) {
  server.use(http.get("*/api/admin/laws", () => HttpResponse.json(data)));
  renderWithProviders(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AdminLawsPage />
    </QueryClientProvider>,
  );
}

describe("LAW-40: сводка, расписание, загрузчик", () => {
  it("плитки сводки, прогресс «Загружено 14 из 28», векторный индекс, расписание и контакт загрузчика", async () => {
    render();
    expect(await screen.findByText("184")).toBeVisible();
    expect(screen.getByText("212")).toBeVisible();
    expect(screen.getByText("37")).toBeVisible();
    expect(screen.getByText("Загружено 14 из 28 актов стартового каталога")).toBeVisible();
    expect(screen.getByText("Векторный индекс · модель bge-m3")).toBeVisible();
    expect(screen.getByText("87%")).toBeVisible();
    expect(screen.getByText("21.10.2026, 04:00")).toBeVisible();
    expect(screen.getByText("22.10.2026, 04:00")).toBeVisible();
    expect(screen.getByRole("textbox", { name: /Контакт оператора для загрузчика/ })).toHaveValue(
      "admin@kosht.local",
    );
    expect(screen.getByText("KoshtBot/1.0 (+admin@kosht.local)")).toBeVisible();
    expect(screen.getByRole("switch", { name: "Проверять законы автоматически" })).toBeChecked();
  });

  it("загрузчик остановлен — причина словами и подсказка; векторы без модели — «Ждём модель»", async () => {
    render(
      overview({
        startup: {
          state: "stopped",
          done: 3,
          total: 28,
          problems: 0,
          stopReason: "LOADER_CONTACT_EMPTY",
        },
        vectors: { state: "waiting-model", total: 100, embedded: 0, model: null },
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Загрузчик остановлен: не указан контакт оператора",
    );
    expect(screen.getByText(/Ждём модель эмбеддингов/)).toBeVisible();
  });

  it("ошибка сервера при загрузке — понятный текст, а не пустой экран", async () => {
    server.use(http.get("*/api/admin/laws", () => HttpResponse.json({}, { status: 500 })));
    renderWithProviders(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AdminLawsPage />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось узнать состояние");
  });

  it("«Сохранить время» отправляет время и окно; ответ с ошибкой окна показывает причину", async () => {
    const sent: unknown[] = [];
    server.use(
      http.post("*/api/admin/laws/settings", async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json(
          {
            code: "VALIDATION",
            status: 400,
            message: "VALIDATION",
            defined: true,
            data: { requestId: "r", params: { field: "checkTime", reason: "outside-window" } },
          },
          { status: 400 },
        );
      }),
    );
    render();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Сохранить время" }));
    expect(sent).toEqual([{ checkTime: "04:00", windowFrom: "02:00", windowTo: "06:00" }]);
    expect(await screen.findByText(/должно лежать внутри ночного окна/)).toBeVisible();
  });

  it("«Проверить сейчас» ставит проверку и подтверждает это", async () => {
    let called = 0;
    server.use(
      http.post("*/api/admin/laws/check-now", () => {
        called += 1;
        return HttpResponse.json({ ok: true });
      }),
    );
    render();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Проверить сейчас" }));
    expect(await screen.findByText(/Проверка поставлена в очередь/)).toBeVisible();
    expect(called).toBe(1);
  });

  it("«Добавить акты вручную»: строки уходят списком, в ответе — сколько принято и сколько не распознано", async () => {
    const sent: unknown[] = [];
    server.use(
      http.post("*/api/admin/laws/add", async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({ accepted: 1, rejected: ["ерунда"] });
      }),
    );
    render();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Добавить акты вручную" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByRole("textbox", { name: "Ссылки или ID актов" }),
      "H10200090{Enter}ерунда",
    );
    await user.click(within(dialog).getByRole("button", { name: "Добавить" }));
    expect(sent).toEqual([{ links: ["H10200090", "ерунда"] }]);
    expect(await within(dialog).findByText(/Принято актов: 1/)).toBeVisible();
    expect(within(dialog).getByText(/Не распознано строк: 1/)).toBeVisible();
  });
});

describe("LAW-40: разделы вкладки", () => {
  it("список актов: состояния с иконкой и словами, счётчики фильтров, фильтр по состоянию уходит на сервер, кнопки по состоянию", async () => {
    const queries: (string | null)[] = [];
    server.use(
      http.get("*/api/admin/laws/acts", ({ request }) => {
        queries.push(new URL(request.url).searchParams.get("status"));
        return HttpResponse.json(acts());
      }),
    );
    render();
    const user = userEvent.setup();
    expect(await screen.findByText("Налоговый кодекс (Особенная часть)")).toBeVisible();
    expect(screen.getByText("Есть принятые изменения", { selector: "span" })).toBeVisible();
    expect(screen.getByText(/Принято изменений, не вошедших в текст: 1/)).toBeVisible();
    expect(screen.getByText(/ошибка загрузки/)).toBeVisible();
    // «Проверить текст» — только у карточки; «Исключить» — у каждого акта.
    expect(screen.getAllByRole("button", { name: /^Проверить, появился ли текст/ })).toHaveLength(
      1,
    );
    expect(screen.getAllByRole("button", { name: /^Исключить акт/ })).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: /Только карточка 1/ }));
    expect(queries).toContain("card-only");
  });

  it("«Исключить» просит подтверждение с названием акта и только потом отправляет", async () => {
    server.use(http.get("*/api/admin/laws/acts", () => HttpResponse.json(acts())));
    const excluded: unknown[] = [];
    server.use(
      http.post("*/api/admin/laws/exclude", async ({ request }) => {
        excluded.push(await request.json());
        return HttpResponse.json({ ok: true });
      }),
    );
    render();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", {
        name: "Исключить акт: Трудовой кодекс",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/«Трудовой кодекс» исчезнет из «Базы законов»/)).toBeVisible();
    expect(excluded).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "Да, исключить" }));
    expect(excluded).toEqual([{ pravoId: "HK9900296" }]);
  });

  it("очередь кандидатов: причина и источник, «Добавить» и «Отклонить» уходят с id кандидата", async () => {
    const queue: LawCandidates = {
      items: [
        {
          id: "01990000-0000-7000-8000-000000000001",
          pravoId: "H12600001",
          title: "Постановление Правления Нацбанка № 185",
          kindLine: null,
          source: "agency",
          reason: "manual-decision",
          hasText: true,
          topic: null,
          foundOn: null,
        },
      ],
    };
    server.use(http.get("*/api/admin/laws/candidates", () => HttpResponse.json(queue)));
    server.use(http.get("*/api/admin/laws/acts", () => HttpResponse.json(acts())));
    const decided: unknown[] = [];
    server.use(
      http.post("*/api/admin/laws/candidates/decide", async ({ request }) => {
        decided.push(await request.json());
        return HttpResponse.json({ items: [] });
      }),
    );
    render();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Очередь кандидатов/ }));
    expect(await screen.findByText("Постановление Правления Нацбанка № 185")).toBeVisible();
    expect(screen.getByText(/ведомственная страница/)).toBeVisible();
    expect(screen.getByText(/решает администратор/)).toBeVisible();
    await user.click(
      screen.getByRole("button", {
        name: "Добавить акт в базу: Постановление Правления Нацбанка № 185",
      }),
    );
    expect(decided).toEqual([{ id: "01990000-0000-7000-8000-000000000001", decision: "add" }]);
  });

  it("журнал обновлений: событие словами, название акта; журнал запросов — адрес, код, размер, время", async () => {
    server.use(http.get("*/api/admin/laws/acts", () => HttpResponse.json(acts())));
    server.use(
      http.get("*/api/admin/laws/updates", () =>
        HttpResponse.json({
          items: [
            {
              at: { day: "2026-10-21", time: "04:06" },
              event: "edition-applied",
              pravoId: "Hk0900071",
              title: "Налоговый кодекс (Особенная часть)",
              details: {},
            },
          ],
        }),
      ),
      http.get("*/api/admin/laws/fetches", () =>
        HttpResponse.json({
          items: [
            {
              at: { day: "2026-10-21", time: "04:06" },
              url: "https://pravo.by/document/?guid=3871&p0=Hk0900071",
              httpStatus: 200,
              bytes: 1234,
              ms: 87,
              outcome: "ok",
            },
          ],
        }),
      ),
    );
    render();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Журнал обновлений" }));
    expect(await screen.findByText("новая редакция")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Запросы загрузчика" }));
    expect(
      await screen.findByText("https://pravo.by/document/?guid=3871&p0=Hk0900071"),
    ).toBeVisible();
    expect(screen.getByText("87 мс")).toBeVisible();
  });
});

describe("LAW-40: общий редактор справочников", () => {
  async function openDictionary() {
    server.use(http.get("*/api/admin/laws/acts", () => HttpResponse.json(acts())));
    render();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Справочники" }));
    return user;
  }

  it("вид справочника выбирается списком; поля и строки берутся из ответа сервера", async () => {
    const kinds: (string | null)[] = [];
    server.use(
      http.get("*/api/admin/laws/dictionary", ({ request }) => {
        const kind = new URL(request.url).searchParams.get("kind");
        kinds.push(kind);
        return HttpResponse.json(
          dictionary([{ id: "^О назначении", values: { pattern: "^О назначении" } }]),
        );
      }),
    );
    await openDictionary();
    expect(await screen.findByText("^О назначении")).toBeVisible();
    expect(kinds).toEqual(["start-catalog"]);
    expect(screen.getByRole("columnheader", { name: "Шаблон" })).toBeVisible();
  });

  it("новая строка уходит с id null; ошибка проверки сервера — у формы, с названием поля словами", async () => {
    const sent: unknown[] = [];
    server.use(
      http.get("*/api/admin/laws/dictionary", () => HttpResponse.json(dictionary())),
      http.post("*/api/admin/laws/dictionary/upsert", async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json(
          {
            code: "VALIDATION",
            status: 400,
            message: "VALIDATION",
            defined: true,
            data: { requestId: "r", params: { field: "pattern", reason: "format" } },
          },
          { status: 400 },
        );
      }),
    );
    const user = await openDictionary();
    await user.click(await screen.findByRole("button", { name: "Добавить строку" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: /Шаблон/ }), "^О (");
    await user.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    expect(sent).toEqual([{ kind: "start-catalog", id: null, values: { pattern: "^О (" } }]);
    expect(await within(dialog).findByText("Поле «Шаблон» заполнено неверно.")).toBeVisible();
  });

  it("правка строки уходит с её ключом, удаление — после подтверждения", async () => {
    const edited: unknown[] = [];
    const removed: unknown[] = [];
    const row = { id: "^О назначении", values: { pattern: "^О назначении" } };
    server.use(
      http.get("*/api/admin/laws/dictionary", () => HttpResponse.json(dictionary([row]))),
      http.post("*/api/admin/laws/dictionary/upsert", async ({ request }) => {
        edited.push(await request.json());
        return HttpResponse.json(dictionary([row]));
      }),
      http.post("*/api/admin/laws/dictionary/remove", async ({ request }) => {
        removed.push(await request.json());
        return HttpResponse.json(dictionary());
      }),
    );
    const user = await openDictionary();
    await user.click(await screen.findByRole("button", { name: "Изменить строку ^О назначении" }));
    const form = await screen.findByRole("dialog");
    const field = within(form).getByRole("textbox", { name: /Шаблон/ });
    await user.clear(field);
    await user.type(field, "^О назначении на должность");
    await user.click(within(form).getByRole("button", { name: "Сохранить" }));
    expect(edited).toEqual([
      {
        kind: "start-catalog",
        id: "^О назначении",
        values: { pattern: "^О назначении на должность" },
      },
    ]);

    await user.click(await screen.findByRole("button", { name: "Удалить строку ^О назначении" }));
    const confirm = await screen.findByRole("dialog");
    expect(removed).toEqual([]);
    await user.click(within(confirm).getByRole("button", { name: "Да, удалить" }));
    expect(removed).toEqual([{ kind: "start-catalog", id: "^О назначении" }]);
  });
});

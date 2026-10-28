// ADM-60, OBS-07, NFR-23, NFR-24, OBS-05: «Система» — фоновые задачи (выполняются, расписания, ошибки; пусто —
// пояснения), почта (пароль только для записи: пустое поле не отправляется), тестовое письмо, часовой пояс,
// доступ из сети вместе с адресом, Langfuse со ссылкой; ошибка загрузки — понятный текст.
import type { SystemOverview } from "@kosht/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { AdminSystemPage } from "./AdminSystemPage.tsx";

const overview = (extra: Partial<SystemOverview> = {}): SystemOverview => ({
  jobs: { running: [], failures: [], schedules: [] },
  mail: {
    configured: false,
    host: "",
    port: 587,
    secure: false,
    user: "",
    from: "no-reply@kosht.local",
    passwordSet: true,
  },
  timeZone: "Europe/Minsk",
  lan: { allowed: false, address: "" },
  langfuse: { enabled: true, url: "http://127.0.0.1:3001" },
  ...extra,
});

function renderSystem(data: SystemOverview = overview()) {
  server.use(http.get("*/api/admin/system", () => HttpResponse.json(data)));
  renderWithProviders(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AdminSystemPage />
    </QueryClientProvider>,
  );
}

describe("OBS-07: фоновые задачи", () => {
  it("выполняется, расписание с последним запуском и ошибка с кодом", async () => {
    renderSystem(
      overview({
        jobs: {
          running: [
            {
              kind: "privacy.build-export",
              status: "running",
              progress: 40,
              errorCode: null,
              startedAt: "2026-10-21T09:00:00.000Z",
              finishedAt: null,
            },
          ],
          schedules: [{ name: "legal-base.daily-check", cron: "0 4 * * *", lastRun: null }],
          failures: [
            {
              kind: "receipts.recognize",
              status: "failed",
              progress: null,
              errorCode: "UNAVAILABLE",
              startedAt: "2026-10-21T08:00:00.000Z",
              finishedAt: "2026-10-21T08:01:00.000Z",
            },
          ],
        },
      }),
    );
    expect(await screen.findByText("privacy.build-export")).toBeInTheDocument();
    expect(screen.getByText("Выполняется · 40 %")).toBeInTheDocument();
    expect(screen.getByText("legal-base.daily-check")).toBeInTheDocument();
    expect(screen.getByText("ещё не запускалась")).toBeInTheDocument();
    expect(screen.getByText("UNAVAILABLE")).toBeInTheDocument();
  });

  it("пусто — пояснения вместо таблиц", async () => {
    renderSystem();
    expect(await screen.findByText("Сейчас ничего не выполняется.")).toBeInTheDocument();
    expect(screen.getByText(/Расписаний пока нет/)).toBeInTheDocument();
    expect(screen.getByText("Ошибок нет.")).toBeInTheDocument();
  });

  it("ошибка загрузки — понятный текст", async () => {
    server.use(
      http.get("*/api/admin/system", () =>
        HttpResponse.json(
          {
            defined: true,
            code: "INTERNAL",
            status: 500,
            message: "INTERNAL",
            data: { requestId: "req-00000001", params: {} },
          },
          { status: 500 },
        ),
      ),
    );
    renderWithProviders(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AdminSystemPage />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось загрузить состояние");
  });
});

describe("ADM-60, NFR-16: почта", () => {
  it("пароль задан и поле пусто — пароль не отправляется; введён — отправляется; тестовое письмо", async () => {
    const saved: unknown[] = [];
    let tested = 0;
    server.use(
      http.post("*/api/admin/system/mail", async ({ request }) => {
        saved.push(await request.json());
        return HttpResponse.json(overview());
      }),
      http.post("*/api/admin/system/mail/test", () => {
        tested += 1;
        return HttpResponse.json({ ok: true });
      }),
    );
    renderSystem();
    expect(await screen.findByText("Не настроена")).toBeInTheDocument();
    expect(screen.getByLabelText("Пароль")).toHaveAttribute(
      "placeholder",
      "Задан — введите новый, чтобы заменить",
    );
    await userEvent.click(screen.getByLabelText(/Сервер/));
    await userEvent.paste("smtp.example.test");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByText("Настройки почты сохранены.")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Пароль"));
    await userEvent.paste("пароль-приложения");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await expect.poll(() => saved.length).toBe(2);
    expect(saved).toEqual([
      {
        host: "smtp.example.test",
        port: 587,
        secure: false,
        user: "",
        from: "no-reply@kosht.local",
      },
      {
        host: "smtp.example.test",
        port: 587,
        secure: false,
        user: "",
        from: "no-reply@kosht.local",
        password: "пароль-приложения",
      },
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Отправить тестовое письмо" }));
    expect(await screen.findByText("Тестовое письмо отправлено на ваш адрес.")).toBeInTheDocument();
    expect(tested).toBe(1);
  });
});

describe("NFR-23, NFR-24, OBS-05: время, сеть, Langfuse", () => {
  it("доступ из сети включается вместе с адресом; пояс — с пояснением про расписания; Langfuse — ссылка", async () => {
    const lan: unknown[] = [];
    server.use(
      http.post("*/api/admin/system/lan", async ({ request }) => {
        lan.push(await request.json());
        return HttpResponse.json(
          overview({ lan: { allowed: true, address: "http://192.168.1.5:8141" } }),
        );
      }),
    );
    renderSystem();
    expect(await screen.findByText(/после перезапуска Кошта/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/Адрес компьютера в сети/));
    await userEvent.paste("http://192.168.1.5:8141");
    await userEvent.click(
      screen.getByRole("switch", { name: /Доступ с других устройств в локальной сети/ }),
    );
    await expect.poll(() => lan).toEqual([{ allowed: true, address: "http://192.168.1.5:8141" }]);
    expect(await screen.findByText(/Включён: сайт открывается/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Открыть Langfuse" })).toHaveAttribute(
      "href",
      "http://127.0.0.1:3001",
    );
  });
});

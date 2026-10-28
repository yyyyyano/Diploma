// AUTH-07, PROF-02: анкета на 1 минуту — шесть вопросов, каждый пропускается; на сервер уходят только отвеченные;
// итог «Вот что я запомнил» из сохранённых фактов; «Пропустить анкету» — пустые ответы и переход на «/».
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { answersOf, OnboardingPage } from "./OnboardingPage.tsx";

function renderPage() {
  const root = createRootRoute();
  const routes = [
    createRoute({ getParentRoute: () => root, path: "/onboarding", component: OnboardingPage }),
    createRoute({ getParentRoute: () => root, path: "/", component: () => <p>Главная</p> }),
    createRoute({ getParentRoute: () => root, path: "/memory", component: () => <p>Память</p> }),
  ];
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ["/onboarding"] }),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

function captureAnswers() {
  const bodies: unknown[] = [];
  server.use(
    http.post("*/api/profile/onboarding", async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json({
        facts: [
          {
            id: "0199f0a0-0000-7000-8000-0000000000f1",
            topic: "employment",
            value: { key: "employment", types: ["employee", "npd"] },
            source: "questionnaire",
            sourceRef: null,
            status: "confirmed",
            recordedOn: "2026-10-28",
            evaluation: null,
          },
          {
            id: "0199f0a0-0000-7000-8000-0000000000f2",
            topic: "family",
            value: {
              key: "children",
              children: [
                { name: null, birthDate: null, age: 9, ageOn: "2026-10-28", disability: true },
              ],
            },
            source: "questionnaire",
            sourceRef: null,
            status: "confirmed",
            recordedOn: "2026-10-28",
            evaluation: { onDate: "2026-10-28", childAges: [9], childrenUnder18: 1 },
          },
        ],
      });
    }),
  );
  return bodies;
}

describe("AUTH-07, PROF-02: анкета на 1 минуту", () => {
  it("ответы и пропуски: на сервер — только отвеченное; итог — «Вот что я запомнил»", async () => {
    const bodies = captureAnswers();
    renderPage();
    const next = () => screen.getByRole("button", { name: /^(Далее|Готово)$/ });
    expect(await screen.findByText("Вопрос 1 из 6")).toBeInTheDocument();
    expect(next()).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: /Наёмный работник/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Плательщик НПД/ }));
    await userEvent.click(next());

    expect(screen.getByRole("heading", { name: "Сколько у вас детей?" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Больше детей" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Возраст, полных лет" }), "9");
    await userEvent.click(screen.getByRole("checkbox", { name: "Инвалидность" }));
    await userEvent.click(next());

    for (let question = 3; question <= 6; question += 1) {
      expect(screen.getByText(`Вопрос ${String(question)} из 6`)).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Пропустить вопрос" }));
    }

    expect(await screen.findByRole("heading", { name: "Вот что я запомнил" })).toBeInTheDocument();
    expect(bodies).toEqual([
      {
        answers: {
          employment: ["employee", "npd"],
          children: [{ age: 9, disability: true }],
        },
      },
    ]);
    expect(screen.getByText("Наёмный работник, Плательщик НПД")).toBeInTheDocument();
    expect(screen.getByText("1 ребёнок — 9 лет (инвалидность)")).toBeInTheDocument();
    expect(screen.getAllByText("Спрошу, когда понадобится")).toHaveLength(4);
  });

  it("«Изменить» в итоге возвращает к вопросу", async () => {
    captureAnswers();
    renderPage();
    for (let question = 1; question <= 6; question += 1) {
      await userEvent.click(await screen.findByRole("button", { name: "Пропустить вопрос" }));
    }
    await userEvent.click(
      await screen.findByRole("button", { name: "Изменить: Учёт нуждающихся в жилье" }),
    );
    expect(screen.getByText("Вопрос 3 из 6")).toBeInTheDocument();
  });

  it("«Пропустить анкету» — пустые ответы и переход на главную", async () => {
    const bodies = captureAnswers();
    const router = renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Пропустить анкету" }));
    expect(await screen.findByText("Главная")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
    expect(bodies).toEqual([{ answers: {} }]);
  });

  it("сервер не сохранил — что случилось и что сделать", async () => {
    server.use(
      http.post("*/api/profile/onboarding", () =>
        HttpResponse.json(
          {
            defined: false,
            code: "INTERNAL",
            status: 500,
            message: "INTERNAL",
            data: { requestId: "req-00000001", params: {} },
          },
          { status: 500 },
        ),
      ),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Пропустить анкету" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось сохранить ответы");
  });

  it("«Ничего из этого» снимает остальные отметки и уходит пустым списком", () => {
    const state = {
      employment: [],
      kids: [],
      housing: "now",
      benefit: false,
      young: true,
      family: ["none"],
    };
    expect(answersOf(state, new Set(["housing", "benefit", "young", "family"]))).toEqual({
      housingQueue: "now",
      benefitCategory: false,
      youngSpecialist: true,
      familyStatus: [],
    });
  });
});

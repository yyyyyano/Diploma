// RCPT-02, RCPT-06, NFR-20: Steps — этапы проверки чека; состояние держится не на цвете, анимация учитывает reduced-motion.
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Steps } from "./Steps.tsx";

const stateLabels = { done: "сделано", active: "идёт", pending: "ждёт" } as const;

describe("Steps", () => {
  it("этапы по порядку: читаю — сделано, проверяю — идёт, раскладываю — ждёт; состояние названо текстом", () => {
    renderWithProviders(
      <Steps
        label="Этапы проверки чека"
        stateLabels={stateLabels}
        steps={[
          { id: "read", label: "Читаю чек", state: "done" },
          { id: "check", label: "Проверяю арифметику", state: "active" },
          { id: "sort", label: "Раскладываю по категориям", state: "pending" },
        ]}
      />,
    );
    const list = screen.getByRole("list", { name: "Этапы проверки чека" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Читаю чек сделано",
      "Проверяю арифметику идёт",
      "Раскладываю по категориям ждёт",
    ]);
    expect(items.map((item) => item.getAttribute("data-state"))).toEqual([
      "done",
      "active",
      "pending",
    ]);
  });

  it("иконки декоративны (aria-hidden): смысл — в тексте, а не в картинке", () => {
    const { container } = renderWithProviders(
      <Steps
        label="Этапы"
        stateLabels={stateLabels}
        steps={[{ id: "a", label: "А", state: "done" }]}
      />,
    );
    expect(container.querySelector("svg")?.closest("[aria-hidden]")).not.toBeNull();
  });

  it("анимация идущего этапа отключается при prefers-reduced-motion", () => {
    const css = readFileSync(join(import.meta.dirname, "Steps.module.css"), "utf8");
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*{[^}]*\.spin\s*{\s*animation: none/s,
    );
  });
});

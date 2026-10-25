import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { PageHeader } from "./PageHeader.tsx";

describe("PageHeader — верхняя панель страницы", () => {
  it("единственный заголовок первого уровня, подзаголовок и действия", () => {
    renderWithProviders(
      <PageHeader
        title="Операции"
        subtitle="Октябрь 2026"
        actions={<button type="button">Добавить</button>}
      />,
    );
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Операции");
    expect(screen.getByText("Октябрь 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Добавить" })).toBeInTheDocument();
  });

  it("без подзаголовка и действий — только заголовок", () => {
    const { container } = renderWithProviders(<PageHeader title="Счета" />);
    expect(container.querySelector("header")?.children).toHaveLength(1);
  });
});

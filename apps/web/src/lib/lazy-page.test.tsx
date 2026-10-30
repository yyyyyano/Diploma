// lazyPage: страница грузится при первом показе и получает свои свойства как есть (бюджет первой загрузки — CONSTRAINTS).
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { lazyPage } from "./lazy-page.tsx";

describe("lazyPage", () => {
  it("не грузит страницу до показа, затем рисует её с переданными свойствами", async () => {
    const load = vi.fn<() => Promise<{ Heading: (props: { title: string }) => ReactElement }>>(() =>
      Promise.resolve({ Heading: ({ title }: { title: string }) => <h1>{title}</h1> }),
    );
    const Page = lazyPage(load, "Heading");
    expect(load).not.toHaveBeenCalled();

    render(<Page title="Операции" />);

    expect(await screen.findByRole("heading", { name: "Операции" })).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });
});

// AUTH-03, AUTH-06: одно письмо — две части для SMTP (текст и HTML); значения экранируются, ссылка — только http(s).
import { describe, expect, it } from "vitest";
import { escapeHtml, isSafeLink, renderHtml, renderText, type MailMessage } from "./message.ts";

const message: MailMessage = {
  to: "irina@example.test",
  subject: "Подтвердите адрес",
  preview: "Подтвердите адрес — так можно восстановить пароль.",
  title: "Подтвердите ваш адрес",
  paragraphs: ["Здравствуйте!", "Пользоваться можно и до подтверждения."],
  action: { label: "Подтвердить адрес", url: "http://127.0.0.1:8140/verify-email?token=abc" },
  note: { kind: "info", text: "Ссылка действует 24 часа." },
};

describe("AUTH-06: части письма", () => {
  it("текст: заголовок, абзацы, кнопка ссылкой отдельной строкой и пометка — через пустую строку", () => {
    expect(renderText(message)).toBe(
      "Подтвердите ваш адрес\n\nЗдравствуйте!\n\nПользоваться можно и до подтверждения.\n\n" +
        "Подтвердить адрес: http://127.0.0.1:8140/verify-email?token=abc\n\nСсылка действует 24 часа.\n",
    );
  });

  it("текст без кнопки и пометки — только заголовок и абзацы", () => {
    const { action: _action, note: _note, ...plain } = message;
    expect(renderText(plain)).toBe(
      "Подтвердите ваш адрес\n\nЗдравствуйте!\n\nПользоваться можно и до подтверждения.\n",
    );
  });

  it("HTML экранирует заголовок, абзацы и ссылку: разметка из значений не исполняется", () => {
    const html = renderHtml({
      ...message,
      title: "<script>alert(1)</script>",
      paragraphs: ['Tom & "Jerry"'],
      action: { label: "Открыть", url: "http://127.0.0.1:8140/x?a=1&b='2'" },
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("<p>Tom &amp; &quot;Jerry&quot;</p>");
    expect(html).toContain('href="http://127.0.0.1:8140/x?a=1&amp;b=&#39;2&#39;"');
    expect(html).toContain("<small>Ссылка действует 24 часа.</small>");
  });

  it("HTML без кнопки и пометки — без ссылок и мелкого шрифта", () => {
    const { action: _action, note: _note, ...plain } = message;
    const html = renderHtml(plain);
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<small>");
  });

  it("escapeHtml оставляет обычный текст как есть", () => {
    expect(escapeHtml("Кошт 2026")).toBe("Кошт 2026");
  });
});

describe("ссылка письма", () => {
  it.each([
    ["http://127.0.0.1:8140/verify-email?token=a", true],
    ["https://kosht.example/reset", true],
    ["javascript:alert(1)", false],
    ["ftp://example.test/file", false],
    ["не ссылка", false],
  ])("%s — допустима: %s", (url, safe) => {
    expect(isSafeLink(url)).toBe(safe);
  });
});

// AUTH-06, NFR-24, R40: ящик — только на локальном входе. На сетевом слушателе процедуры mailbox «нет» (NOT_FOUND),
// а status говорит, что ящика нет, даже когда почта не настроена.
import { call } from "@orpc/server";
import { describe, expect, it } from "vitest";
import type { HttpContext } from "../../../platform/http/procedures.ts";
import type { ListenerName } from "../../../platform/http/guard.ts";
import { mailRouter } from "./router.ts";

const letter = {
  id: "0199f0a0-0000-7000-8000-000000000001",
  to: "irina@example.test",
  subject: "Тема",
  preview: "Превью",
  title: "Заголовок",
  paragraphs: ["Абзац"],
  action: { label: "Открыть", url: "http://127.0.0.1:8140/x" },
  sentAt: new Date("2026-10-26T09:00:00Z"),
};

function routerWith(enabled: boolean) {
  return mailRouter({
    mailbox: async () => ({ enabled, messages: enabled ? [letter] : [] }),
    mailboxEnabled: async () => enabled,
  });
}

function context(listener: ListenerName): HttpContext {
  return {
    requestId: "mail-router-test",
    listener,
    session: async () => undefined,
    shutdownSignal: new AbortController().signal,
  };
}

describe("AUTH-06: страница ящика только на этом компьютере", () => {
  it("локальный вход, почта не настроена: ящик доступен, письмо — DTO без пустых полей (null)", async () => {
    const router = routerWith(true);
    expect(await call(router.status, undefined, { context: context("local") })).toEqual({
      mailboxAvailable: true,
    });
    expect(await call(router.mailbox, undefined, { context: context("local") })).toEqual({
      enabled: true,
      messages: [{ ...letter, note: null, sentAt: "2026-10-26T09:00:00.000Z" }],
    });
  });

  it("сетевой вход: mailbox — NOT_FOUND, status — ящика нет", async () => {
    const router = routerWith(true);
    await expect(
      call(router.mailbox, undefined, { context: context("lan") }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await call(router.status, undefined, { context: context("lan") })).toEqual({
      mailboxAvailable: false,
    });
  });

  it("почта настроена: ящик выключен и на локальном входе", async () => {
    const router = routerWith(false);
    expect(await call(router.status, undefined, { context: context("local") })).toEqual({
      mailboxAvailable: false,
    });
    expect(await call(router.mailbox, undefined, { context: context("local") })).toEqual({
      enabled: false,
      messages: [],
    });
  });
});

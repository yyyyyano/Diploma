// TG-08: ссылка на сайт — раздел по виду объекта; URL-кнопкой — только публичный адрес (иначе Telegram: BUTTON_URL_INVALID).
import { describe, expect, it } from "vitest";
import { isButtonUrl, objectPath, siteUrl } from "./site-link.ts";

const id = "0194f3a2-7c1e-7b52-9a3d-4e5f6a7b8c9d";

describe("раздел сайта по объекту уведомления", () => {
  it("чек, операция, лимит и неизвестный вид", () => {
    expect(objectPath({ entity: "receipt", id })).toBe(`/documents?open=${id}`);
    expect(objectPath({ entity: "transaction", id })).toBe(`/operations?open=${id}`);
    expect(objectPath({ entity: "limit", id })).toBe("/budget");
    expect(objectPath({ entity: "что-то", id })).toBeUndefined();
    expect(objectPath(null)).toBeUndefined();
  });
});

describe("адрес для URL-кнопки", () => {
  it.each([
    "http://127.0.0.1:8140/budget",
    "http://localhost:8140/",
    "http://192.168.1.5:8141/",
    "http://10.0.0.7/",
    "http://172.20.0.3/",
    "http://kosht.local/",
    "http://[::1]:8140/",
    "http://kosht/",
    "ftp://example.com/",
    "не адрес",
  ])("«%s» — кнопкой нельзя", (url) => {
    expect(isButtonUrl(url)).toBe(false);
  });

  it.each(["https://kosht.example.by/budget", "http://8.8.8.8/", "http://172.32.0.1/"])(
    "«%s» — можно",
    (url) => {
      expect(isButtonUrl(url)).toBe(true);
    },
  );

  it("siteUrl склеивает адрес и раздел", () => {
    expect(siteUrl("http://127.0.0.1:8140", "/budget")).toBe("http://127.0.0.1:8140/budget");
  });
});

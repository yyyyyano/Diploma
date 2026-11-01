// NFR-24: адрес ссылок в письмах — только из настроек: доступ из сети включён и адрес задан — он, иначе — локальный
// вход. Запроса (слушателя и Host) функция не видит вовсе: Host задаёт клиент, и подмена увела бы токен ссылки.
import { describe, expect, it } from "vitest";
import { isAllowedHost } from "./guard.ts";
import { LAN_ADDRESS, linkOrigin, localLoginOrigin } from "./link-origin.ts";

const local = "http://127.0.0.1:8140";

describe("NFR-24: адрес ссылок в письмах", () => {
  it("доступ из сети включён и адрес задан — сетевой адрес из настройки, без пути", () => {
    expect(
      linkOrigin({ allowLan: true, lanAddress: "http://192.168.1.5:8141/", localOrigin: local }),
    ).toBe("http://192.168.1.5:8141");
  });

  it("доступ из сети выключен — локальный адрес, даже если сетевой задан", () => {
    expect(
      linkOrigin({ allowLan: false, lanAddress: "http://192.168.1.5:8141", localOrigin: local }),
    ).toBe(local);
  });

  it("доступ включён, но адрес не задан — локальный адрес", () => {
    expect(linkOrigin({ allowLan: true, lanAddress: "", localOrigin: local })).toBe(local);
  });

  it("настройка сетевого адреса: пусто или http(s)-адрес; прочее не проходит схему", () => {
    expect(LAN_ADDRESS.schema.safeParse("").success).toBe(true);
    expect(LAN_ADDRESS.schema.safeParse("http://192.168.1.5:8141").success).toBe(true);
    expect(LAN_ADDRESS.schema.safeParse("javascript:alert(1)").success).toBe(false);
    expect(LAN_ADDRESS.schema.safeParse("192.168.1.5").success).toBe(false);
  });
});

describe("NFR-24: адрес локального входа для ссылок", () => {
  it("слушатель на «любом адресе» (контейнер: 0.0.0.0, ::) — в ссылке 127.0.0.1: 0.0.0.0 браузер шлёт Host: 0.0.0.0, и guard его отвергает", () => {
    expect(localLoginOrigin("0.0.0.0", 8140)).toBe("http://127.0.0.1:8140");
    expect(localLoginOrigin("::", 8140)).toBe("http://127.0.0.1:8140");
    expect(localLoginOrigin("[::]", 8140)).toBe("http://127.0.0.1:8140");
  });

  it("конкретный адрес — без изменений; IPv6 — в скобках, как требует запись URL", () => {
    expect(localLoginOrigin("127.0.0.1", 8140)).toBe("http://127.0.0.1:8140");
    expect(localLoginOrigin("::1", 8140)).toBe("http://[::1]:8140");
    expect(localLoginOrigin("[::1]", 8140)).toBe("http://[::1]:8140");
  });

  it("Host из такой ссылки пропускает локальный слушатель", () => {
    for (const host of ["0.0.0.0", "::", "127.0.0.1", "::1"]) {
      const url = new URL(localLoginOrigin(host, 8140));
      expect(isAllowedHost(url.host, "local")).toBe(true);
    }
  });
});

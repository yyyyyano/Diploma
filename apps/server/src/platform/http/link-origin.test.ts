// NFR-24: адрес ссылок в письмах — только из настроек: доступ из сети включён и адрес задан — он, иначе — локальный
// вход. Запроса (слушателя и Host) функция не видит вовсе: Host задаёт клиент, и подмена увела бы токен ссылки.
import { describe, expect, it } from "vitest";
import { LAN_ADDRESS, linkOrigin } from "./link-origin.ts";

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

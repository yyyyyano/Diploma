// NFR-24: адрес ссылок в письмах — три случая: запрос через сетевой вход, доступ из сети включён и адрес задан,
// иначе — локальный вход. Сетевой адрес не угадывается по интерфейсам (в контейнере это 172.x).
import { describe, expect, it } from "vitest";
import { LAN_ADDRESS, linkOrigin } from "./link-origin.ts";

const local = "http://127.0.0.1:8140";

describe("NFR-24: адрес ссылок в письмах", () => {
  it("запрос пришёл через сетевой вход — адрес из его Host", () => {
    expect(
      linkOrigin(
        { listener: "lan", host: "192.168.1.5:8141" },
        { allowLan: true, lanAddress: "http://10.0.0.7:8141", localOrigin: local },
      ),
    ).toBe("http://192.168.1.5:8141");
  });

  it("запрос с этого компьютера, доступ из сети включён и адрес задан — сетевой адрес из настройки", () => {
    expect(
      linkOrigin(
        { listener: "local", host: "127.0.0.1:8140" },
        { allowLan: true, lanAddress: "http://192.168.1.5:8141/", localOrigin: local },
      ),
    ).toBe("http://192.168.1.5:8141");
  });

  it("доступ из сети выключен — локальный адрес, даже если сетевой задан", () => {
    expect(
      linkOrigin(
        { listener: "local", host: "localhost:8140" },
        { allowLan: false, lanAddress: "http://192.168.1.5:8141", localOrigin: local },
      ),
    ).toBe(local);
  });

  it("доступ включён, но адрес не задан — локальный адрес", () => {
    expect(
      linkOrigin(
        { listener: "local", host: undefined },
        { allowLan: true, lanAddress: "", localOrigin: local },
      ),
    ).toBe(local);
  });

  it("настройка сетевого адреса: пусто или http(s)-адрес; прочее не проходит схему", () => {
    expect(LAN_ADDRESS.schema.safeParse("").success).toBe(true);
    expect(LAN_ADDRESS.schema.safeParse("http://192.168.1.5:8141").success).toBe(true);
    expect(LAN_ADDRESS.schema.safeParse("javascript:alert(1)").success).toBe(false);
    expect(LAN_ADDRESS.schema.safeParse("192.168.1.5").success).toBe(false);
  });
});

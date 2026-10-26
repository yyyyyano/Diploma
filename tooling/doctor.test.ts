// make doctor (NFR-14, ADR-0015): проверки машины — чистые функции на заготовленных ответах docker, id и портов.
import { describe, expect, it } from "vitest";
import {
  checkDocker,
  checkGroups,
  checkNode,
  checkPnpm,
  checkPorts,
  compareVersions,
  PORTS,
  projectPorts,
} from "./doctor.ts";

describe("ADR-0015: make doctor", () => {
  it("порты стека — 8140–8143, 5440, 3001 и Vite make dev 5173", () => {
    expect([...PORTS]).toEqual([8140, 8141, 8142, 8143, 5440, 3001, 5173]);
  });

  it("версии сравниваются по числам, суффиксы отбрасываются", () => {
    expect(compareVersions("28.3.3", "28.3.3")).toBe(0);
    expect(compareVersions("28.10.0", "28.3.3")).toBeGreaterThan(0);
    expect(compareVersions("28.3.2", "28.3.3")).toBeLessThan(0);
    expect(compareVersions("29.0.0-rc.1", "28.3.3")).toBeGreaterThan(0);
  });

  it("Node — по мажорной версии .node-version; pnpm — точно по packageManager", () => {
    expect(checkNode("26.12.1", "26").ok).toBe(true);
    expect(checkNode("24.1.0", "26")).toMatchObject({
      ok: false,
      hint: expect.stringContaining("nvm install 26"),
    });
    expect(checkPnpm("12.15.0", "12.15.0").ok).toBe(true);
    expect(checkPnpm(undefined, "12.15.0").label).toContain("не найден");
  });

  it("Docker Desktop — ✖ с подсказкой docker context use default; Engine 29 — ✔", () => {
    const desktop = checkDocker({ os: "Docker Desktop", version: "29.8.0" });
    expect(desktop[0]).toMatchObject({
      ok: false,
      hint: expect.stringContaining("docker context use default"),
    });
    expect(checkDocker({ os: "Ubuntu 26.04 LTS", version: "29.8.0" }).every((c) => c.ok)).toBe(
      true,
    );
  });

  it("Docker старше 28.3.3 — ✖; Docker не отвечает — ✖", () => {
    expect(checkDocker({ os: "Ubuntu 24.04", version: "28.3.2" })[1]?.ok).toBe(false);
    expect(checkDocker(undefined)).toEqual([expect.objectContaining({ ok: false })]);
  });

  it("группы docker и render — каждая отдельной строкой", () => {
    expect(checkGroups(["user", "docker"], ["user", "docker"]).map((c) => c.ok)).toEqual([
      true,
      false,
    ]);
    const all = ["user", "docker", "render"];
    expect(checkGroups(all, all).every((c) => c.ok)).toBe(true);
  });

  it("в группе по базе, но сеанс старый — ✖ с подсказкой войти заново", () => {
    const [docker] = checkGroups(["user", "docker", "render"], ["user"]);
    expect(docker).toMatchObject({ ok: false, label: "группа docker — ещё не в этом сеансе" });
    expect(docker?.hint).toContain("войдите снова");
  });

  it("порт занят чужой программой — ✖; занят контейнером проекта kosht — свободен", () => {
    const checks = checkPorts(
      new Set([5440, 3001]),
      projectPorts(
        [
          JSON.stringify({
            Service: "db",
            Publishers: [{ URL: "127.0.0.1", TargetPort: 5432, PublishedPort: 5440 }],
          }),
          JSON.stringify({ Service: "worker", Publishers: [] }),
          "",
        ].join("\n"),
      ),
    );
    expect(checks.filter((c) => !c.ok).map((c) => c.label)).toEqual(["порт 3001"]);
    expect(checks.find((c) => c.label.includes("5440"))?.label).toContain(
      "у запущенного стека kosht",
    );
  });

  it("порт без публикации (PublishedPort 0) проекту не принадлежит", () => {
    expect([...projectPorts(JSON.stringify({ Publishers: [{ PublishedPort: 0 }] }))]).toEqual([]);
  });
});

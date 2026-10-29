// ADR-0011, ADR-0015: пресеты llama-server — секции названы как модели реестра, «глаз» на процессоре, мышление выключено.
import { describe, expect, it } from "vitest";
import { CATALOG } from "./catalog.ts";
import { renderPresets } from "./presets.ts";

describe("ADR-0011: пресеты роутера llama-server", () => {
  it("секции — модели реестра; пути — внутри контейнера; mmproj на процессоре; мышление выключено", () => {
    const ini = renderPresets();
    expect(ini).toContain("[qwen3.5-4b]");
    expect(ini).toContain("[bge-m3]");
    expect(ini).toContain("model = /models/llm/qwen3.5-4b/Qwen3.5-4B-Q4_K_M.gguf");
    expect(ini).toContain("mmproj = /models/llm/qwen3.5-4b/mmproj-F16.gguf");
    expect(ini).toContain("no-mmproj-offload = true");
    expect(ini).toContain("reasoning-budget = 0");
    expect(ini).toContain("n-gpu-layers = all");
  });

  it("запасной режим — все слои на процессоре", () => {
    expect(renderPresets({ cpuOnly: true })).not.toContain("n-gpu-layers = all");
    expect(renderPresets({ cpuOnly: true }).match(/n-gpu-layers = 0/g)).toHaveLength(2);
  });

  it("пути пресетов совпадают с каталогом загрузчика: llama читает то, что скачано", () => {
    const ini = renderPresets();
    for (const path of [
      "llm/qwen3.5-4b/Qwen3.5-4B-Q4_K_M.gguf",
      "llm/qwen3.5-4b/mmproj-F16.gguf",
      "embed/bge-m3-q8_0.gguf",
    ]) {
      expect(CATALOG.flatMap((model) => model.files).some((file) => file.path === path)).toBe(true);
      expect(ini).toContain(`/models/${path}`);
    }
  });

  it("каталог: адреса закреплены на коммит, суммы — 64 hex, размеры положительны", () => {
    for (const file of CATALOG.flatMap((model) => model.files)) {
      expect(file.url).toMatch(/^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/[0-9a-f]{40}\//);
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(file.size).toBeGreaterThan(0);
    }
  });
});

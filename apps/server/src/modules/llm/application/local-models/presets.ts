// Пресеты llama-server в режиме роутера (ADR-0011, ADR-0015): INI-файл `<DATA_DIR>/models/presets.ini` — секция на
// модель, ключи — аргументы командной строки без «--». Секция называется как модель реестра (`qwen3.5-4b`, `bge-m3`):
// это значение поля `model` в запросах OpenAI API. Пути — внутри контейнера llama (`./data/models` смонтирован в /models).
// «Глаз» (mmproj) всегда на процессоре: через Vulkan на Intel Arc он выдаёт мусор (ARCHITECTURE §15). Самотест при
// старте при «мусоре» переключает и саму модель на процессор (cpuOnly) — файл переписывается, роутер перечитывает его.
export const CONTAINER_MODELS_DIR = "/models";

export interface PresetOptions {
  /** Все слои на процессоре: запасной режим после неудачного самотеста. */
  readonly cpuOnly?: boolean;
}

export function renderPresets(options: PresetOptions = {}): string {
  const layers = options.cpuOnly === true ? "0" : "all";
  return [
    "version = 1",
    "",
    "[*]",
    "jinja = true",
    "# Мышление выключено: с ним ответ 4B-модели на процессоре шёл бы минутами (ADR-0011).",
    "reasoning-budget = 0",
    "",
    "[qwen3.5-4b]",
    `model = ${CONTAINER_MODELS_DIR}/llm/qwen3.5-4b/Qwen3.5-4B-Q4_K_M.gguf`,
    `mmproj = ${CONTAINER_MODELS_DIR}/llm/qwen3.5-4b/mmproj-F16.gguf`,
    "no-mmproj-offload = true",
    "image-max-tokens = 1024",
    "ctx-size = 16384",
    `n-gpu-layers = ${layers}`,
    "",
    "[bge-m3]",
    `model = ${CONTAINER_MODELS_DIR}/embed/bge-m3-q8_0.gguf`,
    "embeddings = true",
    "pooling = cls",
    "ctx-size = 8192",
    `n-gpu-layers = ${layers}`,
    "",
  ].join("\n");
}

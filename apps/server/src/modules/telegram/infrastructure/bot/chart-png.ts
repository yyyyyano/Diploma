// График для бота (TG-08): SVG из `domain/chart-svg.ts` → PNG через sharp. В SVG нет текста, поэтому шрифты системы не нужны
// (в `node:*-slim` кириллических шрифтов может не быть); подписи идут в тексте сообщения. sharp — только здесь (правило
// `sharp-only-in-llm-images`, исключение telegram/infrastructure).
import type { ChartData } from "@kosht/contract";
import sharp from "sharp";
import { chartSvg } from "../../domain/chart-svg.ts";

export async function renderChartPng(chart: ChartData): Promise<Uint8Array> {
  return sharp(Buffer.from(chartSvg(chart)))
    .png()
    .toBuffer();
}

// Хэш-эмбеддер для тестов (ARCHITECTURE §4.4, NFR-11): вектор текста — «мешок слов» по хэшу слов в заданное число
// измерений, нормированный. Детерминирован, офлайн, без модели; похожие тексты (общие слова) ближе друг к другу, чем
// разные, — этого хватает, чтобы проверять поиск и порядок выдачи. Форма совпадает с портом Embedder модуля llm
// (`dimensions`, `embed`); сервер сюда не импортируется — типы сверяются структурно.
import { createHash } from "node:crypto";

export interface HashEmbedder {
  readonly dimensions: number;
  embed(texts: readonly string[]): Promise<number[][]>;
}

const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

function embedOne(text: string, dimensions: number): number[] {
  const vector = Array.from({ length: dimensions }, () => 0);
  for (const word of words(text)) {
    const digest = createHash("sha256").update(word).digest();
    const index = digest.readUInt32BE(0) % dimensions;
    vector[index] =
      (vector[index] ?? 0) + (digest[4] === undefined || digest[4] % 2 === 0 ? 1 : -1);
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm === 0 ? vector : vector.map((value) => value / norm);
}

export function hashEmbedder(dimensions = 1024): HashEmbedder {
  return {
    dimensions,
    embed: async (texts) => texts.map((text) => embedOne(text, dimensions)),
  };
}

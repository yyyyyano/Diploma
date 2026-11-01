// Синтетическая запись для тестов голоса (VOICE-02, бот T-052): тишина WAV PCM нужной частоты, каналов, разрядности и
// длительности (NFR-18: настоящей речи нет).
export function makeWav(
  options: {
    readonly seconds?: number;
    readonly sampleRate?: number;
    readonly channels?: number;
    readonly bits?: number;
    readonly format?: number;
  } = {},
): Uint8Array {
  const { seconds = 1, sampleRate = 16_000, channels = 1, bits = 16, format = 1 } = options;
  const dataBytes = Math.round(seconds * sampleRate) * channels * (bits / 8);
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(at + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * (bits / 8), true);
  view.setUint16(32, channels * (bits / 8), true);
  view.setUint16(34, bits, true);
  text(36, "data");
  view.setUint32(40, dataBytes, true);
  return bytes;
}

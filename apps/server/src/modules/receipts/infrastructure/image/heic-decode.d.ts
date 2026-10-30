// У heic-decode нет своих типов: нужна только одна функция — главный кадр HEIC в сырые пиксели RGBA.
declare module "heic-decode" {
  interface DecodedImage {
    readonly width: number;
    readonly height: number;
    readonly data: Uint8ClampedArray;
  }
  export default function decode(input: {
    buffer: Uint8Array | ArrayBuffer;
  }): Promise<DecodedImage>;
}

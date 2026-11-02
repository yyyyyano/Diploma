// DEMO-01: фото чеков демо — по одному на чек, настоящие JPEG небольшого размера, генератор детерминирован, а лежащий в бандле
// `domain/photos.ts` не отстал от генератора (иначе правка чека демо без `make synth-demo-photos` осталась бы незамеченной).
import { describe, expect, it } from "vitest";
import { RECEIPT_PHOTOS } from "../../../apps/server/src/modules/demo/domain/photos.ts";
import { renderDemoPhotos } from "./generate-photos.ts";

describe("DEMO-01: фото чеков демо", () => {
  it("пять фото — настоящие JPEG до 60 КБ; повторный запуск даёт те же байты", async () => {
    const first = await renderDemoPhotos();
    const second = await renderDemoPhotos();
    expect(Object.keys(first).toSorted()).toEqual(
      ["belfarmaciya", "elektrosila", "evroopt", "gippo", "korona"].toSorted(),
    );
    expect(second).toEqual(first);
    for (const data of Object.values(first)) {
      const bytes = Buffer.from(data, "base64");
      expect(bytes.subarray(0, 3).toString("hex")).toBe("ffd8ff");
      expect(bytes.byteLength).toBeLessThan(60_000);
    }
  });

  it("файл в бандле совпадает с тем, что рисует генератор", async () => {
    expect(RECEIPT_PHOTOS).toEqual(await renderDemoPhotos());
  });
});

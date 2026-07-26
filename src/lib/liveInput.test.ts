import { describe, expect, it } from "vitest";
import {
  COLLAPSED_MAX_PX,
  EXPANDED_MAX_PX,
  shouldOfferExpand,
  syncLiveInputView,
} from "./liveInput";

function fakeEl(scrollHeight: number, scrollTop = 0) {
  return { scrollHeight, scrollTop, style: { height: "" } };
}

describe("syncLiveInputView", () => {
  it("折りたたみ中は内容の高さに合わせつつ上限で止める", () => {
    const short = fakeEl(40);
    syncLiveInputView(short, { expanded: false, follow: false });
    expect(short.style.height).toBe("40px");

    const tall = fakeEl(400);
    syncLiveInputView(tall, { expanded: false, follow: false });
    expect(tall.style.height).toBe(`${COLLAPSED_MAX_PX}px`);
  });

  it("展開中はより大きな上限まで全文を見せる", () => {
    const tall = fakeEl(400);
    syncLiveInputView(tall, { expanded: true, follow: false });
    expect(tall.style.height).toBe(`${Math.min(400, EXPANDED_MAX_PX)}px`);

    const short = fakeEl(90);
    syncLiveInputView(short, { expanded: true, follow: false });
    expect(short.style.height).toBe("90px");
  });

  it("follow指定で最新の発話が見えるよう末尾までスクロールする", () => {
    const el = fakeEl(400, 0);
    syncLiveInputView(el, { expanded: false, follow: true });
    expect(el.scrollTop).toBe(400);
  });

  it("follow無し(手動編集中)はスクロール位置を動かさない", () => {
    const el = fakeEl(400, 120);
    syncLiveInputView(el, { expanded: false, follow: false });
    expect(el.scrollTop).toBe(120);
  });

  it("内容が減ったときは高さをリセットして測り直し、欄が縮む", () => {
    // 実DOMのscrollHeightは明示heightより小さくならないため、
    // 一度 auto に戻してから測る実装であることを、height依存のfakeで確認する
    const el = {
      scrollTop: 0,
      style: { height: "63px" },
      get scrollHeight() {
        return this.style.height === "auto" ? 30 : 400;
      },
    };
    syncLiveInputView(el, { expanded: false, follow: false });
    expect(el.style.height).toBe("30px");
  });

  it("非表示などで高さが測れない(scrollHeight=0)ときは何もしない", () => {
    const el = fakeEl(0, 50);
    el.style.height = "40px";
    syncLiveInputView(el, { expanded: false, follow: true });
    expect(el.style.height).toBe("40px");
    expect(el.scrollTop).toBe(50);
  });
});

describe("shouldOfferExpand", () => {
  it("短い発話にはトグルを出さない", () => {
    expect(shouldOfferExpand("こんにちは")).toBe(false);
    expect(shouldOfferExpand("")).toBe(false);
  });

  it("1行に収まらない長さの発話でトグルを出す", () => {
    expect(shouldOfferExpand("長い発話。".repeat(20))).toBe(true);
  });

  it("改行を含む発話にはトグルを出す", () => {
    expect(shouldOfferExpand("一行目\n二行目")).toBe(true);
  });
});

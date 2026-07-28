import { describe, expect, it } from "vitest";
import { computeBars, smoothLevel } from "./micLevel";

describe("computeBars", () => {
  it("averages contiguous frequency bins into the requested bar count, normalized 0-1", () => {
    // 8 bins split into 4 bars of 2 bins each: [0,255]->avg 127.5/255, etc.
    const data = new Uint8Array([0, 255, 128, 128, 255, 255, 0, 0]);
    const bars = computeBars(data, 4);
    expect(bars).toHaveLength(4);
    expect(bars[0]).toBeCloseTo(127.5 / 255, 5);
    expect(bars[1]).toBeCloseTo(128 / 255, 5);
    expect(bars[2]).toBeCloseTo(1, 5);
    expect(bars[3]).toBeCloseTo(0, 5);
  });

  it("returns all-zero bars for silent (all-zero) input", () => {
    const data = new Uint8Array(16);
    expect(computeBars(data, 5)).toEqual([0, 0, 0, 0, 0]);
  });

  it("returns an empty array when barCount is zero or negative", () => {
    const data = new Uint8Array([1, 2, 3]);
    expect(computeBars(data, 0)).toEqual([]);
    expect(computeBars(data, -3)).toEqual([]);
  });

  it("returns zeros for empty frequency data without dividing by zero", () => {
    expect(computeBars(new Uint8Array(0), 3)).toEqual([0, 0, 0]);
  });

  it("fills bars with 0 when there are fewer bins than bars", () => {
    const data = new Uint8Array([255]);
    const bars = computeBars(data, 3);
    expect(bars).toHaveLength(3);
    expect(bars[0]).toBeCloseTo(1, 5);
    expect(bars[1]).toBe(0);
    expect(bars[2]).toBe(0);
  });
});

describe("smoothLevel", () => {
  it("moves partway from prev toward target by the smoothing factor", () => {
    expect(smoothLevel(0, 1, 0.25)).toBeCloseTo(0.25, 5);
    expect(smoothLevel(0.5, 0, 0.5)).toBeCloseTo(0.25, 5);
  });

  it("snaps straight to target when factor is 1", () => {
    expect(smoothLevel(0.1, 0.9, 1)).toBe(0.9);
  });

  it("stays at prev when factor is 0", () => {
    expect(smoothLevel(0.42, 0.9, 0)).toBe(0.42);
  });

  it("clamps the result to the 0-1 range", () => {
    expect(smoothLevel(-5, 2, 1)).toBe(1);
    expect(smoothLevel(2, -5, 1)).toBe(0);
  });
});

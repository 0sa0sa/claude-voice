import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMicLevel } from "./useMicLevel";

class FakeAnalyser {
  fftSize = 2048;
  frequencyBinCount = 32;
  data = new Uint8Array(32);
  getByteFrequencyData(out: Uint8Array) {
    out.set(this.data.subarray(0, out.length));
  }
}

class FakeSourceNode {
  connect = vi.fn();
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  closed = false;
  analyser = new FakeAnalyser();
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  createAnalyser() {
    return this.analyser;
  }
  createMediaStreamSource() {
    return new FakeSourceNode();
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
}

function fakeStream(): MediaStream {
  return { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
}

let rafCallbacks: FrameRequestCallback[] = [];

function flushRaf() {
  const cbs = rafCallbacks;
  rafCallbacks = [];
  cbs.forEach((cb) => cb(0));
}

afterEach(() => {
  vi.unstubAllGlobals();
  rafCallbacks = [];
  FakeAudioContext.instances = [];
});

describe("useMicLevel", () => {
  function stubAudioGlobals(getUserMedia = vi.fn().mockResolvedValue(fakeStream())) {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    return getUserMedia;
  }

  it("stays at rest (all-zero bars, zero level) while inactive", () => {
    stubAudioGlobals();
    const { result } = renderHook(() => useMicLevel(false));
    expect(result.current.level).toBe(0);
    expect(result.current.bars.every((b) => b === 0)).toBe(true);
  });

  it("requests a mic stream and reports levels from analyser data once active", async () => {
    const getUserMedia = stubAudioGlobals();
    const { result } = renderHook(({ active }) => useMicLevel(active, { bars: 4 }), {
      initialProps: { active: true },
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getUserMedia).toHaveBeenCalled();

    const ctx = FakeAudioContext.instances[0];
    ctx.analyser.data = new Uint8Array(32).fill(255);

    await act(async () => {
      flushRaf();
    });

    expect(result.current.level).toBeGreaterThan(0);
    expect(result.current.bars).toHaveLength(4);
    expect(result.current.bars.every((b) => b > 0)).toBe(true);
  });

  it("tears down the audio context and stops the stream when deactivated", async () => {
    stubAudioGlobals();
    const { result, rerender } = renderHook(({ active }) => useMicLevel(active), {
      initialProps: { active: true },
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const ctx = FakeAudioContext.instances[0];

    rerender({ active: false });
    await act(async () => {
      await Promise.resolve();
    });

    expect(ctx.closed).toBe(true);
    expect(result.current.level).toBe(0);
  });
});

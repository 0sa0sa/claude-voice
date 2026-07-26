import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDictionary } from "./useDictionary";

const initial = [{ wrong: "混みっと", right: "コミット" }];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ entries: body.entries }), { status: 200 });
    }
    return new Response(JSON.stringify({ entries: initial }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useDictionary", () => {
  it("loads entries from the server on mount", async () => {
    const { result } = renderHook(() => useDictionary());
    await waitFor(() => expect(result.current.entries).toEqual(initial));
    expect(fetchMock).toHaveBeenCalledWith("/api/dictionary");
  });

  it("add() posts the appended list and updates state", async () => {
    const { result } = renderHook(() => useDictionary());
    await waitFor(() => expect(result.current.entries).toEqual(initial));
    await act(() => result.current.add("凛と", "リント"));
    expect(result.current.entries).toEqual([...initial, { wrong: "凛と", right: "リント" }]);
    const [, init] = fetchMock.mock.calls.at(-1)!;
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
  });

  it("remove() posts the list without the entry and updates state", async () => {
    const { result } = renderHook(() => useDictionary());
    await waitFor(() => expect(result.current.entries).toEqual(initial));
    await act(() => result.current.remove("混みっと"));
    expect(result.current.entries).toEqual([]);
  });

  it("keeps empty entries when the server is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useDictionary());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current.entries).toEqual([]);
  });
});

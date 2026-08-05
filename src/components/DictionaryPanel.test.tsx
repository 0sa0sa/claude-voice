import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DictionaryPanel } from "./DictionaryPanel";

const entries = [
  { wrong: "混みっと", right: "コミット" },
  { wrong: "凛と", right: "リント" },
];

describe("DictionaryPanel", () => {
  it("lists the registered entries", () => {
    render(<DictionaryPanel entries={entries} onAdd={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText("混みっと")).toBeInTheDocument();
    expect(screen.getByText("コミット")).toBeInTheDocument();
    expect(screen.getByText("凛と")).toBeInTheDocument();
  });

  it("shows an empty hint when there are no entries", () => {
    render(<DictionaryPanel entries={[]} onAdd={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText(/まだありません/)).toBeInTheDocument();
  });

  it("calls onRemove with the wrong reading when 削除 is clicked", async () => {
    const onRemove = vi.fn();
    render(<DictionaryPanel entries={entries} onAdd={vi.fn()} onRemove={onRemove} />);
    await userEvent.click(screen.getAllByRole("button", { name: /削除/ })[1]);
    expect(onRemove).toHaveBeenCalledWith("凛と");
  });

  it("calls onAdd with the typed pair and clears the inputs", async () => {
    const onAdd = vi.fn();
    render(<DictionaryPanel entries={[]} onAdd={onAdd} onRemove={vi.fn()} />);
    const wrong = screen.getByPlaceholderText("誤認識される読み");
    const right = screen.getByPlaceholderText("正しい表記");
    await userEvent.type(wrong, "毎時");
    await userEvent.type(right, "マージ");
    await userEvent.click(screen.getByRole("button", { name: "登録" }));
    expect(onAdd).toHaveBeenCalledWith("毎時", "マージ");
    expect(wrong).toHaveValue("");
    expect(right).toHaveValue("");
  });

  it("does not add when either field is blank", async () => {
    const onAdd = vi.fn();
    render(<DictionaryPanel entries={[]} onAdd={onAdd} onRemove={vi.fn()} />);
    await userEvent.type(screen.getByPlaceholderText("誤認識される読み"), "毎時");
    await userEvent.click(screen.getByRole("button", { name: "登録" }));
    expect(onAdd).not.toHaveBeenCalled();
  });
});

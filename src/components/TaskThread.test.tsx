import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TaskThread } from "./TaskThread";
import type { ThreadEntry } from "../lib/taskThread";

const entries: ThreadEntry[] = [
  { kind: "instruction", taskId: "a", seq: 1, text: "テストを回して", at: 1000 },
  { kind: "appended", taskId: "a", seq: 1, text: "READMEも更新して", at: 2000 },
  { kind: "result", taskId: "a", seq: 1, text: "全部通りました", at: 3000 },
  { kind: "instruction", taskId: "b", seq: 3, text: "続きでlintも直して", at: 4000 },
  { kind: "error", taskId: "b", seq: 3, text: "lintが落ちました", at: 5000 },
];

describe("TaskThread", () => {
  it("スレッド見出しに連番とプロジェクトを表示する", () => {
    render(<TaskThread seq={1} project="claude-voice" entries={entries} onClose={() => {}} />);
    const region = screen.getByRole("region", { name: "タスク #1 のスレッド" });
    expect(within(region).getByText(/claude-voice/)).toBeInTheDocument();
  });

  it("指示・追加指示・結果・追いタスク・エラーを時系列に種別ラベルつきで並べる", () => {
    render(<TaskThread seq={1} project="claude-voice" entries={entries} onClose={() => {}} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent("指示");
    expect(items[0]).toHaveTextContent("テストを回して");
    expect(items[1]).toHaveTextContent("追加指示");
    expect(items[1]).toHaveTextContent("READMEも更新して");
    expect(items[2]).toHaveTextContent("結果");
    expect(items[2]).toHaveTextContent("全部通りました");
    // 追いタスクのエントリは別タスクであることが連番で分かる
    expect(items[3]).toHaveTextContent("#3");
    expect(items[3]).toHaveTextContent("続きでlintも直して");
    expect(items[4]).toHaveTextContent("エラー");
    expect(items[4]).toHaveTextContent("lintが落ちました");
  });

  it("スレッド1本目のタスクのエントリには連番バッジを重ねて出さない", () => {
    render(<TaskThread seq={1} project="claude-voice" entries={entries} onClose={() => {}} />);
    const items = screen.getAllByRole("listitem");
    // 見出しが #1 を示しているので、同じタスクのエントリにまで #1 は付けない
    expect(within(items[0]).queryByText("#1")).not.toBeInTheDocument();
  });

  it("閉じるボタンでonCloseが呼ばれる", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<TaskThread seq={1} project="claude-voice" entries={entries} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "スレッドを閉じる" }));
    expect(onClose).toHaveBeenCalled();
  });
});

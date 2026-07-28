import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TaskProgress } from "./TaskProgress";

describe("TaskProgress", () => {
  it("直近のツール実行と最新出力の末尾を表示する", () => {
    render(
      <TaskProgress
        tools={["Edit: src/App.tsx", "Bash: npm test"]}
        tail="テストを実行しています…"
      />,
    );
    const region = screen.getByRole("group", { name: "途中経過" });
    const items = within(region).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Edit: src/App.tsx");
    expect(items[1]).toHaveTextContent("Bash: npm test");
    expect(within(region).getByText("テストを実行しています…")).toBeInTheDocument();
  });

  it("ツール実行だけでも出力だけでも表示できる", () => {
    const { rerender } = render(<TaskProgress tools={[]} tail="出力のみ" />);
    expect(screen.getByText("出力のみ")).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);

    rerender(<TaskProgress tools={["Bash: ls"]} tail="" />);
    expect(screen.getByText("Bash: ls")).toBeInTheDocument();
  });

  it("まだ何も届いていないときは待機中の表示を出す", () => {
    render(<TaskProgress tools={[]} tail="" />);
    expect(screen.getByText("出力を待っています…")).toBeInTheDocument();
  });
});

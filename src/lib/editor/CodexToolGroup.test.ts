import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import CodexToolGroup from "$lib/editor/CodexToolGroup.svelte";

describe("Codex tool group status", () => {
  afterEach(cleanup);

  it("shows a recovered tool failure as one yellow error", () => {
    const { container } = render(CodexToolGroup, {
      group: {
        id: "turn-fold:turn",
        turnId: "turn",
        status: "warning",
        summary: "Used 2 tools",
        items: [
          { id: "first", type: "mcpToolCall", tool: "extension_stage", status: "failed" },
          { id: "retry", type: "mcpToolCall", tool: "extension_stage", status: "completed" },
        ],
      },
      label: "Worked for 1m 20s",
    });

    expect(screen.getByText("Worked for 1m 20s")).toBeInTheDocument();
    expect(screen.getByText("1 error")).toHaveClass("warning");
    expect(container.querySelector(".warning-icon")).toBeInTheDocument();
  });
});

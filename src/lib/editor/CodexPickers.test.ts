import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import CodexModelPicker from "$lib/editor/CodexModelPicker.svelte";
import CodexTraitsPicker from "$lib/editor/CodexTraitsPicker.svelte";
import type { CodexModel } from "$lib/codex-protocol";

const models: CodexModel[] = [
  {
    id: "sol", model: "gpt-sol", displayName: "GPT Sol", description: "Flagship model",
    isDefault: true, defaultReasoningEffort: "low",
    supportedReasoningEfforts: [{ reasoningEffort: "low", description: "Fast" }, { reasoningEffort: "high", description: "Deeper" }],
    serviceTiers: [{ id: "fast", name: "Fast", description: "Lower latency" }],
  },
  {
    id: "terra", model: "gpt-terra", displayName: "GPT Terra", description: "Balanced model",
    isDefault: false, defaultReasoningEffort: "medium",
    supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
  },
];

afterEach(cleanup);

describe("Codex composer pickers", () => {
  it("shows a concise model list and selects a full row", async () => {
    const onSelect = vi.fn();
    render(CodexModelPicker, { models, selected: "gpt-sol", onSelect });
    await fireEvent.click(screen.getByRole("button", { name: /GPT Sol/ }));
    expect(screen.queryByText("Flagship model")).not.toBeInTheDocument();
    expect(screen.queryByText("gpt-sol")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Search models" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /favorite/i })).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole("option", { name: /GPT Terra/ }));
    expect(onSelect).toHaveBeenCalledWith("gpt-terra");
  });

  it("renders model-specific reasoning and service tier choices", async () => {
    const onChange = vi.fn();
    render(CodexTraitsPicker, {
      model: models[0],
      selection: { model: "gpt-sol", effort: "low", serviceTier: "default" },
      approvalMode: "ask",
      onChange,
      onApprovalModeChange: vi.fn(),
    });
    await fireEvent.click(screen.getByRole("button", { name: /Low/ }));
    expect(screen.queryByText("Deeper")).not.toBeInTheDocument();
    expect(screen.queryByText("Lower latency")).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: /High/ }));
    expect(onChange).toHaveBeenCalledWith({ model: "gpt-sol", effort: "high", serviceTier: "default" });
  });
});

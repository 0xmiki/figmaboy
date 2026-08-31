import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import MarkdownText from "$lib/editor/MarkdownText.svelte";

describe("MarkdownText inline skills", () => {
  afterEach(cleanup);

  it("renders a known skill where its marker appears but leaves code untouched", () => {
    render(MarkdownText, {
      text: "Use $first-principles-ui here and keep `$first-principles-ui` as code.",
      skills: ["first-principles-ui"],
    });
    const skill = screen.getByText("First Principles UI");
    expect(skill.closest("p")).toHaveTextContent("Use First Principles UI here and keep $first-principles-ui as code.");
    expect(screen.getByText("$first-principles-ui", { selector: "code" })).toBeInTheDocument();
    expect(skill.querySelector("svg")).toBeNull();
  });
});

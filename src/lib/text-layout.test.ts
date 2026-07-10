import { describe, expect, it } from "vitest";
import { defaultNode } from "$lib/domain";
import type { TextNode } from "$lib/domain";
import { layoutText, syncTextSize } from "$lib/text-layout";

const fixedMeasure = (text: string) => text.length * 10;

describe("text layout", () => {
  it("wraps fixed-width text at word boundaries", () => {
    const node = defaultNode("text", 0, 0, { text: "See how it wraps", width: 80, autoWidth: false }) as TextNode;
    const layout = layoutText(node, fixedMeasure);
    expect(layout.lines).toEqual(["See how", "it wraps"]);
    expect(layout.height).toBe(node.fontSize * node.lineHeight * 2);
  });

  it("breaks a word that is wider than the text box", () => {
    const node = defaultNode("text", 0, 0, { text: "overflow", width: 30, autoWidth: false }) as TextNode;
    expect(layoutText(node, fixedMeasure).lines).toEqual(["ove", "rfl", "ow"]);
  });

  it("keeps auto-width text on explicit lines and grows fixed text vertically", () => {
    const auto = defaultNode("text", 0, 0, { text: "one two", autoWidth: true }) as TextNode;
    expect(layoutText(auto, fixedMeasure).lines).toEqual(["one two"]);

    const fixed = defaultNode("text", 0, 0, { text: "one two three", width: 70, autoWidth: false }) as TextNode;
    const layout = syncTextSize(fixed, fixedMeasure);
    expect(fixed.height).toBe(layout.height);
    expect(fixed.height).toBeGreaterThan(fixed.fontSize * fixed.lineHeight);
  });
});

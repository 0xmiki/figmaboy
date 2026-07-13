import { describe, expect, it } from "vitest";
import { defaultNode, emptyDocument } from "$lib/domain";
import { canvasSelectionTarget, isCanvasNodeVisible } from "$lib/editor/canvas-selection";

function nestedDocument() {
  const document = emptyDocument();
  const frame = defaultNode("frame", 0, 0, { width: 500, height: 400 });
  const first = defaultNode("rectangle", 30, 40, { width: 100, height: 80, parentId: frame.id });
  const second = defaultNode("ellipse", 180, 40, { width: 100, height: 80, parentId: frame.id });
  if (frame.type !== "frame") throw new Error("expected a frame");
  frame.childIds = [first.id, second.id];
  document.nodes = { [frame.id]: frame, [first.id]: first, [second.id]: second };
  document.rootIds = [frame.id];
  return { document, frame, first, second };
}

describe("canvas selection depth", () => {
  it("selects a frame first, then drills into the hit child", () => {
    const { document, frame, first } = nestedDocument();
    expect(canvasSelectionTarget(document, first.id, [])).toBe(frame.id);
    expect(canvasSelectionTarget(document, first.id, [frame.id])).toBe(first.id);
  });

  it("keeps sibling selection inside an entered frame", () => {
    const { document, first, second } = nestedDocument();
    expect(canvasSelectionTarget(document, second.id, [first.id])).toBe(second.id);
  });

  it("skips nested frames on the second click but preserves groups as boundaries", () => {
    const { document, frame } = nestedDocument();
    const nestedFrame = defaultNode("frame", 20, 20, { width: 300, height: 240, parentId: frame.id });
    const group = defaultNode("group", 30, 30, { width: 160, height: 80, parentId: nestedFrame.id });
    const leaf = defaultNode("text", 10, 10, { width: 120, height: 30, parentId: group.id, text: "Button" });
    if (frame.type !== "frame" || nestedFrame.type !== "frame" || group.type !== "group") throw new Error("expected containers");
    frame.childIds = [nestedFrame.id];
    nestedFrame.childIds = [group.id];
    group.childIds = [leaf.id];
    Object.assign(document.nodes, { [nestedFrame.id]: nestedFrame, [group.id]: group, [leaf.id]: leaf });

    expect(canvasSelectionTarget(document, leaf.id, [])).toBe(frame.id);
    expect(canvasSelectionTarget(document, leaf.id, [frame.id])).toBe(group.id);
    expect(canvasSelectionTarget(document, leaf.id, [group.id])).toBe(leaf.id);
  });

  it("jumps directly to a leaf when nested frames contain no group", () => {
    const { document, frame } = nestedDocument();
    const nestedFrame = defaultNode("frame", 20, 20, { width: 300, height: 240, parentId: frame.id });
    const leaf = defaultNode("rectangle", 30, 30, { width: 120, height: 60, parentId: nestedFrame.id });
    if (frame.type !== "frame" || nestedFrame.type !== "frame") throw new Error("expected frames");
    frame.childIds = [nestedFrame.id];
    nestedFrame.childIds = [leaf.id];
    Object.assign(document.nodes, { [nestedFrame.id]: nestedFrame, [leaf.id]: leaf });

    expect(canvasSelectionTarget(document, leaf.id, [frame.id])).toBe(leaf.id);
  });

  it("stays inside an entered frame when moving between sibling button groups", () => {
    const { document, frame } = nestedDocument();
    const firstButton = defaultNode("group", 20, 20, { width: 120, height: 48, parentId: frame.id, name: "Button A" });
    const secondButton = defaultNode("group", 160, 20, { width: 120, height: 48, parentId: frame.id, name: "Button B" });
    const firstLabel = defaultNode("text", 10, 10, { width: 100, height: 24, parentId: firstButton.id, text: "First" });
    const secondLabel = defaultNode("text", 10, 10, { width: 100, height: 24, parentId: secondButton.id, text: "Second" });
    if (frame.type !== "frame" || firstButton.type !== "group" || secondButton.type !== "group") throw new Error("expected containers");
    frame.childIds = [firstButton.id, secondButton.id];
    firstButton.childIds = [firstLabel.id];
    secondButton.childIds = [secondLabel.id];
    Object.assign(document.nodes, {
      [firstButton.id]: firstButton, [secondButton.id]: secondButton,
      [firstLabel.id]: firstLabel, [secondLabel.id]: secondLabel,
    });

    expect(canvasSelectionTarget(document, firstLabel.id, [])).toBe(frame.id);
    expect(canvasSelectionTarget(document, firstLabel.id, [frame.id])).toBe(firstButton.id);
    expect(canvasSelectionTarget(document, secondLabel.id, [firstButton.id])).toBe(secondButton.id);
  });

  it("preserves layer-selection intent when moving into a different frame", () => {
    const { document, frame, first } = nestedDocument();
    const otherFrame = defaultNode("frame", 600, 0, { width: 400, height: 300 });
    const otherButton = defaultNode("group", 30, 30, { width: 140, height: 52, parentId: otherFrame.id, name: "Other button" });
    const otherLabel = defaultNode("text", 10, 10, { width: 120, height: 24, parentId: otherButton.id, text: "Other" });
    if (otherFrame.type !== "frame" || otherButton.type !== "group") throw new Error("expected containers");
    otherFrame.childIds = [otherButton.id];
    otherButton.childIds = [otherLabel.id];
    document.rootIds.push(otherFrame.id);
    Object.assign(document.nodes, { [otherFrame.id]: otherFrame, [otherButton.id]: otherButton, [otherLabel.id]: otherLabel });

    // No active layer means the outer frame is the first selection boundary.
    expect(canvasSelectionTarget(document, otherLabel.id, [])).toBe(otherFrame.id);
    // Once a nested child is active elsewhere, the next click targets the
    // meaningful layer directly instead of bouncing through the other frame.
    expect(first.parentId).toBe(frame.id);
    expect(canvasSelectionTarget(document, otherLabel.id, [first.id])).toBe(otherButton.id);
    // Clearing selection restores frame-first behavior.
    expect(canvasSelectionTarget(document, otherLabel.id, [])).toBe(otherFrame.id);
  });

  it("skips a locked frame but still selects its children", () => {
    const { document, frame, first } = nestedDocument();
    frame.locked = true;
    expect(canvasSelectionTarget(document, first.id, [])).toBe(first.id);
    expect(canvasSelectionTarget(document, frame.id, [])).toBeNull();
  });

  it("supports explicit deep selection and rejects hidden subtrees", () => {
    const { document, frame, first } = nestedDocument();
    expect(canvasSelectionTarget(document, first.id, [], true)).toBe(first.id);
    frame.visible = false;
    expect(isCanvasNodeVisible(document, first.id)).toBe(false);
    expect(canvasSelectionTarget(document, first.id, [])).toBeNull();
  });
});

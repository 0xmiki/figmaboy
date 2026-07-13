import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("creates a truly blank local design and draws a rectangle", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Recently viewed" })).toBeVisible();
  await page.getByRole("button", { name: "New design" }).first().click();
  await expect(page).toHaveURL(/\/editor\/file_/);
  await expect(page.getByText("No layers yet")).toBeVisible();
  await page.keyboard.press("r");
  const canvas = page.locator("#design-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("canvas was not rendered");

  // A click alone must not create a default-size shape.
  await page.mouse.click(bounds.x + 260, bounds.y + 180);
  await expect(page.getByText("No layers yet")).toBeVisible();

  await page.keyboard.press("r");
  await page.mouse.move(bounds.x + 300, bounds.y + 220);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 470, bounds.y + 340);
  await page.mouse.up();
  await expect(page.getByText("Rectangle", { exact: true }).first()).toBeVisible();

  const rectangleNode = canvas.locator("g[data-node-id]").first();
  await expect.poll(async () => (await rectangleNode.boundingBox())?.width).toBeCloseTo(170, 0);
  await expect.poll(async () => (await rectangleNode.boundingBox())?.height).toBeCloseTo(120, 0);
  const rectangle = rectangleNode.locator(":scope > g > path").first();

  const radius = page.getByRole("spinbutton", { name: "Corner radius", exact: true });
  await radius.fill("24");
  await radius.blur();
  await expect(rectangle).toHaveAttribute("d", /^M24,0/);
  await radius.focus();
  await page.keyboard.press("Delete");
  await expect(canvas.locator("g[data-node-id]")).toHaveCount(1);
  await radius.blur();

  // Other shape tools use the same drag-to-size interaction.
  await page.keyboard.press("o");
  await page.mouse.move(bounds.x + 530, bounds.y + 260);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 650, bounds.y + 350);
  await page.mouse.up();
  await expect(page.getByText("Ellipse", { exact: true }).first()).toBeVisible();
});

test("draws and Alt-drags layers inside an existing frame", async ({ page }) => {
  await page.getByRole("button", { name: "New design" }).first().click();
  const canvas = page.locator("#design-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("canvas was not rendered");

  await page.keyboard.press("f");
  await page.mouse.move(bounds.x + 280, bounds.y + 180);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 680, bounds.y + 520);
  await page.mouse.up();

  await page.keyboard.press("r");
  await page.mouse.move(bounds.x + 360, bounds.y + 260);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 520, bounds.y + 360);
  await page.mouse.up();

  const nestedNodes = canvas.locator("g[data-node-id] g[data-node-id]");
  await expect(nestedNodes).toHaveCount(1);

  const firstCardBounds = await nestedNodes.first().boundingBox();
  if (!firstCardBounds) throw new Error("nested rectangle was not rendered");
  await page.keyboard.press("o");
  await page.mouse.move(firstCardBounds.x + 20, firstCardBounds.y + 15);
  await page.mouse.down();
  await page.mouse.move(firstCardBounds.x + 100, firstCardBounds.y + 75);
  await page.mouse.up();
  await expect(nestedNodes).toHaveCount(2);

  const cardBounds = await nestedNodes.last().boundingBox();
  if (!cardBounds) throw new Error("nested rectangle was not rendered");
  await page.keyboard.down("Alt");
  await page.mouse.move(cardBounds.x + cardBounds.width / 2, cardBounds.y + cardBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(cardBounds.x + cardBounds.width / 2 + 90, cardBounds.y + cardBounds.height / 2 + 45);
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect(nestedNodes).toHaveCount(3);
});

test("selects and drags a frame before drilling into children, and marquees through a locked frame", async ({ page }) => {
  await page.getByRole("button", { name: "New design" }).first().click();
  const canvas = page.locator("#design-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("canvas was not rendered");

  await page.keyboard.press("f");
  await page.mouse.move(bounds.x + 280, bounds.y + 180);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 720, bounds.y + 560);
  await page.mouse.up();
  await page.keyboard.press("r");
  await page.mouse.move(bounds.x + 370, bounds.y + 270);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 510, bounds.y + 360);
  await page.mouse.up();

  const frame = canvas.locator("g.world > g[data-node-id]").first();
  const child = frame.locator("g[data-node-id]").first();
  await page.mouse.click(bounds.x + 900, bounds.y + 700);
  const frameTransformBefore = await frame.getAttribute("transform");
  const childTransformBefore = await child.getAttribute("transform");
  const childBoundsBefore = await child.boundingBox();
  if (!childBoundsBefore) throw new Error("frame child was not rendered");

  // Even though the pointer is over the child, the first drag owns the frame.
  await page.mouse.move(childBoundsBefore.x + childBoundsBefore.width / 2, childBoundsBefore.y + childBoundsBefore.height / 2);
  await page.mouse.down();
  await page.mouse.move(childBoundsBefore.x + childBoundsBefore.width / 2 + 60, childBoundsBefore.y + childBoundsBefore.height / 2 + 40);
  await page.mouse.up();
  await expect(frame).not.toHaveAttribute("transform", frameTransformBefore!);
  await expect(frame).toHaveClass(/selected/);
  await expect(child).toHaveAttribute("transform", childTransformBefore!);

  // A click with the frame already selected drills exactly one level inward.
  const movedChildBounds = await child.boundingBox();
  if (!movedChildBounds) throw new Error("moved frame child was not rendered");
  await page.mouse.click(movedChildBounds.x + movedChildBounds.width / 2, movedChildBounds.y + movedChildBounds.height / 2);
  await expect(child).toHaveClass(/selected/);
  await expect(frame).not.toHaveClass(/selected/);

  // Locking the parent turns its empty surface into marquee-starting canvas,
  // while the unlocked child remains selectable.
  const frameRow = page.getByRole("treeitem").filter({ hasText: "Frame" }).first();
  await frameRow.getByRole("button", { name: "Lock" }).click();
  const movedFrameBounds = await frame.boundingBox();
  if (!movedFrameBounds) throw new Error("moved frame was not rendered");
  await page.mouse.move(movedFrameBounds.x + movedFrameBounds.width - 20, movedFrameBounds.y + movedFrameBounds.height - 20);
  await page.mouse.down();
  await page.mouse.move(movedChildBounds.x - 15, movedChildBounds.y - 15);
  await expect(canvas).toHaveAttribute("data-mode", "marquee");
  await page.mouse.up();
  await expect(child).toHaveClass(/selected/);
  await expect(frame).not.toHaveClass(/selected/);
});

test("does not move a grouped layer when a click has minor pointer jitter", async ({ page }) => {
  await page.getByRole("button", { name: "New design" }).first().click();
  const canvas = page.locator("#design-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("canvas was not rendered");

  await page.keyboard.press("r");
  await page.mouse.move(bounds.x + 300, bounds.y + 220);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 440, bounds.y + 320);
  await page.mouse.up();
  await page.keyboard.press("o");
  await page.mouse.move(bounds.x + 470, bounds.y + 240);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 570, bounds.y + 330);
  await page.mouse.up();

  await page.keyboard.press("Control+A");
  await page.keyboard.press("Control+G");
  const group = canvas.locator("g.world > g[data-node-id]").first();
  const renderedNodes = canvas.locator("g[data-node-id]");
  const before = await renderedNodes.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("transform")));
  const groupBounds = await group.boundingBox();
  if (!groupBounds) throw new Error("group was not rendered");

  await page.mouse.move(groupBounds.x + 20, groupBounds.y + 20);
  await page.mouse.down();
  await page.mouse.move(groupBounds.x + 22, groupBounds.y + 21);
  await page.mouse.up();

  await expect.poll(() => renderedNodes.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("transform")))).toEqual(before);
});

test("marquee-selects in either direction and modifier-click removes one item", async ({ page }) => {
  await page.getByRole("button", { name: "New design" }).first().click();
  const canvas = page.locator("#design-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("canvas was not rendered");

  for (const [x1, y1, x2, y2] of [[350, 250, 430, 310], [500, 270, 585, 345]]) {
    await page.keyboard.press("r");
    await page.mouse.move(bounds.x + x1, bounds.y + y1);
    await page.mouse.down();
    await page.mouse.move(bounds.x + x2, bounds.y + y2);
    await page.mouse.up();
  }
  await page.mouse.move(bounds.x + 650, bounds.y + 430);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 300, bounds.y + 200);
  await page.mouse.up();
  await expect(canvas.locator("g[data-node-id].selected")).toHaveCount(2);

  const first = canvas.locator("g[data-node-id]").first();
  const firstBounds = await first.boundingBox();
  if (!firstBounds) throw new Error("rectangle was not rendered");
  await page.keyboard.down("Shift");
  await page.mouse.click(firstBounds.x + firstBounds.width / 2, firstBounds.y + firstBounds.height / 2);
  await page.keyboard.up("Shift");
  await expect(canvas.locator("g[data-node-id].selected")).toHaveCount(1);
});

test("marquee selection crosses text without starting a native text drag", async ({ page }) => {
  await page.getByRole("button", { name: "New design" }).first().click();
  const canvas = page.locator("#design-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("canvas was not rendered");

  await page.keyboard.press("t");
  await page.mouse.click(bounds.x + 430, bounds.y + 300);
  await page.keyboard.type("Selectable label");
  await page.keyboard.press("Control+Enter");
  const textNode = canvas.locator("g[data-node-id]").first();
  const textBounds = await textNode.boundingBox();
  if (!textBounds) throw new Error("text was not rendered");
  await page.mouse.click(bounds.x + 800, bounds.y + 650);

  await page.mouse.move(textBounds.x + textBounds.width + 35, textBounds.y + textBounds.height + 35);
  await page.mouse.down();
  await page.mouse.move(textBounds.x - 35, textBounds.y - 35, { steps: 5 });
  await expect(canvas).toHaveAttribute("data-mode", "marquee");
  await expect(canvas.locator(".marquee")).toHaveCSS("pointer-events", "none");
  await page.mouse.up();

  await expect(textNode).toHaveClass(/selected/);
  await expect.poll(() => page.evaluate(() => getSelection()?.toString() ?? "")).toBe("");
});

test("cancels a drag with Escape without adding a history entry", async ({ page }) => {
  await page.getByRole("button", { name: "New design" }).first().click();
  const canvas = page.locator("#design-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("canvas was not rendered");
  await page.keyboard.press("r");
  await page.mouse.move(bounds.x + 360, bounds.y + 250);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 480, bounds.y + 340);
  await page.mouse.up();
  const node = canvas.locator("g[data-node-id]").first();
  const before = await node.getAttribute("transform");
  const nodeBounds = await node.boundingBox();
  if (!nodeBounds) throw new Error("rectangle was not rendered");

  await page.mouse.move(nodeBounds.x + 30, nodeBounds.y + 30);
  await page.mouse.down();
  await page.mouse.move(nodeBounds.x + 130, nodeBounds.y + 80);
  await expect(canvas).toHaveAttribute("data-mode", "move");
  await expect(canvas).toHaveAttribute("data-gesture", "active");
  await page.keyboard.press("Escape");
  await expect(canvas).toHaveAttribute("data-mode", "idle");
  await expect(canvas).toHaveAttribute("data-gesture", "none");
  await expect(node).toHaveAttribute("transform", before!);
  await page.mouse.up();
  await expect(node).toHaveAttribute("transform", before!);

  await page.keyboard.press("Control+Z");
  await expect(canvas.locator("g[data-node-id]")).toHaveCount(0);
});

test("rotates as one undoable transform and preserves the selection", async ({ page }) => {
  await page.getByRole("button", { name: "New design" }).first().click();
  const canvas = page.locator("#design-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("canvas was not rendered");
  await page.keyboard.press("r");
  await page.mouse.move(bounds.x + 380, bounds.y + 270);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 520, bounds.y + 360);
  await page.mouse.up();
  const node = canvas.locator("g[data-node-id]").first();
  const nodeBounds = await node.boundingBox();
  const rotate = canvas.getByRole("button", { name: "Rotate selection" });
  const rotateBounds = await rotate.boundingBox();
  if (!nodeBounds || !rotateBounds) throw new Error("rotation controls were not rendered");

  await page.mouse.move(rotateBounds.x + rotateBounds.width / 2, rotateBounds.y + rotateBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(nodeBounds.x + nodeBounds.width + 30, nodeBounds.y + nodeBounds.height / 2);
  await page.mouse.up();
  await expect(node).toHaveAttribute("transform", /rotate\((?!0(?:\s|\)))/);
  await expect(canvas.locator("g[data-node-id].selected")).toHaveCount(1);
  await page.keyboard.press("Control+Z");
  await expect(node).toHaveAttribute("transform", /rotate\(0 /);
});

test("pans with Space without moving objects and supports copy, paste, delete, and undo", async ({ page }) => {
  await page.getByRole("button", { name: "New design" }).first().click();
  const canvas = page.locator("#design-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("canvas was not rendered");
  await page.keyboard.press("r");
  await page.mouse.move(bounds.x + 380, bounds.y + 270);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 500, bounds.y + 350);
  await page.mouse.up();
  const node = canvas.locator("g[data-node-id]").first();
  const nodeTransform = await node.getAttribute("transform");
  const world = canvas.locator("g.world");
  const worldBefore = await world.getAttribute("style");

  await page.keyboard.down("Space");
  await page.mouse.move(bounds.x + 700, bounds.y + 500);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 760, bounds.y + 550);
  await page.mouse.up();
  await page.keyboard.up("Space");
  await expect(world).not.toHaveAttribute("style", worldBefore!);
  await expect(node).toHaveAttribute("transform", nodeTransform!);

  await page.keyboard.press("Control+C");
  await page.keyboard.press("Control+V");
  await expect(canvas.locator("g[data-node-id]")).toHaveCount(2);
  await page.keyboard.press("Delete");
  await expect(canvas.locator("g[data-node-id]")).toHaveCount(1);
  await page.keyboard.press("Control+Z");
  await expect(canvas.locator("g[data-node-id]")).toHaveCount(2);
});

test("zooms around a trackpad pinch position", async ({ page }) => {
  await page.getByRole("button", { name: "New design" }).first().click();
  const canvas = page.locator("#design-canvas");
  const before = await page.locator(".toolbar .zoom").textContent();
  await canvas.dispatchEvent("wheel", { deltaY: -120, ctrlKey: true, clientX: 500, clientY: 350 });
  await expect(page.locator(".toolbar .zoom")).not.toHaveText(before ?? "100%");
  const world = canvas.locator("g.world");
  await expect(world).not.toHaveAttribute("transform");
  await expect(world).toHaveCSS("will-change", "transform");
  await expect(world).toHaveAttribute("style", /transform: translate3d\(.+px, .+px, 0(?:px)?\) scale\(.+\)/);
});

test("creates, types, places the caret, and re-edits text", async ({ page }) => {
  await page.getByRole("button", { name: "New design" }).first().click();
  const canvas = page.locator("#design-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("canvas was not rendered");

  await page.keyboard.press("t");
  await page.mouse.click(bounds.x + 380, bounds.y + 260);
  const editor = page.getByRole("textbox", { name: "Edit text" });
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue("");

  await page.keyboard.type("Hello");
  await editor.click({ position: { x: 20, y: 12 } });
  await expect(editor).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.type(" world");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second line");
  await expect(editor).toHaveValue("Hello world\nSecond line");
  const editorBounds = await editor.boundingBox();
  expect(editorBounds?.height).toBeGreaterThan(40);

  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
  const textNode = canvas.locator("g[data-node-id]").first();
  const renderedText = textNode.locator("text");
  await expect(renderedText).toContainText("Hello world");
  await expect(renderedText).toHaveAttribute("fill", "#18181b");
  const typographySelect = page.locator(".typography select").first();
  const selectStyle = await typographySelect.evaluate((element) => {
    const style = getComputedStyle(element);
    return { appearance: style.appearance, backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage, color: style.color };
  });
  expect(selectStyle.appearance).toBe("none");
  expect(selectStyle.backgroundColor).toBe("rgb(53, 53, 53)");
  expect(selectStyle.backgroundImage).not.toBe("none");
  expect(selectStyle.color).toBe("rgb(238, 238, 238)");

  await textNode.dblclick();
  await expect(editor).toBeFocused();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Edited text");
  await page.keyboard.press("Escape");
  await expect(renderedText).toContainText("Edited text");
});

test("resizes a frame child in place and reparents it when dragged outside", async ({ page }) => {
  await page.getByRole("button", { name: "New design" }).first().click();
  const canvas = page.locator("#design-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("canvas was not rendered");

  await page.keyboard.press("f");
  await page.mouse.move(bounds.x + 260, bounds.y + 160);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 700, bounds.y + 540);
  await page.mouse.up();
  await page.keyboard.press("r");
  await page.mouse.move(bounds.x + 340, bounds.y + 240);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 500, bounds.y + 340);
  await page.mouse.up();

  const child = canvas.locator("g[data-node-id] g[data-node-id]").first();
  const before = await child.boundingBox();
  const handle = canvas.getByRole("button", { name: "Resize se" });
  const handleBounds = await handle.boundingBox();
  if (!before || !handleBounds) throw new Error("child resize controls were not rendered");
  await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBounds.x + handleBounds.width / 2 + 70, handleBounds.y + handleBounds.height / 2 + 45);
  await page.mouse.up();

  const resized = await child.boundingBox();
  if (!resized) throw new Error("resized child was not rendered");
  expect(Math.abs(resized.x - before.x)).toBeLessThan(2);
  expect(Math.abs(resized.y - before.y)).toBeLessThan(2);
  expect(resized.width).toBeGreaterThan(before.width + 60);
  expect(resized.height).toBeGreaterThan(before.height + 35);

  const frameNode = canvas.locator("g.world > g[data-node-id]").first();
  const frameBounds = await frameNode.boundingBox();
  const frameClipGroup = frameNode.locator(":scope > g").last();
  if (!frameBounds) throw new Error("frame was not rendered");

  await page.mouse.move(resized.x + resized.width / 2, resized.y + resized.height / 2);
  await page.mouse.down();
  await page.mouse.move(frameBounds.x + frameBounds.width + 20, resized.y + resized.height / 2);
  await expect(frameClipGroup).toHaveAttribute("clip-path", /clip-/);

  await page.mouse.move(frameBounds.x + frameBounds.width + resized.width / 2 + 25, resized.y + resized.height / 2);
  await expect(frameClipGroup).not.toHaveAttribute("clip-path", /clip-/);
  await page.mouse.up();

  await expect(canvas.locator("g.world > g[data-node-id]")).toHaveCount(2);
  await expect(canvas.locator("g[data-node-id] g[data-node-id]")).toHaveCount(0);
});

test("creates and opens a project", async ({ page }) => {
  await page.getByTitle("New project").click();
  await page.getByPlaceholder("Project name").fill("Design system");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: "Design system" })).toBeVisible();
  await page.getByRole("button", { name: "New design" }).first().click();
  await expect(page).toHaveURL(/\/editor\/file_/);
});

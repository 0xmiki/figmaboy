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

  const rectangle = page.locator("[data-node-id] > g > rect").first();
  await expect(rectangle).toHaveAttribute("width", "170");
  await expect(rectangle).toHaveAttribute("height", "120");

  const radius = page.getByRole("spinbutton", { name: "Corner radius", exact: true });
  await radius.fill("24");
  await radius.blur();
  await expect(rectangle).toHaveAttribute("rx", "24");

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

test("zooms around a trackpad pinch position", async ({ page }) => {
  await page.getByRole("button", { name: "New design" }).first().click();
  const canvas = page.locator("#design-canvas");
  const before = await page.locator(".toolbar .zoom").textContent();
  await canvas.dispatchEvent("wheel", { deltaY: -120, ctrlKey: true, clientX: 500, clientY: 350 });
  await expect(page.locator(".toolbar .zoom")).not.toHaveText(before ?? "100%");
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

import { expect, test, type Page } from "@playwright/test";

async function showDesignInspector(page: Page) {
  const tab = page.getByRole("tab", { name: "Design", exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("opens the Codex chat sidebar and returns to the design inspector", async ({ page }) => {
  await page.getByRole("button", { name: "New design" }).first().click();
  await expect(page.getByRole("tab", { name: "Codex", exact: true })).toHaveAttribute("aria-selected", "true");
  await showDesignInspector(page);
  const inspector = page.locator("aside.inspector");
  const sharedSidebar = page.getByRole("complementary", { name: "Right sidebar" });
  await expect(inspector).toBeVisible();
  await expect(sharedSidebar).toHaveCSS("width", "390px");

  const resize = async (name: string, deltaX: number) => {
    const handle = page.getByRole("separator", { name });
    const bounds = await handle.boundingBox();
    if (!bounds) throw new Error(`${name} handle was not rendered`);
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + Math.min(160, bounds.height / 2);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + deltaX, y, { steps: 4 });
    await page.mouse.up();
  };

  await resize("Resize left sidebar", 40);
  await expect(page.locator("aside.left-shell")).toHaveCSS("width", "337px");
  await resize("Resize right sidebar", -40);
  await expect(sharedSidebar).toHaveCSS("width", "430px");

  await page.evaluate(() => {
    let callbackId = 1;
    const callbacks = new Map<number, (...args: unknown[]) => unknown>();
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      transformCallback(callback: (...args: unknown[]) => unknown) {
        const id = callbackId++;
        callbacks.set(id, callback);
        return id;
      },
      unregisterCallback(id: number) {
        callbacks.delete(id);
      },
      async invoke(command: string, args?: Record<string, unknown>) {
        if (command === "plugin:event|listen") return callbackId++;
        if (command === "codex_ui_state_read") return null;
        if (command === "codex_connect") return { workspaceId: "file", cwd: "/tmp/figmaboy", reused: false };
        if (command !== "codex_request") return null;
        if (args?.method === "account/read") return { account: { type: "chatgpt" } };
        if (args?.method === "model/list") return { data: [
          { id: "gpt-test", model: "gpt-test", displayName: "GPT Test", description: "This description should stay hidden", isDefault: true, hidden: false, supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Balanced reasoning" }, { reasoningEffort: "high", description: "Deeper reasoning" }], defaultReasoningEffort: "medium", serviceTiers: [{ id: "default", name: "Standard", description: "Normal speed" }, { id: "fast", name: "Fast", description: "Lower latency" }] },
          { id: "gpt-small", model: "gpt-small", displayName: "GPT Small", description: "Another hidden description", isDefault: false, hidden: false, supportedReasoningEfforts: [{ reasoningEffort: "low" }], defaultReasoningEffort: "low" },
        ] };
        if (args?.method === "thread/list") return { data: [] };
        if (args?.method === "skills/list") return { data: [] };
        return {};
      },
    };
  });

  await page.getByRole("tab", { name: "Codex", exact: true }).click();
  const sidebar = page.getByRole("complementary", { name: "Codex chat" });
  await expect(sidebar).toBeVisible();
  const reconnect = sidebar.getByRole("button", { name: "Reconnect" });
  if (await reconnect.isVisible()) await reconnect.click();
  await expect(inspector).toBeHidden();
  await expect(sidebar.getByPlaceholder("Ask anything about this design")).toBeVisible();
  await expect(sidebar.getByText("Design with Codex")).toHaveCount(0);
  await expect(sidebar.getByText("Review the design")).toHaveCount(0);
  await expect(sidebar.locator(".empty-glyph")).toHaveCount(0);
  const insideSidebar = async (locator: typeof sidebar) => {
    const sidebarBox = await sidebar.boundingBox();
    const popupBox = await locator.boundingBox();
    if (!sidebarBox || !popupBox) throw new Error("Picker bounds were unavailable");
    expect(popupBox.x).toBeGreaterThanOrEqual(sidebarBox.x);
    expect(popupBox.x + popupBox.width).toBeLessThanOrEqual(sidebarBox.x + sidebarBox.width);
  };
  await sidebar.getByRole("button", { name: /GPT Test/ }).click();
  const modelPopup = sidebar.getByRole("region", { name: "Choose a Codex model" });
  await expect(modelPopup).toBeVisible();
  await expect(modelPopup.getByText("This description should stay hidden")).toHaveCount(0);
  await expect(modelPopup.getByRole("textbox", { name: "Search models" })).toHaveCount(0);
  await expect(modelPopup.getByRole("button", { name: /favorite/i })).toHaveCount(0);
  await insideSidebar(modelPopup);
  await page.keyboard.press("Escape");
  await sidebar.getByTitle("Model settings").click();
  const traitsPopup = sidebar.getByRole("region", { name: "Codex model settings" });
  await expect(traitsPopup).toBeVisible();
  await expect(traitsPopup.getByText("Balanced reasoning")).toHaveCount(0);
  await insideSidebar(traitsPopup);
  await sidebar.getByTitle("Model settings").click();
  await resize("Resize right sidebar", -50);
  await expect(sharedSidebar).toHaveCSS("width", "480px");
  await expect(page.locator(".canvas-region")).toHaveCSS("right", "480px");

  await page.reload();
  await expect(page.getByRole("complementary", { name: "Codex chat" })).toBeVisible();
  await expect(page.locator(".canvas-region")).toHaveCSS("right", "480px");

  await page.getByRole("complementary", { name: "Codex chat" }).getByTitle("Close Codex").click();
  await expect(page.getByRole("complementary", { name: "Codex chat" })).toBeHidden();
  await expect(page.locator("aside.inspector")).toBeVisible();
  await expect(sharedSidebar).toHaveCSS("width", "480px");
  await expect(page.locator(".canvas-region")).toHaveCSS("right", "480px");
});

test("copies a stable design ID for MCP lookup", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "New design" }).first().click();
  await expect(page).toHaveURL(/\/editor\/file_/);
  const fileId = new URL(page.url()).pathname.split("/").at(-1);
  if (!fileId) throw new Error("The design URL did not contain a file ID");

  await page.getByRole("button", { name: "Copy design ID", exact: true }).click();
  await expect(page.getByText(`Copied design ID: ${fileId}`)).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(fileId);

  await page.getByRole("button", { name: "Back to projects" }).click();
  await page.getByRole("button", { name: "Actions for Untitled", exact: true }).click();
  await page.getByRole("button", { name: "Copy design ID" }).click();

  await expect(page.getByText(`Copied design ID: ${fileId}`)).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(fileId);
});

test("creates a truly blank local design and draws a rectangle", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Recently viewed" })).toBeVisible();
  await page.getByRole("button", { name: "New design" }).first().click();
  await showDesignInspector(page);
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

test("runs an extension canvas action immediately as one undoable change", async ({ page }) => {
  const manifest = {
    format: "figmaboy-extension",
    apiVersion: 1,
    id: "tests.card-maker",
    name: "Card maker",
    version: "1.0.0",
    permissions: ["ui.sidebar", "design.read", "design.write"],
    contributes: { sidebar: [{ id: "cards", title: "Cards", controls: [{
      type: "button", id: "create", label: "Create card", variant: "primary",
      action: { type: "design.transact", label: "Create card", selectCreated: true, operations: [{ kind: "create", node: { id: "extension-card", type: "frame", name: "Extension card", x: 100, y: 100, width: 320, height: 180, radius: 20 } }] },
    }] }] },
  };
  await page.evaluate((extension) => localStorage.setItem("figmaboy.extensions.v1", JSON.stringify({
    manifests: { release: extension },
    records: [{ id: extension.id, name: extension.name, enabled: true, activeHash: "release", previewHash: null, active: extension, preview: null, versions: [{ hash: "release", version: extension.version, createdAt: new Date(0).toISOString(), status: "release" }] }],
  })), manifest);
  await page.getByRole("button", { name: "New design" }).first().click();
  await showDesignInspector(page);

  await page.getByTitle("Extensions").click();
  await expect(page.getByText("Cards", { exact: true })).toBeVisible();
  await expect(page.locator("aside.inspector")).toBeVisible();
  await expect(page.getByTitle("Toggle extensions")).toHaveCount(0);
  await page.getByRole("button", { name: "Create card" }).click();
  await expect(page.locator("#design-canvas g[data-node-id='extension-card']")).toBeVisible();
  await expect(page.getByText("Canvas preview", { exact: true })).toHaveCount(0);

  await page.keyboard.press("Control+z");
  await expect(page.locator("#design-canvas g[data-node-id='extension-card']")).toHaveCount(0);
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

test("selects a parent, double-clicks down one level, and respects a locked subtree", async ({ page }) => {
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
  await page.mouse.click(bounds.x + bounds.width - 24, bounds.y + bounds.height - 24);
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

  // Figma descends one level on double-click, not on an ordinary click.
  const movedChildBounds = await child.boundingBox();
  if (!movedChildBounds) throw new Error("moved frame child was not rendered");
  await page.mouse.click(movedChildBounds.x + movedChildBounds.width / 2, movedChildBounds.y + movedChildBounds.height / 2);
  await expect(frame).toHaveClass(/selected/);
  await expect(child).not.toHaveClass(/selected/);
  await page.waitForTimeout(550);
  await page.mouse.dblclick(movedChildBounds.x + movedChildBounds.width / 2, movedChildBounds.y + movedChildBounds.height / 2);
  await expect(child).toHaveClass(/selected/);
  await expect(frame).not.toHaveClass(/selected/);

  // Locking a parent also makes its descendants unavailable to canvas
  // selection. The Layers panel can still select and unlock them.
  const frameRow = page.getByRole("treeitem").filter({ hasText: "Frame" }).first();
  await frameRow.getByRole("button", { name: "Lock" }).click();
  await page.mouse.move(bounds.x + bounds.width - 24, bounds.y + bounds.height - 24);
  await page.mouse.down();
  await page.mouse.move(movedChildBounds.x - 15, movedChildBounds.y - 15);
  await expect(canvas).toHaveAttribute("data-mode", "marquee");
  await page.mouse.up();
  await expect(child).not.toHaveClass(/selected/);
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
  const viewportLayer = canvas.locator("svg.viewport-layer");
  const viewportBefore = await viewportLayer.getAttribute("style");

  await page.keyboard.down("Space");
  await page.mouse.move(bounds.x + 700, bounds.y + 500);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 760, bounds.y + 550);
  await page.mouse.up();
  await page.keyboard.up("Space");
  await expect(viewportLayer).not.toHaveAttribute("style", viewportBefore!);
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
  const viewportLayer = canvas.locator("svg.viewport-layer");
  await expect(canvas.locator("g.world")).not.toHaveAttribute("transform");
  await expect(viewportLayer).toHaveCSS("will-change", "transform");
  await expect(viewportLayer).toHaveAttribute("style", /transform: translate3d\(.+px, .+px, 0(?:px)?\) scale\(.+\)/);
});

test("mounts destination nodes before a fast wheel pan can expose a blank canvas", async ({ page }) => {
  await page.getByRole("button", { name: "New design" }).first().click();
  await expect(page).toHaveURL(/\/editor\/file_/);
  const editorUrl = page.url();
  const fileId = new URL(editorUrl).pathname.split("/").at(-1);
  if (!fileId) throw new Error("The design URL did not contain a file ID");
  await page.getByRole("button", { name: "Back to projects" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.evaluate((activeFileId) => {
    const key = "figmaboy.workspace.v1";
    const state = JSON.parse(localStorage.getItem(key) ?? "{}");
    const activePage = state.pages.find((candidate: { fileId?: string }) => candidate.fileId === activeFileId);
    if (!activePage) throw new Error("The design page was not found");
    const rootIds: string[] = [];
    const nodes: Record<string, unknown> = {};
    for (let index = 0; index < 400; index += 1) {
      const id = `cull-node-${index}`;
      rootIds.push(id);
      nodes[id] = {
        id, type: "rectangle", name: `Cull node ${index}`,
        x: 80, y: index * 180, width: 220, height: 120,
        fill: { type: "solid", color: index % 2 ? "#f97316" : "#2563eb", opacity: 1 },
      };
    }
    state.documents[activePage.id] = { schemaVersion: 1, rootIds, nodes, viewport: { x: 0, y: 0, zoom: 1 }, prototypeStartFrameId: null };
    localStorage.setItem(key, JSON.stringify(state));
  }, fileId);
  await page.goto(editorUrl);

  const canvas = page.locator("#design-canvas");
  const origin = canvas.locator("g[data-node-id='cull-node-1']");
  await expect(origin).toBeVisible();
  const waitForTwoFrames = () => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

  await canvas.dispatchEvent("wheel", { deltaY: 3_000, deltaX: 0, deltaMode: 0, clientX: 500, clientY: 400 });
  await waitForTwoFrames();
  const destination = canvas.locator("g[data-node-id='cull-node-17']");
  expect(await destination.count()).toBe(1);
  const canvasBounds = await canvas.boundingBox();
  const destinationBounds = await destination.boundingBox();
  if (!canvasBounds || !destinationBounds) throw new Error("The fast-pan destination was not rendered");
  expect(destinationBounds.y).toBeGreaterThanOrEqual(canvasBounds.y);
  expect(destinationBounds.y).toBeLessThan(canvasBounds.y + canvasBounds.height);
  expect(await canvas.locator("g[data-node-id]").count()).toBeLessThan(80);

  await canvas.dispatchEvent("wheel", { deltaY: -3_000, deltaX: 0, deltaMode: 0, clientX: 500, clientY: 400 });
  await waitForTwoFrames();
  expect(await origin.count()).toBe(1);
  const originBounds = await origin.boundingBox();
  if (!originBounds) throw new Error("The origin did not remount after reversing the fast pan");
  expect(originBounds.y).toBeGreaterThanOrEqual(canvasBounds.y);
  expect(originBounds.y).toBeLessThan(canvasBounds.y + canvasBounds.height);
});

test("creates, types, places the caret, and re-edits text", async ({ page }) => {
  await page.getByRole("button", { name: "New design" }).first().click();
  await showDesignInspector(page);
  const canvas = page.locator("#design-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("canvas was not rendered");

  await page.keyboard.press("t");
  await page.mouse.click(bounds.x + 380, bounds.y + 260);
  const editor = page.getByRole("textbox", { name: "Edit text" });
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue("");

  await page.keyboard.type("Hello");
  const textNode = canvas.locator("g[data-node-id]").first();
  await expect(textNode.locator("text")).toContainText("Hello");
  await expect(editor).toHaveCSS("color", "rgba(0, 0, 0, 0)");
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

  await page.getByRole("combobox", { name: "Text case" }).selectOption("upper");
  await expect(renderedText).toContainText("HELLO WORLD");
  const beforeReedit = await renderedText.boundingBox();
  await textNode.dblclick();
  await expect(editor).toBeFocused();
  await expect(editor).toHaveCSS("text-transform", "uppercase");
  await expect(renderedText).toContainText("HELLO WORLD");
  const duringReedit = await renderedText.boundingBox();
  expect(duringReedit?.x).toBeCloseTo(beforeReedit?.x ?? 0, 1);
  expect(duringReedit?.y).toBeCloseTo(beforeReedit?.y ?? 0, 1);
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Edited text");
  await page.keyboard.press("Escape");
  await expect(renderedText).toContainText("EDITED TEXT");
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

test("keeps projects and standalone designs together on the home screen", async ({ page }) => {
  await page.getByRole("button", { name: "New design" }).first().click();
  await page.getByRole("button", { name: "Back to projects" }).click();

  await page.getByRole("button", { name: "New project", exact: true }).last().click();
  await page.getByPlaceholder("Project name").fill("Design system");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: "Design system" })).toBeVisible();
  await page.getByRole("button", { name: "New design" }).first().click();
  await expect(page).toHaveURL(/\/editor\/file_/);
  await page.getByRole("button", { name: "Back to projects" }).click();

  await expect(page.getByRole("heading", { name: "Recently viewed" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Designs", exact: true })).toBeVisible();
  await expect(page.locator(".project-card").filter({ hasText: "Design system" })).toBeVisible();
  await expect(page.locator(".file-card").filter({ hasText: "Drafts" })).toHaveCount(1);
  await expect(page.locator(".file-card").filter({ hasText: "Design system" })).toHaveCount(1);

  const projectGroup = await page.locator(".project-group").boundingBox();
  const designGroup = await page.locator(".design-group").boundingBox();
  if (!projectGroup || !designGroup) throw new Error("Home sections were not rendered");
  expect(designGroup.y).toBeGreaterThan(projectGroup.y + projectGroup.height + 25);

  await page.locator(".project-card").filter({ hasText: "Design system" }).click();
  await expect(page.getByRole("heading", { name: "Design system" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Designs", exact: true })).toBeVisible();
  await expect(page.locator(".file-card")).toHaveCount(1);

  await page.getByRole("button", { name: "Drafts", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Drafts", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Designs", exact: true })).toBeVisible();
  await expect(page.locator(".file-card")).toHaveCount(1);

  await page.getByRole("button", { name: "Starred", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Starred", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nothing here yet" })).toBeVisible();

  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Trash is empty" })).toBeVisible();

  await page.getByRole("button", { name: "All projects", exact: true }).click();
  await expect(page.getByRole("heading", { name: "All projects", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Designs", exact: true })).toHaveCount(0);
});

test("scrolls a large home library while keeping its toolbar fixed", async ({ page }) => {
  await page.getByRole("button", { name: "New design" }).first().click();
  await page.getByRole("button", { name: "Back to projects" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.evaluate(() => {
    const key = "figmaboy.workspace.v1";
    const state = JSON.parse(localStorage.getItem(key) ?? "{}");
    const sourceFile = state.files[0];
    const sourcePage = state.pages[0];
    const sourceDocument = state.documents[sourcePage.id];
    for (let index = 1; index < 22; index += 1) {
      const fileId = `scroll_file_${index}`;
      const pageId = `scroll_page_${index}`;
      state.files.push({ ...sourceFile, id: fileId, name: `Scroll design ${index}`, updatedAt: new Date(Date.now() - index * 1_000).toISOString(), thumbnail: null });
      state.pages.push({ ...sourcePage, id: pageId, fileId });
      state.documents[pageId] = structuredClone(sourceDocument);
    }
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload();

  const content = page.locator(".content");
  await expect(page.getByRole("heading", { name: "Designs", exact: true })).toBeVisible();
  await expect(page.locator(".file-card")).toHaveCount(22);
  await expect.poll(() => content.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

  const toolbarBefore = await page.locator(".topbar").boundingBox();
  await content.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
  await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(page.locator(".file-card").last()).toBeInViewport();
  const toolbarAfter = await page.locator(".topbar").boundingBox();
  if (!toolbarBefore || !toolbarAfter) throw new Error("Home toolbar was not rendered");
  expect(toolbarAfter.y).toBe(toolbarBefore.y);

  await page.getByTitle("List view").click();
  await expect(page.locator(".file-list")).toBeVisible();
  await content.evaluate((element) => element.scrollTo({ top: 0 }));
  await expect.poll(() => content.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await content.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
  await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(page.locator(".file-card").last()).toBeInViewport();
});

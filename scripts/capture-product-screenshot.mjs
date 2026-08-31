import { chromium } from "playwright";

const baseUrl = process.env.FIGMABOY_PREVIEW_URL ?? "http://127.0.0.1:4173";
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? "/run/current-system/sw/bin/chromium" });
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 }, deviceScaleFactor: 1 });

const installTauriMock = () => {
  let callbackId = 1;
  const callbacks = new Map();
  window.__TAURI_INTERNALS__ = {
    transformCallback(callback) {
      const id = callbackId++;
      callbacks.set(id, callback);
      return id;
    },
    unregisterCallback(id) {
      callbacks.delete(id);
    },
    async invoke(command, args = {}) {
      if (command === "plugin:event|listen") return callbackId++;
      if (command === "codex_ui_state_read") {
        return { lastThreadId: "visual-thread", lastThreadIdByPage: { page_visual: "visual-thread" } };
      }
      if (command === "codex_connect") return { workspaceId: "file_visual", cwd: "/tmp/figmaboy-visual", reused: false };
      if (command !== "codex_request") return null;
      if (args.method === "account/read") return { account: { type: "chatgpt" } };
      if (args.method === "model/list") {
        return { data: [{
          id: "gpt-5.6-sol", model: "gpt-5.6-sol", displayName: "GPT-5.6-Sol", description: "",
          isDefault: true, hidden: false, defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "medium" }, { reasoningEffort: "high" }],
          serviceTiers: [{ id: "fast", name: "Fast" }],
        }] };
      }
      if (args.method === "skills/list") return { data: [{ cwd: "/tmp/figmaboy-visual", skills: [] }] };
      if (args.method === "thread/list") {
        return { data: [{
          id: "visual-thread", name: "Build the Figmaboy website", preview: "Build the landing page and docs",
          createdAt: 1788100000, updatedAt: 1788100180, recencyAt: 1788100180,
          cwd: "/tmp/figmaboy-visual", status: { type: "notLoaded" },
        }] };
      }
      if (args.method === "thread/resume" || args.method === "thread/read") {
        return {
          thread: {
            id: "visual-thread", name: "Build the Figmaboy website", preview: "Build the landing page and docs",
            createdAt: 1788100000, updatedAt: 1788100180, cwd: "/tmp/figmaboy-visual",
            turns: [{
              id: "visual-turn", status: "completed", startedAt: 1788100000, completedAt: 1788100180,
              items: [
                { id: "visual-user", type: "userMessage", content: [{ type: "text", text: "Build the Figmaboy landing page and documentation screen side by side. Keep both native and fully editable." }] },
                { id: "visual-commentary", type: "agentMessage", text: "I’ll build both page hierarchies with native layers, then review the completed frames.", _turnId: "visual-turn" },
                { id: "visual-read", type: "mcpToolCall", server: "figmaboy", tool: "document_get", status: "completed", _turnId: "visual-turn" },
                { id: "visual-apply", type: "mcpToolCall", server: "figmaboy", tool: "operations_apply", status: "completed", _turnId: "visual-turn" },
                { id: "visual-shot", type: "mcpToolCall", server: "figmaboy", tool: "frame_screenshot", status: "completed", _turnId: "visual-turn" },
                { id: "visual-final", type: "agentMessage", text: "Built and reviewed the landing page and documentation screen.\n\n- Shared warm editorial palette\n- Native navigation and page sections\n- Clear landing-page hierarchy\n- Structured documentation cards\n\nBoth frames remain editable, and the final revision is saved locally.", _turnId: "visual-turn" },
              ],
            }],
          },
          model: "gpt-5.6-sol", reasoningEffort: "medium", serviceTier: "fast",
        };
      }
      return {};
    },
  };
};

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.evaluate(() => {
  const now = new Date().toISOString();
  const common = (id, type, name, parentId, x, y, width, height, fill = null) => ({
    id, type, name, parentId, x, y, width, height, rotation: 0, opacity: 1, visible: true, locked: false,
    fill, stroke: null, radius: 0, shadow: null,
  });
  const text = (id, name, parentId, x, y, width, height, value, fontSize, weight = 600, color = "#171717") => ({
    ...common(id, "text", name, parentId, x, y, width, height, { type: "solid", color, opacity: 1 }),
    text: value, fontFamily: "Inter, sans-serif", fontSize, fontWeight: weight, fontStyle: "normal",
    lineHeight: 1.02, letterSpacing: fontSize > 30 ? -1.4 : 0, textAlign: "left", textAlignVertical: "top",
    textCase: "original", textDecoration: "none", textAutoResize: "height", paragraphSpacing: 0,
    paragraphIndent: 0, maxLines: null, textTruncation: "disabled", autoWidth: false,
  });
  const nodes = {};
  const add = (node) => { nodes[node.id] = node; };
  const makeFrame = (id, name, x) => {
    const frame = { ...common(id, "frame", name, null, x, 58, 420, 850, { type: "solid", color: "#f2f0e8", opacity: 1 }), childIds: [], clipContent: true };
    add(frame);
    return { frame, child: (node) => { frame.childIds.push(node.id); add(node); } };
  };

  const landing = makeFrame("frame_landing", "Figmaboy landing page", 35);
  landing.child(common("landing_rule", "rectangle", "Header rule", landing.frame.id, 28, 68, 364, 1, { type: "solid", color: "#b7b3aa", opacity: 1 }));
  landing.child(common("landing_signal", "ellipse", "Brand signal", landing.frame.id, 30, 26, 9, 9, { type: "solid", color: "#df4434", opacity: 1 }));
  landing.child(text("landing_brand", "Brand", landing.frame.id, 48, 23, 110, 20, "FIGMABOY®", 11, 800));
  landing.child(text("landing_nav", "Navigation", landing.frame.id, 240, 25, 150, 18, "CODEX   DOCS   DOWNLOAD", 7, 700, "#44423d"));
  landing.child(text("landing_kicker", "Hero kicker", landing.frame.id, 30, 104, 260, 18, "FIGMABOY + CODEX / 01", 8, 700, "#66635d"));
  landing.child(text("landing_headline", "Hero headline", landing.frame.id, 30, 148, 350, 142, "A QUIETER\nWAY TO MAKE.", 47, 760));
  landing.child(text("landing_intro", "Hero introduction", landing.frame.id, 30, 320, 330, 70, "A focused desktop design workspace with Codex chat built directly into the canvas.", 13, 500, "#4b4943"));
  landing.child(common("landing_primary", "rectangle", "Download button", landing.frame.id, 30, 418, 145, 42, { type: "solid", color: "#df4434", opacity: 1 }));
  landing.child(text("landing_primary_label", "Download label", landing.frame.id, 48, 432, 115, 16, "DOWNLOAD", 8, 750, "#fff8ec"));
  landing.child(common("landing_secondary", "rectangle", "Docs button", landing.frame.id, 188, 418, 112, 42, { type: "solid", color: "#171714", opacity: 1 }));
  landing.child(text("landing_secondary_label", "Docs label", landing.frame.id, 218, 432, 70, 16, "SEE DOCS", 8, 750, "#fff8ec"));
  landing.child(common("landing_red_band", "rectangle", "Principles band", landing.frame.id, 0, 520, 420, 128, { type: "solid", color: "#df4434", opacity: 1 }));
  landing.child(text("landing_principles_kicker", "Principles kicker", landing.frame.id, 30, 544, 180, 16, "02 / PRINCIPLES", 8, 700, "#fff8ec"));
  landing.child(text("landing_principles", "Principles headline", landing.frame.id, 30, 580, 220, 54, "LESS INTERFACE.\nMORE INTENTION.", 20, 760, "#fff8ec"));
  landing.child(text("landing_section_kicker", "Feature kicker", landing.frame.id, 30, 686, 200, 16, "03 / CODEX CHAT", 8, 700, "#66635d"));
  landing.child(text("landing_section", "Feature headline", landing.frame.id, 30, 722, 290, 66, "YOUR DESIGN AGENT,\nON CANVAS.", 25, 750));
  landing.child(common("landing_feature_bar", "rectangle", "Feature bar", landing.frame.id, 30, 810, 250, 8, { type: "solid", color: "#171714", opacity: 1 }));

  const docs = makeFrame("frame_docs", "Figmaboy documentation", 490);
  docs.child(common("docs_sidebar", "rectangle", "Documentation sidebar", docs.frame.id, 0, 0, 112, 850, { type: "solid", color: "#dedbd2", opacity: 1 }));
  docs.child(common("docs_signal", "ellipse", "Brand signal", docs.frame.id, 22, 24, 9, 9, { type: "solid", color: "#df4434", opacity: 1 }));
  docs.child(text("docs_brand", "Docs brand", docs.frame.id, 39, 21, 120, 20, "FIGMABOY DOCS", 10, 800));
  docs.child(text("docs_sidebar_title", "Sidebar title", docs.frame.id, 18, 82, 80, 18, "GETTING STARTED", 7, 750, "#6a675f"));
  for (const [id, y, label] of [["docs_overview", 118, "Overview"], ["docs_install", 154, "Install"], ["docs_quickstart", 190, "Quickstart"], ["docs_canvas", 256, "Canvas"], ["docs_codex", 292, "Codex chat"], ["docs_layers", 328, "Native layers"], ["docs_export", 394, "Export"]]) {
    if (label === "Quickstart") docs.child(common(`${id}_active`, "rectangle", "Active page", docs.frame.id, 10, y - 8, 92, 28, { type: "solid", color: "#df4434", opacity: 1 }));
    docs.child(text(id, `${label} link`, docs.frame.id, 20, y, 80, 16, label, 8, label === "Quickstart" ? 750 : 600, label === "Quickstart" ? "#fff8ec" : "#4f4c46"));
  }
  docs.child(text("docs_kicker", "Documentation kicker", docs.frame.id, 142, 78, 230, 18, "DOCS / GETTING STARTED / 01", 7, 750, "#6a675f"));
  docs.child(text("docs_headline", "Documentation headline", docs.frame.id, 142, 122, 250, 82, "BUILD WITH\nFIGMABOY.", 34, 760));
  docs.child(text("docs_intro", "Documentation introduction", docs.frame.id, 142, 224, 240, 66, "Learn the small set of ideas that make Figmaboy useful: native layers, project-aware Codex chat, and a review loop that stays in one window.", 10, 500, "#56534c"));
  docs.child(common("docs_chip_one", "rectangle", "Local chip", docs.frame.id, 142, 310, 76, 26, { type: "solid", color: "#171714", opacity: 1 }));
  docs.child(text("docs_chip_one_label", "Local chip label", docs.frame.id, 156, 319, 58, 12, "LOCAL FIRST", 7, 700, "#fff8ec"));
  docs.child(common("docs_chip_two", "rectangle", "Codex chip", docs.frame.id, 228, 310, 84, 26, { type: "solid", color: "#df4434", opacity: 1 }));
  docs.child(text("docs_chip_two_label", "Codex chip label", docs.frame.id, 240, 319, 66, 12, "CODEX BUILT IN", 7, 700, "#fff8ec"));
  for (const [id, y, step, title] of [["docs_step_one", 382, "01", "Install the desktop app"], ["docs_step_two", 470, "02", "Open your design"], ["docs_step_three", 558, "03", "Ask Codex beside the canvas"]]) {
    docs.child(common(id, "rectangle", title, docs.frame.id, 142, y, 242, 66, { type: "solid", color: "#e5e2d8", opacity: 1 }));
    docs.child(common(`${id}_number`, "ellipse", `${step} marker`, docs.frame.id, 154, y + 18, 24, 24, { type: "solid", color: step === "03" ? "#df4434" : "#171714", opacity: 1 }));
    docs.child(text(`${id}_step`, `${step} label`, docs.frame.id, 161, y + 25, 14, 10, step, 7, 750, "#fff8ec"));
    docs.child(text(`${id}_title`, title, docs.frame.id, 190, y + 20, 178, 22, title, 10, 700));
  }
  docs.child(common("docs_feature", "rectangle", "Native layers feature", docs.frame.id, 142, 680, 242, 112, { type: "solid", color: "#171714", opacity: 1 }));
  docs.child(text("docs_feature_kicker", "Feature kicker", docs.frame.id, 160, 700, 190, 14, "02 / CORE IDEA", 7, 700, "#df4434"));
  docs.child(text("docs_feature_title", "Feature title", docs.frame.id, 160, 732, 190, 44, "KEEP THE DESIGN\nINSPECTABLE.", 16, 750, "#fff8ec"));

  const state = {
    projects: [],
    files: [{ id: "file_visual", projectId: null, name: "Figmaboy website and docs", starred: false, createdAt: now, updatedAt: now, lastOpenedAt: now, trashedAt: null, thumbnail: null }],
    pages: [{ id: "page_visual", fileId: "file_visual", name: "Website", position: 0, revision: 7 }],
    documents: { page_visual: { schemaVersion: 1, rootIds: [landing.frame.id, docs.frame.id], nodes, viewport: { x: 0, y: 0, zoom: 1 }, prototypeStartFrameId: null } },
    assets: {},
  };
  localStorage.setItem("figmaboy.workspace.v1", JSON.stringify(state));
  localStorage.setItem("figmaboy:editor-layout:file_visual", JSON.stringify({
    leftOpen: true, rightOpen: true, leftWidth: 268, rightWidth: 241, codexWidth: 430,
    codexOpenByPage: { page_visual: false },
  }));
});

await page.goto(`${baseUrl}/editor/file_visual`, { waitUntil: "networkidle" });
await page.locator("#design-canvas").waitFor();
await page.evaluate(installTauriMock);
await page.getByTitle("Toggle Codex chat (Ctrl + `)").click();
try {
  await page.getByText("Built and reviewed the landing page and documentation screen.").waitFor({ timeout: 15_000 });
} catch (error) {
  console.error((await page.locator("body").innerText()).slice(0, 4_000));
  await page.screenshot({ path: "/tmp/figmaboy-product-capture-error.png", fullPage: true });
  throw error;
}
await page.locator(".messages").evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
await page.waitForTimeout(250);

for (const path of ["docs/assets/figmaboy-codex-workflow.png", "static/figmaboy-screenshot.png"]) {
  await page.screenshot({ path, fullPage: true });
}

await browser.close();
console.log("Captured current Figmaboy Codex workflow screenshots");

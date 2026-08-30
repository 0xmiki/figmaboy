import { describe, expect, it } from "vitest";
import { availableIconNames, ensureIconCatalog, iconData, searchIcons } from "$lib/icon-catalog";

describe("Phosphor icon catalog", () => {
  it("uses the Phosphor view box and hides duplicate weight variants", async () => {
    await ensureIconCatalog();
    const iconNames = availableIconNames();
    expect(iconData("sparkle")).toEqual(expect.objectContaining({ width: 256, height: 256 }));
    expect(iconNames).toContain("sparkle");
    expect(iconNames).not.toContain("sparkle-fill");
  });

  it("searches regular Phosphor icon names", async () => {
    await ensureIconCatalog();
    expect(searchIcons("chat circle")).toContain("chat-circle");
  });
});

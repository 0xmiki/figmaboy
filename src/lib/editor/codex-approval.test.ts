import { describe, expect, it } from "vitest";
import { describeApprovalRequest } from "$lib/editor/codex-approval";

describe("Codex approval descriptions", () => {
  it("explains command and network approvals", () => {
    expect(describeApprovalRequest({
      method: "item/commandExecution/requestApproval",
      params: {
        command: "curl https://api.example.com",
        cwd: "/projects/site",
        networkApprovalContext: { host: "api.example.com", protocol: "https" },
        additionalPermissions: { network: { enabled: true }, fileSystem: null },
      },
    })).toEqual({
      title: "Allow this command?",
      summary: "Connect to api.example.com over https.",
      details: ["Working folder: /projects/site", "Use the network"],
      command: "curl https://api.example.com",
    });
  });

  it("lists filesystem scopes in plain language", () => {
    expect(describeApprovalRequest({
      method: "item/permissions/requestApproval",
      params: {
        cwd: "/projects/site",
        reason: "The exporter needs these folders",
        permissions: {
          network: { enabled: true },
          fileSystem: {
            read: ["/assets"],
            write: null,
            entries: [
              { access: "write", path: { type: "path", path: "/exports" } },
              { access: "read", path: { type: "glob_pattern", pattern: "/fonts/*.woff2" } },
            ],
          },
        },
      },
    })).toMatchObject({
      title: "Grant extra access?",
      summary: "The exporter needs these folders.",
      details: ["Use the network", "Read: /assets", "Change: /exports", "Read: /fonts/*.woff2"],
    });
  });

  it("shows the root covered by a file-change approval", () => {
    expect(describeApprovalRequest({
      method: "item/fileChange/requestApproval",
      params: { grantRoot: "/projects/site/public", reason: "Save the generated images" },
    })).toMatchObject({
      title: "Allow these file changes?",
      summary: "Change files in /projects/site/public. Save the generated images.",
    });
  });

  it("names the MCP server and its request", () => {
    expect(describeApprovalRequest({
      method: "mcpServer/elicitation/request",
      params: { serverName: "Figmaboy", message: "Create a reusable selection tool", mode: "form" },
    })).toMatchObject({
      title: "Allow Figmaboy to continue?",
      summary: "Create a reusable selection tool.",
    });
  });
});

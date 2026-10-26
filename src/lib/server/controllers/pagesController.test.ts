import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/db.js", () => ({
  default: { getActivePageMonitors: vi.fn(), getMonitorsByTags: vi.fn() },
}));

import db from "../db/db.js";
import { GetPageShownMonitorContext, GetPageShownMonitorTags } from "./pagesController";

const mockedDb = vi.mocked(db);

type Monitor = {
  tag: string;
  name?: string;
  status?: string;
  is_hidden?: string;
  members?: string[];
  type_data?: string;
};

// The page shows `pageTags`; `monitors` is every monitor of the instance
function stub(pageTags: string[], monitors: Monitor[]) {
  const byTag = new Map(
    monitors.map((m) => [
      m.tag,
      {
        tag: m.tag,
        name: m.name ?? m.tag,
        status: m.status ?? "ACTIVE",
        is_hidden: m.is_hidden ?? "NO",
        monitor_type: m.members || m.type_data ? "GROUP" : "NONE",
        type_data: m.type_data ?? JSON.stringify({ monitors: (m.members ?? []).map((tag) => ({ tag })) }),
      },
    ]),
  );
  mockedDb.getActivePageMonitors.mockImplementation(
    async (_pageId: number, includeHidden = false) =>
      pageTags
        .filter((tag) => includeHidden || byTag.get(tag)?.is_hidden !== "YES")
        .map((monitor_tag) => ({ monitor_tag })) as Awaited<ReturnType<typeof db.getActivePageMonitors>>,
  );
  mockedDb.getMonitorsByTags.mockImplementation(
    async (tags: string[]) =>
      tags.flatMap((tag) => (byTag.has(tag) ? [byTag.get(tag)] : [])) as Awaited<
        ReturnType<typeof db.getMonitorsByTags>
      >,
  );
}

const shown = async (includeHidden?: boolean) => (await GetPageShownMonitorTags(1, includeHidden)).sort();

beforeEach(() => vi.clearAllMocks());

describe("GetPageShownMonitorTags", () => {
  it("adds the members of the page's groups, at any depth, to its own monitors", async () => {
    stub(
      ["site", "group"],
      [
        { tag: "site" },
        { tag: "group", members: ["api", "inner"] },
        { tag: "api" },
        { tag: "inner", members: ["db"] },
        { tag: "db" },
        { tag: "elsewhere" },
      ],
    );
    expect(await shown()).toEqual(["api", "db", "group", "inner", "site"]);
  });

  it("stops at a group that contains itself or an ancestor", async () => {
    stub(["a"], [{ tag: "a", members: ["b"] }, { tag: "b", members: ["a", "c"] }, { tag: "c" }]);
    expect(await shown()).toEqual(["a", "b", "c"]);
  });

  it("leaves out members that are inactive, missing, or hidden unless asked for hidden ones", async () => {
    stub(
      ["group"],
      [
        { tag: "group", members: ["up", "paused", "gone", "secret", "secret-group"] },
        { tag: "up" },
        { tag: "paused", status: "INACTIVE" },
        { tag: "secret", is_hidden: "YES" },
        { tag: "secret-group", is_hidden: "YES", members: ["behind-secret"] },
        { tag: "behind-secret" },
      ],
    );
    expect(await shown()).toEqual(["group", "up"]);
    expect(await shown(true)).toEqual(["behind-secret", "group", "secret", "secret-group", "up"]);
  });

  it("does not expand an inactive group, and reads a group without valid members as having none", async () => {
    stub(
      ["group", "broken", "odd"],
      [
        { tag: "group", members: ["paused-group"] },
        { tag: "paused-group", status: "INACTIVE", members: ["deep"] },
        { tag: "deep" },
        { tag: "broken", type_data: "{not json" },
        { tag: "odd", type_data: JSON.stringify({ monitors: [{ tag: 7 }, null, { tag: "api" }] }) },
        { tag: "api" },
      ],
    );
    expect(await shown()).toEqual(["api", "broken", "group", "odd"]);
  });
});

describe("GetPageShownMonitorContext", () => {
  it("names the groups that lead to each shown monitor, nearest page row first", async () => {
    stub(
      ["works-website", "product-diffdevil"],
      [
        { tag: "works-website", name: "Wolfsblvt Works website" },
        { tag: "product-diffdevil", name: "diffdevil", members: ["diffdevil-website", "capability-lens"] },
        { tag: "diffdevil-website", name: "Website" },
        { tag: "capability-lens", name: "Lens Studio", members: ["lens-page", "lens-api"] },
        { tag: "lens-page", name: "Lens Studio page" },
        { tag: "lens-api", name: "Analysis API" },
      ],
    );
    expect(Object.fromEntries(await GetPageShownMonitorContext(1))).toEqual({
      "works-website": [],
      "product-diffdevil": [],
      "diffdevil-website": ["diffdevil"],
      "capability-lens": ["diffdevil"],
      "lens-page": ["diffdevil", "Lens Studio"],
      "lens-api": ["diffdevil", "Lens Studio"],
    });
  });

  it("keeps the shortest route to a monitor that is also a page row or sits in several groups", async () => {
    stub(
      ["api", "outer"],
      [
        { tag: "api", name: "API" },
        { tag: "outer", name: "Outer", members: ["inner", "shared"] },
        { tag: "inner", name: "Inner", members: ["api", "shared"] },
        { tag: "shared", name: "Shared" },
      ],
    );
    const context = await GetPageShownMonitorContext(1);
    expect(context.get("api")).toEqual([]);
    expect(context.get("shared")).toEqual(["Outer"]);
    expect([...context.keys()]).toEqual(await GetPageShownMonitorTags(1));
  });
});

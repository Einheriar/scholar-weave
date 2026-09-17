import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAllProjects,
  deleteProject,
  listProjects,
  loadLatestProject,
  loadProject,
  saveProject,
  saveProjects,
} from "@/lib/storage/projects";
import { migrateToProjects } from "@/lib/migrations";
import { reorderProjects } from "@/lib/chat-history";
import type { Conversation, DocumentState, Project } from "@/lib/review-schema";

/**
 * 项目持久化（Dexie / IndexedDB，tests/setup.ts 装了 fake-indexeddb）。
 *
 * 守护点：v3 升项目制后，projects 表可读写、旧 documents/conversations
 * 已删（合并语义下删表显式写 null，见 AGENTS.md 第 13 条）；
 * v4 加 order 字段后列表按显式顺序读回。
 * 存储测试共享一个 fake-indexeddb、只 clear() 不清库，v3 upgrade 只跑一次。
 */

function makeProject(id: string, lastActivityAt: string, order?: number): Project {
  return {
    id,
    title: `文章 ${id}`,
    doc: {
      id: `doc_${id}`,
      title: `文章 ${id}`,
      blocks: [{ id: "p_1", type: "paragraph", text: "正文" }],
      revision: 1,
      checksum: "abc12345",
      updatedAt: lastActivityAt,
    },
    reviews: [],
    nodes: [],
    lastActivityAt,
    ...(order === undefined ? {} : { order }),
  };
}

beforeEach(async () => {
  await clearAllProjects();
});

describe("项目持久化", () => {
  it("保存后能读回，loadLatestProject 取最近更新的一个", async () => {
    await saveProject(makeProject("p_old", "2026-09-15T09:00:00.000Z"));
    await saveProject(makeProject("p_new", "2026-09-15T11:00:00.000Z"));

    const latest = await loadLatestProject();
    expect(latest?.id).toBe("p_new");
    const all = await listProjects();
    expect(all).toHaveLength(2);
  });

  it("同一 id 覆盖而非新增", async () => {
    await saveProject(makeProject("p_1", "2026-09-15T09:00:00.000Z"));
    const grown: Project = {
      ...makeProject("p_1", "2026-09-15T09:00:00.000Z"),
      nodes: [
        {
          id: "node_1",
          anchor: { type: "document" },
          originalText: "",
          createdAt: "2026-09-15T09:00:00.000Z",
          turns: [{ role: "user", content: "问" }],
        },
      ],
      lastActivityAt: "2026-09-15T12:00:00.000Z",
    };
    await saveProject(grown);

    const all = await listProjects();
    expect(all).toHaveLength(1);
    expect(all[0].nodes).toHaveLength(1);
  });

  it("按 id 读取单个项目", async () => {
    await saveProject(makeProject("p_1", "2026-09-15T09:00:00.000Z"));
    const got = await loadProject("p_1");
    expect(got?.title).toBe("文章 p_1");
    expect(await loadProject("nope")).toBeUndefined();
  });

  it("删除只影响目标项目", async () => {
    await saveProject(makeProject("p_1", "2026-09-15T09:00:00.000Z"));
    await saveProject(makeProject("p_2", "2026-09-15T10:00:00.000Z"));

    await deleteProject("p_1");
    const all = await listProjects();
    expect(all.map((p) => p.id)).toEqual(["p_2"]);
  });

  it("清空后列表为空（clearAll 覆盖新表）", async () => {
    await saveProject(makeProject("p_1", "2026-09-15T09:00:00.000Z"));
    await clearAllProjects();
    expect(await listProjects()).toEqual([]);
  });

  it("写入时过 schema：缺字段的项目会被拒绝，不会落库", async () => {
    const broken = { id: "p_bad", title: "缺字段" } as unknown as Project;
    await expect(saveProject(broken)).rejects.toThrow();
    expect(await listProjects()).toEqual([]);
  });

  // ── v4：显式 order 顺序 ──
  it("按显式 order 读回顺序，与 lastActivityAt 无关", async () => {
    // order 与活动时间刻意相反：列表应听 order 的
    await saveProject(makeProject("p_old", "2026-09-15T09:00:00.000Z", 0));
    await saveProject(makeProject("p_new", "2026-09-15T11:00:00.000Z", 1));

    const all = await listProjects();
    expect(all.map((p) => p.id)).toEqual(["p_old", "p_new"]);
    // loadLatestProject 现在是「列表最上面那条」，不再是活动时间最新
    expect((await loadLatestProject())?.id).toBe("p_old");
  });

  it("saveProjects 批量写回新顺序后，读回来就是新顺序", async () => {
    await saveProject(makeProject("p_1", "2026-09-15T09:00:00.000Z", 0));
    await saveProject(makeProject("p_2", "2026-09-15T10:00:00.000Z", 1));
    await saveProject(makeProject("p_3", "2026-09-15T11:00:00.000Z", 2));

    const all = await listProjects();
    // 把最后一条拖到最前
    const reordered = reorderProjects(all, ["p_3", "p_1", "p_2"]);
    await saveProjects(reordered);

    expect((await listProjects()).map((p) => p.id)).toEqual(["p_3", "p_1", "p_2"]);
  });

  it("没有 order 的旧数据仍能读出且排在末尾（不因缺字段被丢弃）", async () => {
    // 模拟 v4 之前写入的行：schema 的 order 是 optional，不能被 safeParse 丢掉
    await saveProject(makeProject("p_legacy", "2026-09-15T23:00:00.000Z"));
    await saveProject(makeProject("p_ordered", "2026-09-15T09:00:00.000Z", 0));

    const all = await listProjects();
    expect(all.map((p) => p.id)).toEqual(["p_ordered", "p_legacy"]);
  });
});

describe("v2 → v3 迁移（migrateToProjects 纯函数）", () => {
  function legacyDoc(id: string, updatedAt: string): DocumentState {
    return {
      id,
      title: `草稿 ${id}`,
      blocks: [{ id: "p_1", type: "paragraph", text: "正文内容" }],
      revision: 3,
      checksum: "deadbeef",
      updatedAt,
    };
  }
  function legacyConv(id: string, updatedAt: string): Conversation {
    return {
      id,
      title: `对话 ${id}`,
      turns: [
        { role: "user", content: "问题" },
        { role: "assistant", content: "回答" },
      ],
      createdAt: updatedAt,
      updatedAt,
    };
  }

  it("取最近一份草稿 + 最近一条对话，组装成一个项目", () => {
    const projects = migrateToProjects(
      [legacyDoc("doc_a", "2026-09-14T08:00:00.000Z"), legacyDoc("doc_b", "2026-09-15T08:00:00.000Z")],
      [legacyConv("conv_1", "2026-09-15T09:00:00.000Z"), legacyConv("conv_2", "2026-09-15T07:00:00.000Z")],
    );
    expect(projects).toHaveLength(1);
    const p = projects[0];
    expect(p.doc.id).toBe("doc_b");
    expect(p.title).toBe("草稿 doc_b");
    expect(p.nodes).toHaveLength(1);
    expect(p.nodes[0].turns).toHaveLength(2);
    expect(p.nodes[0].anchor.type).toBe("document");
  });

  it("没有对话时节点为空数组", () => {
    const projects = migrateToProjects([legacyDoc("doc_a", "2026-09-15T08:00:00.000Z")], []);
    expect(projects).toHaveLength(1);
    expect(projects[0].nodes).toEqual([]);
  });

  it("没有草稿时返回空（空库起步）", () => {
    expect(migrateToProjects([], [legacyConv("conv_1", "2026-09-15T09:00:00.000Z")])).toEqual([]);
    expect(migrateToProjects([], [])).toEqual([]);
  });

  it("迁移产出的项目能过 ProjectSchema 校验（结构合法）", async () => {
    const projects = migrateToProjects(
      [legacyDoc("doc_a", "2026-09-15T08:00:00.000Z")],
      [legacyConv("conv_1", "2026-09-15T09:00:00.000Z")],
    );
    // saveProject 内部会 ProjectSchema.parse，能落库即结构合法
    await saveProject(projects[0]);
    expect((await listProjects())[0].id).toBe(projects[0].id);
  });
});

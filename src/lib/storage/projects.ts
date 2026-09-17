import { getDB } from "./db";
import { ProjectSchema, type Project } from "../review-schema";
import { sortProjects } from "../chat-history";

/**
 * 项目的本地持久化（左侧历史记录列表的数据源）。
 * 和旧草稿/对话一样：写入前 schema 校验，读出时校验、损坏即丢弃。
 *
 * 注意：列表会把**全部项目连同正文/建议/节点**读进内存（Dexie 没有字段投影）。
 * 本地单人使用、篇数有限，够用；若以后历史很长，再加一张只存
 * id/title/order/lastActivityAt 的摘要表，列表读摘要、切换时再按 id 取全文。
 */

export async function saveProject(project: Project): Promise<void> {
  const parsed = ProjectSchema.parse(project);
  await getDB().projects.put(parsed);
}

/** 批量落库（拖动排序后一次性写回新的 order） */
export async function saveProjects(projects: Project[]): Promise<void> {
  const parsed = projects.map((p) => ProjectSchema.parse(p));
  await getDB().projects.bulkPut(parsed);
}

/** 全部项目，按显式 order 升序（排序语义见 chat-history.ts 的 sortProjects） */
export async function listProjects(): Promise<Project[]> {
  // 用 toArray 而不是 orderBy("order")：Dexie 索引会跳过缺该字段的行，
  // 万一有 v4 之前写入、迁移没覆盖到的数据，走索引会让它直接从列表里消失。
  const rows = await getDB().projects.toArray();
  const parsed = rows.flatMap((row) => {
    const result = ProjectSchema.safeParse(row);
    return result.success ? [result.data] : [];
  });
  return sortProjects(parsed);
}

/** 启动时恢复现场用的项目 = 列表最上面的那条（活动置顶后即最近活动的一篇） */
export async function loadLatestProject(): Promise<Project | undefined> {
  return (await listProjects())[0];
}

export async function loadProject(id: string): Promise<Project | undefined> {
  const row = await getDB().projects.get(id);
  if (!row) return undefined;
  const result = ProjectSchema.safeParse(row);
  return result.success ? result.data : undefined;
}

export async function deleteProject(id: string): Promise<void> {
  await getDB().projects.delete(id);
}

/** 清空全部本地项目（「清空数据」用，覆盖新表见 AGENTS.md 第 14 条） */
export async function clearAllProjects(): Promise<void> {
  await getDB().projects.clear();
}

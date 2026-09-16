import { getDB } from "./db";
import { ProjectSchema, type Project } from "../review-schema";

/**
 * 项目的本地持久化（左侧历史记录列表的数据源）。
 * 和旧草稿/对话一样：写入前 schema 校验，读出时校验、损坏即丢弃。
 *
 * 注意：列表会把**全部项目连同正文/建议/节点**读进内存（Dexie 没有字段投影）。
 * 本地单人使用、篇数有限，够用；若以后历史很长，再加一张只存
 * id/title/lastActivityAt 的摘要表，列表读摘要、切换时再按 id 取全文。
 */

export async function saveProject(project: Project): Promise<void> {
  const parsed = ProjectSchema.parse(project);
  await getDB().projects.put(parsed);
}

/** 全部项目，最近活动的在前（doc.updatedAt 索引降序，近似 lastActivityAt 排序） */
export async function listProjects(): Promise<Project[]> {
  const rows = await getDB()
    .projects.orderBy("doc.updatedAt")
    .reverse()
    .toArray();
  return rows.flatMap((row) => {
    const result = ProjectSchema.safeParse(row);
    return result.success ? [result.data] : [];
  });
}

/** 最近活动的一个项目（启动时恢复现场用） */
export async function loadLatestProject(): Promise<Project | undefined> {
  const rows = await getDB()
    .projects.orderBy("doc.updatedAt")
    .reverse()
    .limit(1)
    .toArray();
  const row = rows[0];
  if (!row) return undefined;
  const result = ProjectSchema.safeParse(row);
  return result.success ? result.data : undefined;
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

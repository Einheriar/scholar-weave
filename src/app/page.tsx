"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DocumentEditor,
  type DocumentEditorHandle,
} from "@/components/editor/DocumentEditor";
import { ReviewSidebar } from "@/components/review/ReviewSidebar";
import { ChangeSetPreview } from "@/components/review/ChangeSetPreview";
import { ContextChat } from "@/components/chat/ContextChat";
import { ChatHistory, ChatHistoryToggle } from "@/components/chat/ChatHistory";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SettingsPanel } from "@/components/SettingsPanel";
import { buttonClass } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  loadSettings,
  settingsToRequestBody,
  type UserSettings,
} from "@/lib/settings";
import type {
  ChangeSet,
  ChatContext,
  ChatNode,
  ChatTurn,
  DocumentState,
  Project,
  ReviewItem,
} from "@/lib/review-schema";
import type { ReviewMode } from "@/lib/llm/review-llm-schema";
import { buildSampleDocument, buildSampleReview } from "@/lib/sample-data";
import { canLocateScope } from "@/lib/anchoring";
import { computeChangeSetApplication } from "@/lib/changeset";
import { createDocument } from "@/lib/revisions";
import { APP_VERSION } from "@/lib/version";
import {
  deriveProjectTitle,
  moveProjectToTop,
  newProjectId,
  reorderProjects,
  upsertProject,
} from "@/lib/chat-history";
import { findNodeByAnchor } from "@/lib/chat-nodes";
import {
  clearAllProjects,
  deleteProject as deleteStoredProject,
  listProjects,
  loadLatestProject,
  saveProject,
  saveProjects,
} from "@/lib/storage/projects";

type ReviewUiState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "done"; summary: string }
  | { phase: "error"; message: string };

const MODE_LABEL: Record<ReviewMode, string> = {
  proofread: "仅纠错",
  polish: "适度润色",
  deep_review: "深度审阅",
};

type Selection = { blockId: string; text: string } | null;

/** 聊天区高度（拖拽把手可调）的持久化 key 与范围 */
const CHAT_HEIGHT_KEY = "supergrammarly-chat-height";
const DEFAULT_CHAT_HEIGHT = 320;
const MIN_CHAT_H = 180;
const MAX_CHAT_H = 720;

export default function Home() {
  const [doc, setDoc] = useState<DocumentState | null>(null);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [mode, setMode] = useState<ReviewMode>("proofread");
  const [reviewUi, setReviewUi] = useState<ReviewUiState>({ phase: "idle" });

  // 对话与修改集
  const [selection, setSelection] = useState<Selection>(null);
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [applyingOpinionId, setApplyingOpinionId] = useState<string | null>(null);
  const [activeChangeSet, setActiveChangeSet] = useState<ChangeSet | null>(null);
  // 修改集预览框常驻渲染：open 驱动进/出动画，播完由 onClosed 卸载
  const [changeSetOpen, setChangeSetOpen] = useState(false);
  const [changeSetMounted, setChangeSetMounted] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  /** 供屏幕阅读器播报的状态文本（定位、快捷键等） */
  const [announce, setAnnounce] = useState("");

  // 项目（左侧历史列表的单位 = 一篇文章的完整工作现场）
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjId, setActiveProjId] = useState<string | null>(null);
  /** 当前项目的聊天节点（节点化聊天的数据；阶段 3 起按节点组织） */
  const [nodes, setNodes] = useState<ChatNode[]>([]);
  /** 当前查看的聊天节点 id（翻看旧节点时发送接它，见规则 10） */
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  /** 聊天区最小化（规则 22：收起为只有头部的窄条） */
  const [chatMinimized, setChatMinimized] = useState(false);
  /** 聊天区高度 px（顶部拖拽把手可调；持久化到 localStorage） */
  const [chatHeight, setChatHeight] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_CHAT_HEIGHT;
    const raw = window.localStorage.getItem(CHAT_HEIGHT_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n >= MIN_CHAT_H && n <= MAX_CHAT_H
      ? n
      : DEFAULT_CHAT_HEIGHT;
  });
  const handleChatResize = useCallback((h: number) => {
    setChatHeight(h);
    try {
      window.localStorage.setItem(CHAT_HEIGHT_KEY, String(h));
    } catch {
      /* localStorage 不可用时静默 */
    }
  }, []);
  const [historyOpen, setHistoryOpen] = useState(false);
  // 刚由「新文章」创建的项目 id，供列表条目播出现动画（toast-rise），播完由
  // onCreatedShown 清掉。建档在 handleNewProject 里同步完成，所以这里也在点击那一帧就设上。
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
  /**
   * 当前项目上次落库后的对象。判断「回复回来时用户是否还停在这个项目上」
   * 以及建档时机（首次审阅/发聊天才分配 id）——在事件回调/异步里写，不在渲染期写。
   */
  const activeProjRef = useRef<Project | null>(null);
  /**
   * 与 `projects` 同步的镜像 ref。用于在事件回调里同步读写列表顺序——
   * 「活动置顶」「拖动排序」都要先算出确定的数组再 setState + 落库，
   * 不能依赖 setState updater 的执行时机（AGENTS.md 第 21 条）。
   */
  const projectsRef = useRef<Project[]>([]);
  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  // 设置面板
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<UserSettings>(loadSettings);

  // 设置变化时保存
  const handleSettingsChange = useCallback((next: UserSettings) => {
    setSettings(next);
  }, []);

  const editorRef = useRef<DocumentEditorHandle>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** 每条付费请求各自的世代号：即使取消/超时与新请求交错，旧回调也不能改当前界面。 */
  const reviewRequestSeq = useRef(0);
  const chatRequestSeq = useRef(0);
  const changeSetRequestSeq = useRef(0);
  /**
   * 防抖保存从 ref 读最新状态（doc/reviews/nodes/activeProjId），
   * 避免 setTimeout 闭包读到批处理前的旧值导致节点/建议丢失。
   */
  const latestRef = useRef<{ doc: DocumentState | null; reviews: ReviewItem[]; nodes: ChatNode[]; activeProjId: string | null }>({
    doc: null,
    reviews: [],
    nodes: [],
    activeProjId: null,
  });
  useEffect(() => {
    latestRef.current = { doc, reviews, nodes, activeProjId };
  }, [doc, reviews, nodes, activeProjId]);
  const chatAbortRef = useRef<AbortController | null>(null);
  /** 异步聊天回复只在用户仍查看原节点时更新消息面板；节点数据本身仍按 nodeId 写回。 */
  const activeNodeIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeNodeIdRef.current = activeNodeId;
  }, [activeNodeId]);

  /**
   * 审阅/聊天/生成修改集都会产生调用费用。请求期间锁住文章现场，避免用户切换或修改后
   * 让已经付费生成的结果失去归属；请求 token 与文档快照校验仍作为异常路径的兜底。
   */
  const requestLocked =
    reviewUi.phase === "loading" || chatBusy || applyingOpinionId !== null;

  const announceRequestLock = useCallback(() => {
    setAnnounce("请求处理中，请等待完成后再修改或切换文章。");
  }, []);

  // ── 启动：恢复最近项目，否则载入样例 ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [latest, all] = await Promise.all([loadLatestProject(), listProjects()]);
      if (cancelled) return;
      setDoc(latest ? latest.doc : buildSampleDocument().doc);
      setProjects(all);
      projectsRef.current = all;
      if (latest) {
        // 接着上次的项目继续：恢复正文 + 建议 + 聊天现场
        activeProjRef.current = latest;
        setActiveProjId(latest.id);
        setReviews(latest.reviews);
        setNodes(latest.nodes);
        const lastNode = latest.nodes[latest.nodes.length - 1];
        setActiveNodeId(lastNode?.id ?? null);
        setChatTurns(lastNode?.turns ?? []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDocChange = useCallback((next: DocumentState) => {
    setDoc(next);
    setSaveState("saving");
    // 文本变化后双向校验锚点：open 定位失败标过期；stale 若因撤销/改回
    // 重新可定位则恢复 open。只碰 open/stale 这一对——用户手动忽略的
    // rejected 不参与，不会被误恢复（PLAN 10.3/10.4）
    setReviews((rs) =>
      rs.map((r) => {
        if (r.status === "open" && !canLocateScope(next, r.scope)) {
          return { ...r, status: "stale" as const };
        }
        if (r.status === "stale" && canLocateScope(next, r.scope)) {
          return { ...r, status: "open" as const };
        }
        return r;
      }),
    );
  }, []);

  // 立即把当前项目整体落库（正文 + 建议 + 节点）。默认从 latestRef 读最新状态，
  // 避免 setTimeout 闭包读到批处理前的旧值。首次保存才建档分配 id（规则 1）。
  // 调用方若刚算好确定的节点数组（如回复到达），应显式传 nodesOverride，
  // 免得 React 批处理期间 latestRef 被 effect 同步回旧快照。
  const persistProjectNow = useCallback(async (nodesOverride?: ChatNode[]) => {
    const { doc: curDoc, reviews: curReviews, nodes: curNodes, activeProjId: curId } =
      latestRef.current;
    const nodesToSave = nodesOverride ?? curNodes;
    if (!curDoc) return;
    const now = new Date().toISOString();
    const id = curId ?? newProjectId();
    // 标题单一事实源：doc.title 为空时用派生标题（首段截断）回填进 doc，
    // 左上角标题框与历史条目显示同一份（改任一处处处生效，列表条目用实时派生）。
    const derived = deriveProjectTitle(curDoc);
    const docToSave = curDoc.title.trim()
      ? curDoc
      : { ...curDoc, title: derived === "未命名文章" ? "" : derived };
    if (docToSave !== curDoc) {
      latestRef.current.doc = docToSave;
      setDoc(docToSave);
    }
    const project: Project = {
      id,
      title: derived,
      doc: docToSave,
      reviews: curReviews,
      nodes: nodesToSave,
      lastActivityAt: now,
    };
    if (curId === null) {
      setActiveProjId(id);
    }
    // 走到这里就是一次「活动」（编辑正文 / 审阅出结果 / 聊天回复），把该项目置顶。
    // 单纯点开查看不走此函数，因此不会改变位置（用户认可的语义）。
    // 置顶只改这一项的 order、不动其余项目，所以只需写回这一行。
    // 用 ref 同步算出结果、同一个数组既 setState 又落库——不依赖 setState 的 updater
    // 什么时候执行（AGENTS.md 第 21 条：updater 里做副作用不可靠）。
    const nextList = moveProjectToTop(upsertProject(projectsRef.current, project), id);
    const toSave = nextList.find((p) => p.id === id) ?? project;
    projectsRef.current = nextList;
    activeProjRef.current = toSave;
    setProjects(nextList);
    await saveProject(toSave);
    setSaveState("saved");
  }, []);

  // 防抖保存项目：编辑触发 saving 后延迟落库；聊天回复到达会立即落库（见 sendChat）。
  useEffect(() => {
    if (!doc || saveState !== "saving") return;
    const t = setTimeout(() => {
      void persistProjectNow();
    }, 500);
    return () => clearTimeout(t);
  }, [doc, reviews, nodes, saveState, activeProjId, persistProjectNow]);

  // ── 项目：切换 / 新建 / 删除 ──
  /** 点开左栏项目：完整恢复正文 + 建议 + 聊天现场（规则 5 现场可回看） */
  const handleSelectProject = useCallback(
    (id: string) => {
      if (requestLocked) {
        announceRequestLock();
        return;
      }
      const proj = projects.find((p) => p.id === id);
      if (!proj) return;
      // 切换前把当前项目立即落库（防抖保存可能还没跑，避免旧文章丢失）。
      // 同样读 latestRef 拿最新现场、且**不刷新 lastActivityAt**——离开一篇不是编辑它，
      // 刷成 now 会让被离开的那篇在列表里跳到顶部（点开 B 结果 A 上去了）。
      const {
        doc: curDoc,
        reviews: curReviews,
        nodes: curNodes,
        activeProjId: curId,
      } = latestRef.current;
      const prev = activeProjRef.current;
      if (curId && curId !== id && curDoc && prev) {
        const persisted: Project = {
          ...prev,
          title: deriveProjectTitle(curDoc),
          doc: curDoc,
          reviews: curReviews,
          nodes: curNodes,
        };
        // 原地替换、不动顺序：「点开另一篇」不是活动，当前这篇不该因此置顶
        const nextList = upsertProject(projectsRef.current, persisted);
        projectsRef.current = nextList;
        setProjects(nextList);
        void saveProject(persisted);
      }
      activeProjRef.current = proj;
      setActiveProjId(id);
      setDoc(proj.doc);
      setReviews(proj.reviews);
      setNodes(proj.nodes);
      const lastNode = proj.nodes[proj.nodes.length - 1];
      setActiveNodeId(lastNode?.id ?? null);
      setChatTurns(lastNode?.turns ?? []);
      setSelection(null);
      setSelectedId(null);
      setChatError(null);
      setChangeSetOpen(false);
      setSaveState("idle");
      // 窄屏从抽屉里选完就收起；宽屏左栏常驻，这个 state 本来也不生效
      setHistoryOpen(false);
      setAnnounce(`已打开文章：${proj.title}。`);
    },
    [projects, requestLocked, announceRequestLock],
  );

  /** 新文章：清空正文 + 建议 + 聊天，开一个新项目；旧文章留在左栏（规则 4）。
   *
   *  两件事在点击这一帧同步做完，不能拖到 500ms 防抖保存里：
   *  - **把旧项目的当前现场立即落库**（防抖可能还没跑）。读 `latestRef` 而不是
   *    `activeProjRef`——后者是「上次保存的快照」，防抖窗口内刚敲的字只在 latestRef 上，
   *    用快照落库会丢掉这不到 500ms 的编辑。
   *  - **分配新项目 id 并插进列表**。分配 id 只是个 crypto.randomUUID、不需要任何 I/O，
   *    早先却挂在防抖落库路径上，于是「点」与「新行蹦出来」之间空出约一秒。
   */
  const handleNewProject = useCallback((opts?: { keepHistoryOpen?: boolean }) => {
    if (requestLocked) {
      announceRequestLock();
      return;
    }
    const {
      doc: curDoc,
      reviews: curReviews,
      nodes: curNodes,
      activeProjId: curId,
    } = latestRef.current;
    const prev = activeProjRef.current;
    if (curId && curDoc && prev) {
      // 用旧现场回填，但**不刷新 lastActivityAt**：用户是「离开」这篇、而不是编辑它，
      // 刷成 now 会让它在列表里无端跳到顶部（点新文章时那次突然的「旧项目刷新」）。
      const persisted: Project = {
        ...prev,
        title: deriveProjectTitle(curDoc),
        doc: curDoc,
        reviews: curReviews,
        nodes: curNodes,
      };
      // 原地替换、不动顺序：「离开」当前这篇去新建不是它的活动，不该因此置顶
      const prevList = upsertProject(projectsRef.current, persisted);
      projectsRef.current = prevList;
      setProjects(prevList);
      void saveProject(persisted);
    }

    const id = newProjectId();
    const blankDoc = createDocument("", [""]);
    const blank: Project = {
      id,
      title: "未命名文章",
      doc: blankDoc,
      reviews: [],
      nodes: [],
      lastActivityAt: new Date().toISOString(),
    };
    activeProjRef.current = blank;
    setActiveProjId(id);
    // 新项目插到最前（upsertProject 对新 id 就这语义）
    const nextList = upsertProject(projectsRef.current, blank);
    projectsRef.current = nextList;
    setProjects(nextList);
    // 出现动画按事件钉住这一条，播完由 onCreatedShown 清掉（不按「时间最新」取，
    // 否则初次加载/切回旧项目都会误触发）
    setJustCreatedId(id);
    // latestRef 同步推进到新项目：下面 setSaveState("saving") 触发的防抖保存、
    // 以及聊天回复的立即落库都读它，留着旧现场会把旧文章内容写进新 id
    latestRef.current = { doc: blankDoc, reviews: [], nodes: [], activeProjId: id };
    setDoc(blankDoc);
    setReviews([]);
    setNodes([]);
    setActiveNodeId(null);
    setChatTurns([]);
    setSelection(null);
    setSelectedId(null);
    setChatError(null);
    setChangeSetOpen(false);
    if (!opts?.keepHistoryOpen) setHistoryOpen(false);
    setSaveState("saving");
    setAnnounce("已开始新文章。");
  }, [requestLocked, announceRequestLock]);

  /** 手动拖动 / 键盘移动后的新顺序：密集重编号、立即落库（显式操作，允许全表写回） */
  const handleReorderProjects = useCallback((orderedIds: string[], message?: string) => {
    if (requestLocked) {
      announceRequestLock();
      return;
    }
    const next = reorderProjects(projectsRef.current, orderedIds);
    projectsRef.current = next;
    setProjects(next);
    void saveProjects(next);
    setAnnounce(message ?? "已调整文章顺序。");
  }, [requestLocked, announceRequestLock]);

  const handleDeleteProject = useCallback(
    async (id: string) => {
      if (requestLocked) {
        announceRequestLock();
        return;
      }
      const target = projects.find((p) => p.id === id);
      if (
        target &&
        !window.confirm(`删除文章「${target.title}」？此操作不可撤销。`)
      ) {
        return;
      }
      await deleteStoredProject(id);
      // 删除后其余项目**相对顺序不变**，只把 order 压回 0..n-1（避免遗留空洞）
      const rest = projectsRef.current.filter((p) => p.id !== id);
      const densified = reorderProjects(rest, rest.map((p) => p.id));
      projectsRef.current = densified;
      setProjects(densified);
      if (activeProjId === id) {
        activeProjRef.current = null;
        setActiveProjId(null);
        setReviews([]);
        setNodes([]);
        setActiveNodeId(null);
        setChatTurns([]);
      }
      setAnnounce("已删除文章。");
    },
    [projects, activeProjId, requestLocked, announceRequestLock],
  );

  // ── 审阅 ──
  const runReview = useCallback(async () => {
    if (!doc) return;
    if (requestLocked) {
      announceRequestLock();
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++reviewRequestSeq.current;
    const requestDoc = {
      id: doc.id,
      revision: doc.revision,
      checksum: doc.checksum,
    };
    setReviewUi({ phase: "loading" });
    setSelectedId(null);
    const prefs = settingsToRequestBody(settings);
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          documentId: doc.id,
          revision: doc.revision,
          checksum: doc.checksum,
          mode,
          language: "en",
          style: settings.review.style || undefined,
          preserveTerms: prefs.reviewPrefs.preserveTerms,
          customPrompt: prefs.reviewPrefs.customPrompt,
          llmConfig: prefs.llmConfig,
          blocks: doc.blocks.map((b) => ({ id: b.id, text: b.text })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? `审阅失败（HTTP ${res.status}）`);
      }
      if (reviewRequestSeq.current !== requestId) return;
      const current = latestRef.current.doc;
      if (
        !current ||
        current.id !== requestDoc.id ||
        current.revision !== requestDoc.revision ||
        current.checksum !== requestDoc.checksum ||
        data.documentRevision !== requestDoc.revision ||
        data.checksum !== requestDoc.checksum
      ) {
        throw new Error("正文状态已变化，本次审阅结果未应用。请重新审阅。");
      }
      const nextReviews = data.items as ReviewItem[];
      latestRef.current.reviews = nextReviews;
      setReviews(nextReviews);
      setReviewUi({ phase: "done", summary: data.documentSummary ?? "" });
      setSaveState("saving");
      setAnnounce(`审阅完成，共 ${nextReviews.length} 条建议。`);
    } catch (e) {
      if (reviewRequestSeq.current !== requestId) return;
      if (e instanceof Error && e.name === "AbortError") {
        setReviewUi({ phase: "idle" });
        return;
      }
      setReviewUi({
        phase: "error",
        message: e instanceof Error ? e.message : "审阅失败。",
      });
    } finally {
      if (reviewRequestSeq.current === requestId) abortRef.current = null;
    }
  }, [doc, mode, settings, requestLocked, announceRequestLock]);

  const cancelReview = useCallback(() => {
    reviewRequestSeq.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setReviewUi({ phase: "idle" });
  }, []);

  // ── 建议定位 / 状态 ──
  // 正文标记相对视口顶部的距离（正文→侧栏对齐用），
  // 由 handleBodySelectAnchor 以闭包捕获后交给侧栏做卡片对齐。
  // 声明在 handleSelect 之前：后者点击侧栏卡片时要清掉 anchorTop。
  const [anchorTop, setAnchorTop] = useState<number | null>(null);
  const summaryRef = useRef<HTMLParagraphElement | null>(null);

  const handleSelect = useCallback(
    (id: string) => {
      // 侧栏发起的选中不带正文锚点；清掉 anchorTop 防止侧栏误用上一轮的旧坐标
      setAnchorTop(null);
      setSelectedId(id);
      const item = reviews.find((r) => r.id === id);
      if (!item) return;
      if (item.scope.type !== "document") {
        // 定位到正文对应范围，并把键盘焦点交给编辑器（PLAN 6.2）
        editorRef.current?.revealItem(item);
        setAnnounce(`已定位到建议：${item.title}`);
      } else {
        // 全文建议选中时滚到「全文总结」横幅，便于对照阅读
        //（不用 smooth：动画期间的持续位移会让「点击-定位」类 E2E 的稳定性检查超时）
        summaryRef.current?.scrollIntoView({
          behavior: "instant",
          block: "nearest",
        });
        setAnnounce(`已选中全文建议：${item.title}`);
      }
    },
    [reviews],
  );

  /** 点击正文标记（正文→侧栏）：只做选中与播报，不反向移动光标 */
  const handleBodySelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      const item = reviews.find((r) => r.id === id);
      if (item) setAnnounce(`已选中正文中的建议：${item.title}`);
    },
    [reviews],
  );

  const handleBodySelectAnchor = useCallback(
    (id: string, viewportTop: number | null) => {
      setAnchorTop(viewportTop);
      handleBodySelect(id);
    },
    [handleBodySelect, setAnchorTop],
  );

  const handleAccept = useCallback(
    (id: string): boolean => {
      if (requestLocked) {
        announceRequestLock();
        return false;
      }
      if (!doc) return false;
      const item = reviews.find((r) => r.id === id);
      if (!item || item.status !== "open" || item.kind !== "edit") {
        // opinion 无文本改动，仅标记
        if (item && item.status === "open" && item.kind === "opinion") {
          setReviews((rs) =>
            rs.map((r) =>
              r.id === id ? { ...r, status: "accepted" as const } : r,
            ),
          );
          setSaveState("saving");
          return true;
        }
        return false;
      }
      const acceptedBlockId = item.scope.type === "block" ? item.scope.blockId : null;
      const acceptedSnapshot =
        acceptedBlockId !== null && item.replacement !== undefined
          ? {
              before: doc.blocks.find((block) => block.id === acceptedBlockId)?.text ?? "",
              after: item.replacement,
            }
          : undefined;
      const ok = editorRef.current?.applyEdit(item);
      if (!ok) return false;
      setReviews((rs) =>
        rs.map((r) =>
          r.id === id
            ? { ...r, status: "accepted" as const, acceptedSnapshot }
            : r,
        ),
      );
      setSaveState("saving");
      return true;
    },
    [doc, reviews, requestLocked, announceRequestLock],
  );

  const handleReject = useCallback((id: string) => {
    if (requestLocked) {
      announceRequestLock();
      return;
    }
    setReviews((rs) =>
      rs.map((r) =>
        r.id === id && r.status === "open"
          ? { ...r, status: "rejected" as const }
          : r,
      ),
    );
    setSaveState("saving");
  }, [requestLocked, announceRequestLock]);

  const handleRevert = useCallback((id: string) => {
    if (requestLocked) {
      announceRequestLock();
      return;
    }
    const item = reviews.find((r) => r.id === id);
    if (!item || (item.status !== "accepted" && item.status !== "rejected")) return;
    // 已接受的文本修改只做安全反向定位：目标已被继续编辑时绝不恢复整段旧快照。
    if (item.status === "accepted" && item.kind === "edit") {
      const ok = editorRef.current?.revertEdit(item) ?? false;
      if (!ok) {
        setChatError("正文已变化，无法安全撤销这条修改。");
        setAnnounce("正文已变化，无法安全撤销这条修改。");
        return;
      }
    }
    setReviews((rs) =>
      rs.map((r) =>
        r.id === id && (r.status === "accepted" || r.status === "rejected")
          ? { ...r, status: "open" as const, acceptedSnapshot: undefined }
          : r,
      ),
    );
    setSaveState("saving");
  }, [reviews, requestLocked, announceRequestLock]);

  /** 当前查看的聊天节点（消息列表显示它的轮次；上下文回落也用它，见 chatContext） */
  const activeNode = useMemo(
    () => nodes.find((n) => n.id === activeNodeId) ?? null,
    [nodes, activeNodeId],
  );

  // 上下文联动（2026-09-16 反馈修订）：点击侧栏/正文的另一条建议、或在正文里
  // 划出新选区时，聊天视图同步切到该上下文对应的节点——「看什么就聊什么」，
  // 头部标签与消息列表永远一致。该上下文还没有节点 → 清空消息列表显示空态
  // （activeNodeId 置 null，发送时按规则 7/8 现找/现建，节点不提前创建）。
  // 注意只认 selection/selectedId 的变化，不依赖 nodes，避免回复到达等节点更新误触。
  useEffect(() => {
    if (selection && selection.text.trim()) {
      const hit = findNodeByAnchor(latestRef.current.nodes, {
        type: "range",
        blockId: selection.blockId,
        selectedText: selection.text,
      });
      setActiveNodeId(hit?.id ?? null);
      setChatTurns(hit?.turns ?? []);
      return;
    }
    if (selectedId) {
      const hit = findNodeByAnchor(latestRef.current.nodes, {
        type: "review",
        reviewId: selectedId,
      });
      setActiveNodeId(hit?.id ?? null);
      setChatTurns(hit?.turns ?? []);
    }
    // 两者皆空：不动——保持正在查看的节点（chatContext 回退链的 activeNode 一级）
  }, [selection, selectedId]);

  // ── 上下文计算：选区 > 选中建议 > 正在查看的节点 > 全文 ──
  // 规则 11：无选区禁止提问；但选区空了（如点侧栏建议后光标收起）不该直接掉回「全文」——
  // 只要还在某个节点/某条建议的上下文里，就保持它。兜底 document 仅迁移/占位。
  const chatContext: ChatContext = useMemo(() => {
    if (selection && selection.text.trim()) {
      return {
        type: "range",
        blockId: selection.blockId,
        selectedText: selection.text,
      };
    }
    if (selectedId) {
      const item = reviews.find((r) => r.id === selectedId);
      if (item) {
        if (item.scope.type === "block" || item.scope.type === "range") {
          return { type: "review", reviewId: item.id, blockId: item.scope.blockId };
        }
        return { type: "review", reviewId: item.id };
      }
    }
    // 无选区、无选中建议时，沿用正在查看的节点锚点（焦点不丢）
    if (activeNode) return activeNode.anchor;
    return { type: "document" };
  }, [selection, selectedId, reviews, activeNode]);

  /** 规则 11 拦截：无选区且无选中建议时禁止提问（想问全文请自行全选） */
  const chatForbidden = !selection && !selectedId;

  const contextReview = useMemo(
    () =>
      chatContext.type === "review"
        ? reviews.find((r) => r.id === chatContext.reviewId) ?? null
        : null,
    [chatContext, reviews],
  );

  /** 按上下文打包要发送给模型的段落 */
  const packBlocks = useCallback(
    (ctx: ChatContext): Array<{ id: string; text: string }> => {
      if (!doc) return [];
      const all = doc.blocks.map((b) => ({ id: b.id, text: b.text }));
      if (ctx.type === "document") return all;
      const bid = ctx.blockId;
      if (!bid) return all;
      const idx = doc.blocks.findIndex((b) => b.id === bid);
      if (idx < 0) return all;
      // 段落/选区/建议：发送该段 + 相邻段作为上下文
      const from = Math.max(0, idx - 1);
      const to = Math.min(doc.blocks.length, idx + 2);
      return doc.blocks.slice(from, to).map((b) => ({ id: b.id, text: b.text }));
    },
    [doc],
  );

  // ── 对话（节点化：规则 7/8/10/11/24）──
  const sendChat = useCallback(
    async (message: string) => {
      if (!doc) return;
      if (requestLocked) {
        announceRequestLock();
        return;
      }
      // 规则 11：无选区且无选中建议时禁止提问（想问全文请自行全选）
      if (chatForbidden) {
        setChatError("请先选中正文中的词、段落，或选中一条审阅建议，再提问。");
        setAnnounce("提问前请先选中正文或一条建议。");
        return;
      }
      const ctx = chatContext;
      // 规则 8/10：当前上下文 = 有新选区跟新选区，没选区跟正在查看的节点。
      // 发送那一刻才按身份找/建节点（规则 7）。从 latestRef 读最新节点，
      // 避免闭包里的 nodes 是旧快照导致新建节点冲掉已有节点。
      const existing = findNodeByAnchor(latestRef.current.nodes, ctx);
      const nodeId = existing?.id ?? `node_${crypto.randomUUID()}`;
      // 节点锚点原文快照：range 取选区原文；review 锚取建议定位到的原文（range/block 级）
      const anchorReview =
        ctx.type === "review" ? reviews.find((r) => r.id === ctx.reviewId) : undefined;
      const originalText =
        ctx.type === "range"
          ? (ctx.selectedText ?? "")
          : existing?.originalText ??
            (anchorReview?.scope.type === "range" ? anchorReview.scope.original : "");
      const targetNode: ChatNode = existing ?? {
        id: nodeId,
        anchor: ctx,
        originalText,
        createdAt: new Date().toISOString(),
        turns: [],
      };
      const nodeWithUser: ChatNode = {
        ...targetNode,
        turns: [...targetNode.turns, { role: "user", content: message }],
      };
      // 基于 latestRef 先算好再 setState（updater 副作用在批处理下不可靠）：
      // 优先用回调里已写入的最新节点，其次用闭包 nodes
      const baseNodes = latestRef.current.nodes.length ? latestRef.current.nodes : nodes;
      const withUser = baseNodes.some((n) => n.id === nodeId)
        ? baseNodes.map((n) => (n.id === nodeId ? nodeWithUser : n))
        : [...baseNodes, nodeWithUser];
      latestRef.current.nodes = withUser;
      setNodes(withUser);
      activeNodeIdRef.current = nodeId;
      setActiveNodeId(nodeId);
      setChatTurns(nodeWithUser.turns);
      setChatError(null);
      // 触发项目落库（建档时机：发消息即保存，id 在防抖保存里分配）
      setSaveState("saving");

      // 规则 24：节点边界即上下文边界。history 取本节点全部轮次（不含跨节点），
      // blocks 用 packBlocks 取锚点段 ±1 段，建议只带锚点段的 open 建议。
      const history = targetNode.turns
        .map((t) => ({ role: t.role, content: t.content }));
      const blocks = packBlocks(ctx);
      const anchorBlockId =
        ctx.type === "range" || ctx.type === "block"
          ? ctx.blockId
          : anchorReview && anchorReview.scope.type !== "document"
            ? anchorReview.scope.blockId
            : undefined;
      // 规则 24：「范围内未处理建议」= 仅锚点所在段落（blockId 相同）的 open 建议
      const openReviews = anchorBlockId
        ? reviews.filter(
            (r) =>
              r.status === "open" &&
              (r.scope.type === "block" || r.scope.type === "range") &&
              r.scope.blockId === anchorBlockId,
          )
        : [];

      setChatBusy(true);
      chatAbortRef.current?.abort();
      const controller = new AbortController();
      chatAbortRef.current = controller;
      const requestId = ++chatRequestSeq.current;
      const requestDoc = {
        id: doc.id,
        revision: doc.revision,
        checksum: doc.checksum,
      };
      const prefs = settingsToRequestBody(settings);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            documentId: doc.id,
            revision: doc.revision,
            checksum: doc.checksum,
            context: ctx,
            message,
            history,
            blocks,
            openReviews: openReviews.map((r) => ({
              id: r.id,
              title: r.title,
              explanation: r.explanation,
              category: r.category,
            })),
            reviewItem: contextReview
              ? {
                  id: contextReview.id,
                  title: contextReview.title,
                  explanation: contextReview.explanation,
                  category: contextReview.category,
                }
              : undefined,
            language: "en",
            llmConfig: prefs.llmConfig,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error?.message ?? `对话失败（HTTP ${res.status}）`);
        }
        if (chatRequestSeq.current !== requestId) return;
        const current = latestRef.current.doc;
        if (
          !current ||
          current.id !== requestDoc.id ||
          current.revision !== requestDoc.revision ||
          current.checksum !== requestDoc.checksum
        ) {
          throw new Error("正文状态已变化，本次回复未写入。请重新提问。");
        }
        const reply: ChatTurn =
          data.type === "answer_with_changes" && data.changeSet
            ? {
                role: "assistant",
                content: data.answer,
                changeSet: data.changeSet,
              }
            : { role: "assistant", content: data.answer ?? "" };
        const nodeWithReply: ChatNode = {
          ...nodeWithUser,
          turns: [...nodeWithUser.turns, reply],
        };
        // 等回复期间用户可能切走了：只有还停在这个项目上才同步聊天面板，
        // 否则只更新节点列表，不会把别人的轮次贴到当前项目里。
        // 基于 latestRef（含刚加的 user 轮）先算好含回复的数组再 setState，
        // 避免依赖 setNodes updater 的返回值（React 批处理会延后 updater 执行）。
        const repliedNodes = latestRef.current.nodes.map((n) =>
          n.id === nodeId ? nodeWithReply : n,
        );
        latestRef.current.nodes = repliedNodes;
        setNodes(repliedNodes);
        if (activeNodeIdRef.current === nodeId) {
          setChatTurns(nodeWithReply.turns);
        }
        // 回复到达也算活动；立即落库，免得用户在 500ms 防抖窗口内刷新丢掉这轮消息。
        // 显式传含回复的节点：setNodes 里同步的 latestRef 可能被 effect 覆盖回旧快照。
        void persistProjectNow(repliedNodes);
      } catch (e) {
        if (chatRequestSeq.current !== requestId) return;
        if (e instanceof Error && e.name === "AbortError") {
          // 用户取消：不加错误
        } else {
          setChatError(e instanceof Error ? e.message : "对话失败。");
        }
      } finally {
        if (chatRequestSeq.current === requestId) {
          chatAbortRef.current = null;
          setChatBusy(false);
        }
      }
    },
    [
      doc,
      chatContext,
      chatForbidden,
      nodes,
      reviews,
      contextReview,
      packBlocks,
      settings,
      persistProjectNow,
      requestLocked,
      announceRequestLock,
    ],
  );

  /** 规则 12：当前节点锚点是否失效（原文被改/删），复用 canLocateScope 老原则 */
  const anchorStale = useMemo(() => {
    if (!activeNode || !doc) return false;
    const a = activeNode.anchor;
    if (a.type === "document") return false;
    if (a.type === "block") return !canLocateScope(doc, { type: "block", blockId: a.blockId ?? "" });
    if (a.type === "range")
      return !canLocateScope(doc, {
        type: "range",
        blockId: a.blockId ?? "",
        original: a.selectedText ?? "",
      });
    if (a.type === "review") {
      const item = reviews.find((r) => r.id === a.reviewId);
      return item ? !canLocateScope(doc, item.scope) : true;
    }
    return false;
  }, [activeNode, doc, reviews]);

  /** 规则 19：点时间线端点 → 切到该节点对话并滚动到对应轮次 */
  const handleJumpToTurn = useCallback(
    (nodeId: string, turnIndex: number) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      // 时间线明确切到某个节点时，让节点锚点成为唯一上下文，避免旧选区/建议盖过它。
      setSelection(null);
      setSelectedId(null);
      setActiveNodeId(nodeId);
      setChatTurns(node.turns);
      setAnnounce(`已切换到聊天节点。`);
      // 滚动到对应轮次气泡（data-turn-index）。
      // 关键：只在聊天列表容器内部滚（直接设 scrollTop），绝不用 scrollIntoView——
      // 后者是全局的，会把目标对齐到整个视口，连正文所在的 window 一起滚（用户反馈：
      // 点端点正文跟着滚到奇怪位置）。目标轮次定位到列表顶部（留 12px 呼吸边距），
      // 即「这条提问」就是它下面这段对话的开头。测试环境/减少动态效果下瞬时定位。
      requestAnimationFrame(() => {
        const list = document.querySelector(
          '[aria-label="上下文对话"] [data-turn-index]',
        )?.parentElement;
        const target = list?.querySelector(`[data-turn-index="${turnIndex}"]`);
        if (list instanceof HTMLElement && target instanceof HTMLElement) {
          const reduce =
            window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
            navigator.webdriver;
          // 目标轮次顶到列表可视区顶（留 12px 呼吸边距）。
          // 用 rect 差值算「目标相对列表内容的当前偏移」，比 offsetTop 稳
          //（offsetTop 相对 offsetParent，列表容器无 relative 时会错位）。
          const to =
            list.scrollTop +
            (target.getBoundingClientRect().top - list.getBoundingClientRect().top) -
            12;
          if (reduce) {
            list.scrollTop = to;
          } else {
            list.scrollTo({ top: to, behavior: "smooth" });
          }
        }
      });
    },
    [nodes],
  );

  /** 规则 13：时间线行内删除该节点全部讨论（直接删，不弹确认） */
  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      if (requestLocked) {
        announceRequestLock();
        return;
      }
      setNodes((ns) => {
        const next = ns.filter((n) => n.id !== nodeId);
        // 删的是当前查看的节点 → 切到剩余的最新节点或清空
        if (activeNodeId === nodeId) {
          const last = next[next.length - 1];
          setActiveNodeId(last?.id ?? null);
          setChatTurns(last?.turns ?? []);
        }
        return next;
      });
      setSaveState("saving");
      setAnnounce("已删除该节点讨论。");
    },
    [activeNodeId, requestLocked, announceRequestLock],
  );

  /** 阶段 6：点击正文聊天锚点标记 → 切到对应节点对话 */
  const handleSelectChatAnchor = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      // Do not clear selection here: this callback also fires while the user
      // double-clicks an existing anchor to select the same text again.
      // A normal single click collapses the Tiptap selection by itself.
      setSelectedId(null);
      setActiveNodeId(nodeId);
      setChatTurns(node.turns);
      // 若聊天区被最小化，展开以便看到对话
      setChatMinimized(false);
      setAnnounce(`已切换到聊天节点「${node.originalText || "讨论"}」。`);
    },
    [nodes],
  );

  // 打开：挂上预览框（未挂载态）并播进入动画；收起：只关 open 播退出动画，
  // 播完由 ChangeSetPreview 的 onClosed 卸载（延迟卸载，约定 8/15）。
  // 所有关闭路径（接受/放弃/新建/切文章/回复到达新修改集）都走收起，不直接卸载。
  const openChangeSet = useCallback((cs: ChangeSet) => {
    setActiveChangeSet(cs);
    setChangeSetMounted(true);
    setChangeSetOpen(true);
  }, []);
  const closeChangeSet = useCallback(() => setChangeSetOpen(false), []);

  // ── 按意见生成修改集（opinion → ChangeSet）──
  const applyOpinion = useCallback(
    async (id: string) => {
      if (!doc) return;
      if (requestLocked) {
        announceRequestLock();
        return;
      }
      const item = reviews.find((r) => r.id === id);
      if (!item) return;
      // 收窄出 blockId（document 级没有）
      const scopeBlockId =
        item.scope.type === "block" || item.scope.type === "range"
          ? item.scope.blockId
          : undefined;
      setApplyingOpinionId(id);
      setChatError(null);
      const requestId = ++changeSetRequestSeq.current;
      const requestDoc = {
        id: doc.id,
        revision: doc.revision,
        checksum: doc.checksum,
      };
      const prefs = settingsToRequestBody(settings);
      try {
        const res = await fetch("/api/change-set", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            documentId: doc.id,
            revision: doc.revision,
            checksum: doc.checksum,
            sourceReview: {
              id: item.id,
              title: item.title,
              explanation: item.explanation,
              category: item.category,
              scope:
                item.scope.type === "document"
                  ? { type: "document" }
                  : { type: item.scope.type, blockId: scopeBlockId },
            },
            blocks:
              item.scope.type === "document"
                ? doc.blocks.map((b) => ({ id: b.id, text: b.text }))
                : packBlocks({ type: "review", reviewId: id, blockId: scopeBlockId }),
            language: "en",
            llmConfig: prefs.llmConfig,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error?.message ?? `生成修改失败（HTTP ${res.status}）`);
        }
        if (changeSetRequestSeq.current !== requestId) return;
        const current = latestRef.current.doc;
        if (
          !current ||
          current.id !== requestDoc.id ||
          current.revision !== requestDoc.revision ||
          current.checksum !== requestDoc.checksum ||
          data.changeSet?.documentRevision !== requestDoc.revision
        ) {
          throw new Error("正文状态已变化，本次修改集未打开。请重新生成。");
        }
        openChangeSet(data.changeSet as ChangeSet);
      } catch (e) {
        if (changeSetRequestSeq.current !== requestId) return;
        setChatError(e instanceof Error ? e.message : "生成修改集失败。");
      } finally {
        if (changeSetRequestSeq.current === requestId) setApplyingOpinionId(null);
      }
    },
    [
      doc,
      reviews,
      packBlocks,
      settings,
      openChangeSet,
      requestLocked,
      announceRequestLock,
    ],
  );

  // ── 修改集：接受选中 / 放弃 ──
  const acceptChangeSet = useCallback(
    (editIds: string[]) => {
      if (requestLocked) {
        announceRequestLock();
        return;
      }
      if (!doc || !activeChangeSet) return;
      const subset: ChangeSet = {
        ...activeChangeSet,
        edits: activeChangeSet.edits.filter((e) => editIds.includes(e.id)),
      };
      const { newTextByBlock } = computeChangeSetApplication(doc, subset);
      if (newTextByBlock.size === 0) return;
      editorRef.current?.applyBlockTexts(newTextByBlock);
      // 与源意见关联：接受后把该意见标记为 accepted
      if (activeChangeSet.sourceReviewId) {
        const sid = activeChangeSet.sourceReviewId;
        setReviews((rs) =>
          rs.map((r) =>
            r.id === sid ? { ...r, status: "accepted" as const } : r,
          ),
        );
      }
      closeChangeSet();
    },
    [
      doc,
      activeChangeSet,
      closeChangeSet,
      requestLocked,
      announceRequestLock,
    ],
  );

  const discardChangeSet = useCallback(() => closeChangeSet(), [closeChangeSet]);

  // ── 复制全文 / 清空当前项目 / 清空全部数据 ──
  const copyAll = useCallback(async () => {
    if (!doc) return;
    const text = doc.blocks.map((b) => b.text).join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1500);
    } catch {
      setChatError("复制失败，请检查浏览器剪贴板权限。");
    }
  }, [doc]);

  const clearCurrentProject = useCallback(async () => {
    if (requestLocked) {
      announceRequestLock();
      return;
    }
    if (
      !window.confirm(
        "确定要清空当前项目吗？标题、正文、审阅建议和对话记录都会被清除，其他历史项目不受影响。此操作不可撤销。",
      )
    ) {
      return;
    }

    const curId = latestRef.current.activeProjId;
    const blankDoc = createDocument("", [""]);
    // 先同步推进 ref：若当前项目已经建档，下面的立即落库必须读到清空后的现场，
    // 不能等 React effect，否则可能把清空前的正文重新写回。
    latestRef.current = {
      doc: blankDoc,
      reviews: [],
      nodes: [],
      activeProjId: curId,
    };
    setDoc(blankDoc);
    setReviews([]);
    setNodes([]);
    setActiveNodeId(null);
    setChatTurns([]);
    setSelection(null);
    setSelectedId(null);
    setChatError(null);
    setChangeSetOpen(false);
    setReviewUi({ phase: "idle" });

    if (curId) {
      setSaveState("saving");
      await persistProjectNow();
    } else {
      // 尚未建档的现场只需重置，不为一个空白项目额外创建历史条目。
      activeProjRef.current = null;
      setSaveState("idle");
    }
    setAnnounce("已清空当前项目，其他历史项目未受影响。");
  }, [requestLocked, announceRequestLock, persistProjectNow]);

  const clearAll = useCallback(async () => {
    if (requestLocked) {
      announceRequestLock();
      return;
    }
    if (!window.confirm("确定要清空本地保存的草稿与数据吗？当前编辑器内容也会被重置。")) {
      return;
    }
    await clearAllProjects();
    const { doc: d } = buildSampleDocument();
    setDoc(d);
    setReviews([]);
    setNodes([]);
    setActiveNodeId(null);
    setChatTurns([]);
    setSelection(null);
    setProjects([]);
    projectsRef.current = [];
    activeProjRef.current = null;
    setActiveProjId(null);
    setChangeSetOpen(false);
    setSelectedId(null);
    setReviewUi({ phase: "idle" });
    setSaveState("saving");
  }, [requestLocked, announceRequestLock]);

  const loadSample = useCallback(() => {
    if (requestLocked) {
      announceRequestLock();
      return;
    }
    const { doc: d } = buildSampleDocument();
    setDoc(d);
    setReviews(buildSampleReview(d));
    setNodes([]);
    setActiveNodeId(null);
    setChatTurns([]);
    setSelection(null);
    setSelectedId(null);
    setChatError(null);
    setChangeSetOpen(false);
    setReviewUi({ phase: "idle" });
    setSaveState("saving");
  }, [requestLocked, announceRequestLock]);

  const openCount = useMemo(
    () => reviews.filter((r) => r.status === "open").length,
    [reviews],
  );

  // ── 键盘快捷键（阶段 6）──
  // Cmd/Ctrl+Enter：开始审阅；Cmd/Ctrl+Shift+C：复制全文。
  // 在输入类控件聚焦时不拦截 Cmd+Enter，避免和对话输入冲突。
  useEffect(() => {
    const isTextEntry = (el: EventTarget | null) => {
      const node = el as HTMLElement | null;
      if (!node || typeof node.tagName !== "string") return false;
      return (
        node.tagName === "INPUT" ||
        node.tagName === "TEXTAREA" ||
        node.tagName === "SELECT" ||
        node.isContentEditable
      );
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      if (e.shiftKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        void copyAll();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && !isTextEntry(e.target)) {
        if (reviewUi.phase === "loading") return;
        e.preventDefault();
        void runReview();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [runReview, copyAll, reviewUi.phase]);

  if (!doc) {
    return (
      <main className="flex min-h-screen items-center justify-center text-text-muted">
        正在载入草稿…
      </main>
    );
  }

  const loading = reviewUi.phase === "loading";

  return (
    // w-full 不可省：body 是 flex 列容器，交叉轴上的 auto 边距会让本元素按
    // fit-content 定宽（由内容撑开），正文一短整页就跟着变窄。
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-6 2xl:max-w-[1400px]">
      {/* 顶栏 */}
      <header className="mb-5 flex flex-wrap items-center gap-3 xl:grid xl:min-w-[1398px] xl:grid-cols-[15rem_1.5rem_minmax(0,1fr)_auto_minmax(0,1fr)_1.5rem_360px] xl:gap-0">
        {/* 窄屏才出现的「三条横线」：拉出左侧历史记录抽屉（宽屏有常驻左栏） */}
        <ChatHistoryToggle
          open={historyOpen}
          onClick={() => setHistoryOpen((v) => !v)}
        />
        {/* xl 下 wrapper 参与网格而 input 不直接参与轨道固有尺寸计算：长标题不会
            挤偏正文左右两个 1fr 半区，操作组因此始终钉在正文中心。 */}
        <div className="min-w-24 flex-1 xl:col-start-1 xl:col-end-4 xl:row-start-1 xl:mr-3 xl:min-w-0 xl:[contain:inline-size]">
          <input
            value={doc.title}
            disabled={requestLocked}
            title={requestLocked ? "请求处理中，请等待完成后再修改标题" : undefined}
            // 改标题也是一次内容编辑：必须同样置 saving（否则防抖保存不触发，
            // 标题既不落库、也不算「活动」——改完刷新就丢，且不会把文章置顶）。
            // 不走 handleDocChange 是为了跳过多余的锚点校验：标题不参与 block 定位。
            onChange={(e) => {
              setDoc({ ...doc, title: e.target.value });
              setSaveState("saving");
            }}
            className="w-full min-w-0 rounded-lg border border-transparent bg-transparent px-2 py-1 text-lg font-semibold tracking-tight transition-colors hover:border-border focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-ring"
            aria-label="文档标题"
          />
        </div>
        <div
          role="group"
          aria-label="文档操作"
          className="flex max-w-full shrink-0 flex-wrap items-center justify-center gap-3 xl:col-start-4 xl:row-start-1"
        >
          <label className="flex items-center gap-1.5 text-xs text-text-muted">
            审阅模式
            <Select
              value={mode}
              onChange={(v) => setMode(v as ReviewMode)}
              options={(Object.keys(MODE_LABEL) as ReviewMode[]).map((m) => ({
                value: m,
                label: MODE_LABEL[m],
              }))}
              ariaLabel="审阅模式"
              className="w-28"
            />
          </label>

          {loading ? (
            <button
              type="button"
              onClick={cancelReview}
              className={buttonClass("danger", "sm")}
            >
              取消审阅
            </button>
          ) : (
            <button
              type="button"
              onClick={runReview}
              disabled={requestLocked}
              title="开始审阅（Cmd/Ctrl+Enter）"
              className={buttonClass("primary", "sm")}
            >
              开始审阅
            </button>
          )}

          <button
            type="button"
            onClick={copyAll}
            title="复制全文（Cmd/Ctrl+Shift+C）"
            className={buttonClass("secondary", "sm")}
          >
            {copyState === "copied" ? "已复制 ✓" : "复制全文"}
          </button>

          <button
            type="button"
            onClick={() => void clearCurrentProject()}
            disabled={requestLocked}
            title={requestLocked ? "请求处理中，请等待完成后再清空项目" : "清空当前项目"}
            className={buttonClass("secondary", "sm")}
          >
            清空项目
          </button>
        </div>

        <div className="ml-auto flex items-center gap-3 text-xs text-text-faint xl:col-start-7 xl:row-start-1 xl:ml-0 xl:justify-self-end">
          <span className="rounded-full bg-brand-soft px-2.5 py-1 font-medium text-brand lg:hidden">
            {openCount} 条待处理
          </span>
          <span role="status" className="transition-opacity duration-300">
            {saveState === "saving"
              ? "保存中…"
              : saveState === "saved"
                ? "已保存到本地"
                : ""}
          </span>
        </div>
      </header>

      {/* 审阅状态条 */}
      {reviewUi.phase === "loading" && (
        <p className="animate-item-in mb-4 flex items-center gap-2 rounded-xl border border-brand-ring bg-brand-soft px-4 py-2.5 text-sm text-brand" role="status">
          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand border-t-transparent" aria-hidden />
          正在审阅文档…（LLM 生成中，可点击“取消审阅”）
        </p>
      )}
      {reviewUi.phase === "error" && (
        <p className="animate-item-in mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">
          {reviewUi.message}
        </p>
      )}
      {reviewUi.phase === "done" && reviewUi.summary && (
        <p
          ref={summaryRef}
          className="animate-item-in mb-4 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-text-muted shadow-sm"
        >
          <span className="font-medium text-foreground">全文总结：</span>
          {reviewUi.summary}
        </p>
      )}

      {/*
        三栏行：历史记录（xl 起常驻） | 编辑器+对话 | 审阅侧栏。
        外层用 items-start，让左栏的 sticky 贴合行首；历史栏自带 shrink-0，
        所以 1fr 的中间列不会因它而失稳。
      */}
      <div className="flex flex-1 items-start gap-6">
        <ChatHistory
          projects={projects}
          activeId={activeProjId}
          onSelect={handleSelectProject}
          onNew={handleNewProject}
          onDelete={handleDeleteProject}
          onReorder={handleReorderProjects}
          justCreatedId={justCreatedId}
          onCreatedShown={() => setJustCreatedId(null)}
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          interactionLocked={requestLocked}
        />

        <div className="grid min-w-0 flex-1 grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(750px,1fr)_360px]">
          <div className="flex min-w-0 flex-col gap-4">
            <DocumentEditor
              ref={editorRef}
              document={doc}
              onDocumentChange={handleDocChange}
              reviewItems={reviews}
              selectedReviewId={selectedId}
              onSelectReview={handleBodySelectAnchor}
              onSelectionChange={setSelection}
              chatNodes={nodes}
              onSelectChatAnchor={handleSelectChatAnchor}
              readOnly={requestLocked}
            />

            {/* 修改集预览（对话或按意见生成时弹出）。常驻渲染：open 驱动进/出动画，
                退出动画播完由 onClosed 卸载（延迟卸载，约定 8/15） */}
            {changeSetMounted && activeChangeSet && (
              <ChangeSetPreview
                changeSet={activeChangeSet}
                document={doc}
                open={changeSetOpen}
                onClosed={() => setChangeSetMounted(false)}
                onAccept={acceptChangeSet}
                onDiscard={discardChangeSet}
              />
            )}

            {/* 上下文对话 */}
            {chatError && (
              <p className="animate-item-in rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">
                {chatError}
              </p>
            )}
            {/*
              聊天区浮动（规则 21 sticky-dock）：position sticky bottom 让它在文档流中
              自然吸附——上滑至聊天区即将滚出视口时整个吸附到视口底部，回滚归位。
              纯 CSS 无 JS 抖动；居中于内容列、左右留白天然避开左下两个 fixed 按钮。
              z-40 低于设置模态 z-50；reduced-motion 下 sticky 无位移动画。
            */}
            <div className="sticky bottom-4 z-40">
              <ContextChat
                context={chatContext}
                contextReview={contextReview}
                nodes={nodes}
                activeNode={activeNode}
                anchorStale={anchorStale}
                turns={chatTurns}
                busy={chatBusy}
                sendDisabled={chatForbidden || requestLocked}
                minimized={chatMinimized}
                onToggleMinimize={() => setChatMinimized((v) => !v)}
                onSend={sendChat}
                onPreviewChangeSet={openChangeSet}
                panelHeight={chatHeight}
                onResize={handleChatResize}
                onJumpToTurn={handleJumpToTurn}
                onDeleteNode={handleDeleteNode}
              />
            </div>
          </div>

          {/* sticky + 定高：侧栏独立于主区滚动，钉在视口顶部。
              必须用 h- 而不是 max-h-：grid 子项默认 stretch，max-h 无法约束
              子元素 aside 的内容高度，内部 overflow-y-auto 就不会真正滚动。
              高度用 calc(100vh-6.5rem) 而不是 -3rem：侧栏 sticky top-6 上方还有顶栏
              （实测约 82px），静止时它的顶不在视口顶，-3rem 会让底边越出视口约 34px。 */}
          <div className="sticky top-6 h-[calc(100vh-6.5rem)]">
            <ReviewSidebar
              items={reviews}
              selectedId={selectedId}
              anchorTop={anchorTop}
              onSelect={handleSelect}
              onAccept={handleAccept}
              onReject={handleReject}
              onRevert={handleRevert}
              onChat={handleSelect}
              onApplyOpinion={applyOpinion}
              applyingOpinionId={applyingOpinionId}
              interactionLocked={requestLocked}
            />
          </div>
        </div>
      </div>

      {/*
        左下角常驻两个 fixed 浮动按钮（设置 bottom-16、主题切换 bottom-4，均 left-4，
        占视口 x=16..56 这条竖带）。页脚是文档最后的内容，滚到底时正落在这一带里，
        所以页脚整体让出左侧（pl-12 → 与按钮留 16px 间隙）。按钮常年占位，这个让位也
        就常年有效，不要改成只在某个断点生效——中宽视口（768–1360px）内容区贴左，
        恰恰是最容易撞上的区间。
      */}
      <footer className="mt-4 space-y-1 pl-12 text-xs text-text-faint">
        {/* 屏幕阅读器播报：定位、快捷键与审阅结果 */}
        <p className="sr-only" role="status" aria-live="polite">
          {announce}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[11px] text-text-muted">
            {APP_VERSION}
          </span>
          <span>{doc.blocks.length} 段</span>
        </p>
        <p>
          隐私说明：点击“开始审阅”或“发送”后，相关文档内容会发送至当前配置的 LLM
          供应商（在设置面板中选择；未配置时使用服务端默认配置）用于生成结果。文档草稿与你在设置里填写的
          API Key 都只保存在本浏览器本地，不会上传到本服务之外的服务器。
        </p>
      </footer>

      {/* 设置按钮（在主题切换上方） */}
      <button
        type="button"
        onClick={() => setSettingsOpen((v) => !v)}
        aria-label="设置"
        title="设置"
        className="fixed bottom-16 left-4 z-50 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface/90 shadow-md backdrop-blur-sm transition-all duration-150 hover:bg-surface-muted hover:shadow-lg"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-text-muted"
        >
          <line x1="4" y1="21" x2="4" y2="14" />
          <line x1="4" y1="10" x2="4" y2="3" />
          <line x1="12" y1="21" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12" y2="3" />
          <line x1="20" y1="21" x2="20" y2="16" />
          <line x1="20" y1="12" x2="20" y2="3" />
          <line x1="1" y1="14" x2="7" y2="14" />
          <line x1="9" y1="8" x2="15" y2="8" />
          <line x1="17" y1="16" x2="23" y2="16" />
        </svg>
      </button>

      <ThemeToggle />

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onSettingsChange={handleSettingsChange}
        onLoadSample={loadSample}
        onClearAll={clearAll}
        dataActionsLocked={requestLocked}
      />
    </main>
  );
}

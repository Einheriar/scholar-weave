import { act, fireEvent, render, screen } from "@testing-library/react";
import { type ComponentProps, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentEditorHandle } from "@/components/editor/DocumentEditor";
import type { ChatHistoryProps } from "@/components/chat/ChatHistory";
import type { ContextChatProps } from "@/components/chat/ContextChat";
import type { ChatNode, DocumentState, Project } from "@/lib/review-schema";
import type { ChatRequest } from "@/lib/llm/chat-llm-schema";
import Home from "@/app/page";

type EditorProps = ComponentProps<
  typeof import("@/components/editor/DocumentEditor").DocumentEditor
>;
type ReviewProps = ComponentProps<
  typeof import("@/components/review/ReviewSidebar").ReviewSidebar
>;

const captured = vi.hoisted(() => ({
  editor: null as EditorProps | null,
  history: null as ChatHistoryProps | null,
  review: null as ReviewProps | null,
  chat: null as ContextChatProps | null,
}));

const storage = vi.hoisted(() => ({
  loadLatestProject: vi.fn<() => Promise<Project | undefined>>(),
  listProjects: vi.fn<() => Promise<Project[]>>(),
  saveProject: vi.fn<(project: Project) => Promise<void>>(),
  saveProjects: vi.fn<(projects: Project[]) => Promise<void>>(),
  deleteProject: vi.fn<(id: string) => Promise<void>>(),
  clearAllProjects: vi.fn<() => Promise<void>>(),
}));

vi.mock("@/lib/storage/projects", () => storage);

vi.mock("@/components/editor/DocumentEditor", async () => {
  const React = await import("react");
  const MockDocumentEditor = React.forwardRef<DocumentEditorHandle, EditorProps>(
    function MockDocumentEditor(props) {
      captured.editor = props;
      return React.createElement("div", { "data-testid": "document-editor" });
    },
  );
  return { DocumentEditor: MockDocumentEditor };
});

vi.mock("@/components/chat/ChatHistory", () => ({
  ChatHistory: (props: ChatHistoryProps) => {
    captured.history = props;
    return <div data-testid="chat-history" />;
  },
  ChatHistoryToggle: () => null,
}));

vi.mock("@/components/review/ReviewSidebar", () => ({
  ReviewSidebar: (props: ReviewProps) => {
    captured.review = props;
    return null;
  },
}));

vi.mock("@/components/review/ChangeSetPreview", () => ({
  ChangeSetPreview: () => null,
}));

vi.mock("@/components/chat/ContextChat", () => ({
  ContextChat: (props: ContextChatProps) => {
    captured.chat = props;
    return null;
  },
}));

vi.mock("@/components/SettingsPanel", () => ({
  SettingsPanel: () => null,
}));

vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/ui/select", () => ({ Select: () => null }));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function makeDocument(id: string, text: string, title: string): DocumentState {
  return {
    id,
    title,
    blocks: [{ id: `${id}-block`, type: "paragraph", text }],
    revision: 0,
    checksum: `${id}-checksum`,
    updatedAt: "2026-09-19T00:00:00.000Z",
  };
}

function makeProject(id: string, text: string, title = id): Project {
  return {
    id,
    title,
    doc: makeDocument(`${id}-doc`, text, title),
    reviews: [],
    nodes: [],
    lastActivityAt: "2026-09-19T00:00:00.000Z",
    order: id === "a" ? 0 : 1,
  };
}

function changedDocument(doc: DocumentState, text: string): DocumentState {
  return {
    ...doc,
    blocks: [{ ...doc.blocks[0], text }],
    revision: doc.revision + 1,
    updatedAt: "2026-09-19T00:01:00.000Z",
  };
}

async function settleInitialLoad() {
  await act(async () => {
    await Promise.resolve();
  });
  expect(captured.editor).not.toBeNull();
}

async function editBody(text: string) {
  await act(async () => {
    captured.editor!.onDocumentChange(changedDocument(captured.editor!.document, text));
  });
}

async function advanceDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
}

function deferredSave() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function configureProjects(projects: Project[]) {
  storage.loadLatestProject.mockResolvedValue(projects[0]);
  storage.listProjects.mockResolvedValue(projects);
  storage.saveProject.mockResolvedValue(undefined);
  storage.saveProjects.mockResolvedValue(undefined);
  storage.deleteProject.mockResolvedValue(undefined);
  storage.clearAllProjects.mockResolvedValue(undefined);
}

function projectWithRangeHistory(): Project {
  const project = makeProject("a", "Current prefix target phrase current suffix.");
  const oldParagraph = "Historic prefix target phrase historic suffix.";
  const node: ChatNode = {
    id: "range-discussion",
    anchor: { type: "range", blockId: project.doc.blocks[0].id, selectedText: "target phrase" },
    rangeLocator: {
      start: oldParagraph.indexOf("target phrase"),
      end: oldParagraph.indexOf("target phrase") + "target phrase".length,
      prefix: "Historic prefix ", suffix: " historic suffix.", blockText: oldParagraph,
    },
    originalText: "target phrase",
    createdAt: "2026-09-19T00:00:00.000Z",
    turns: [
      { role: "user", content: "Earlier question" },
      { role: "assistant", content: "Earlier answer" },
    ],
  };
  project.nodes = [node, {
    id: "unrelated-discussion", anchor: { type: "document" }, originalText: "",
    createdAt: node.createdAt, turns: [{ role: "user", content: "Unrelated discussion" }],
  }];
  return project;
}

function captureChatRequests() {
  const requests: ChatRequest[] = [];
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    expect(input).toBe("/api/chat");
    expect(typeof init?.body).toBe("string");
    requests.push(JSON.parse(String(init?.body)) as ChatRequest);
    return new Response(JSON.stringify({ type: "answer", answer: "Follow-up answer" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { requests, fetchMock };
}

describe("project autosave integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    captured.editor = null;
    captured.history = null;
    captured.review = null;
    captured.chat = null;
    storage.loadLatestProject.mockReset();
    storage.listProjects.mockReset();
    storage.saveProject.mockReset();
    storage.saveProjects.mockReset();
    storage.deleteProject.mockReset();
    storage.clearAllProjects.mockReset();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("clicking the current project preserves unsaved body and title and saves them", async () => {
    const project = makeProject("a", "original", "Original title");
    configureProjects([project]);
    render(<Home />);
    await settleInitialLoad();

    await act(async () => {
      captured.editor!.onDocumentChange(changedDocument(captured.editor!.document, "edited body"));
    });
    fireEvent.change(screen.getByRole("textbox", { name: "文档标题" }), {
      target: { value: "Edited title" },
    });
    await act(async () => {
      captured.history!.onSelect("a");
    });
    expect(captured.editor!.document.blocks[0].text).toBe("edited body");
    expect(screen.getByRole("textbox", { name: "文档标题" })).toHaveValue("Edited title");
    expect(storage.saveProject).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(storage.saveProject).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "a",
        doc: expect.objectContaining({
          title: "Edited title",
          blocks: [expect.objectContaining({ text: "edited body" })],
        }),
      }),
    );
  });

  it("a previous pending save cannot cancel the debounce for a later edit", async () => {
    const project = makeProject("a", "original");
    configureProjects([project]);
    const firstSave = deferredSave();
    storage.saveProject.mockImplementationOnce(() => firstSave.promise);
    render(<Home />);
    await settleInitialLoad();

    await editBody("version one");
    await advanceDebounce();
    expect(storage.saveProject).toHaveBeenCalledTimes(1);

    await act(async () => {
      captured.editor!.onDocumentChange(changedDocument(captured.editor!.document, "version two"));
      firstSave.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("保存中…")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(storage.saveProject).toHaveBeenCalledTimes(2);
    expect(storage.saveProject.mock.calls[1][0].doc.blocks[0].text).toBe("version two");
    expect(screen.getByText("已保存到本地")).toBeInTheDocument();
  });

  it("manual save persists the latest draft before the debounce elapses", async () => {
    const project = makeProject("a", "original");
    configureProjects([project]);
    render(<Home />);
    await settleInitialLoad();

    await editBody("manual draft");
    const saveButton = screen.getByRole("button", { name: "保存到本地" });
    expect(saveButton).not.toBeDisabled();
    expect(saveButton).toHaveAttribute("aria-busy", "true");

    await act(async () => {
      fireEvent.click(saveButton);
      await Promise.resolve();
    });
    expect(storage.saveProject).toHaveBeenCalledTimes(1);
    expect(storage.saveProject.mock.calls[0][0].doc.blocks[0].text).toBe("manual draft");

    expect(saveButton).toBeDisabled();
    expect(saveButton).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("保存中…")).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(499);
      fireEvent.click(saveButton);
    });
    expect(saveButton).toBeDisabled();
    expect(storage.saveProject).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(saveButton).not.toBeDisabled();
    expect(saveButton).toHaveAttribute("aria-busy", "false");
    expect(screen.getByText("已保存到本地")).toBeVisible();
    expect(storage.saveProject).toHaveBeenCalledTimes(1);
  });

  it("manual save pauses the pending debounce while its write is in flight", async () => {
    const project = makeProject("a", "original");
    configureProjects([project]);
    const pendingSave = deferredSave();
    storage.saveProject.mockImplementationOnce(() => pendingSave.promise);
    render(<Home />);
    await settleInitialLoad();

    await editBody("manual draft");
    const saveButton = screen.getByRole("button", { name: "保存到本地" });
    await act(async () => {
      fireEvent.click(saveButton);
      await Promise.resolve();
    });
    expect(storage.saveProject).toHaveBeenCalledTimes(1);
    expect(saveButton).toBeDisabled();
    expect(saveButton).toHaveAttribute("aria-busy", "true");

    await advanceDebounce();
    expect(storage.saveProject).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingSave.resolve();
      await Promise.resolve();
    });
    expect(saveButton).not.toBeDisabled();
  });

  it("an edit made during manual save still gets a later automatic save", async () => {
    const project = makeProject("a", "original");
    configureProjects([project]);
    const pendingSave = deferredSave();
    storage.saveProject.mockImplementationOnce(() => pendingSave.promise);
    render(<Home />);
    await settleInitialLoad();

    await editBody("manual draft");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "保存到本地" }));
      await Promise.resolve();
    });
    expect(storage.saveProject).toHaveBeenCalledTimes(1);

    await editBody("later edit");
    await advanceDebounce();
    await act(async () => {
      pendingSave.resolve();
      await Promise.resolve();
    });
    await advanceDebounce();

    expect(storage.saveProject).toHaveBeenCalledTimes(2);
    expect(storage.saveProject.mock.calls[1][0].doc.blocks[0].text).toBe("later edit");
  });

  it("an old project save completing after a switch cannot cancel the new project's save", async () => {
    const projectA = makeProject("a", "A");
    const projectB = makeProject("b", "B");
    configureProjects([projectA, projectB]);
    const resolvers: Array<() => void> = [];
    storage.saveProject.mockImplementation(async () => {
      await new Promise<void>((resolve) => resolvers.push(resolve));
    });
    render(<Home />);
    await settleInitialLoad();

    await editBody("A edited");
    await advanceDebounce();
    expect(storage.saveProject).toHaveBeenCalledTimes(1);

    await act(async () => {
      captured.history!.onSelect("b");
    });
    await act(async () => {
      captured.editor!.onDocumentChange(changedDocument(captured.editor!.document, "B edited"));
    });
    expect(storage.saveProject).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolvers[0]();
      await Promise.resolve();
    });
    expect(screen.getByText("保存中…")).toBeInTheDocument();
    await advanceDebounce();

    expect(storage.saveProject).toHaveBeenCalledTimes(3);
    expect(storage.saveProject.mock.calls[2][0].id).toBe("b");
    expect(storage.saveProject.mock.calls[2][0].doc.blocks[0].text).toBe("B edited");
    await act(async () => { resolvers[1](); resolvers[2](); });
    expect(screen.getByText("已保存到本地")).toBeInTheDocument();
  });

  it("creates and saves a project on the first edit when no project exists", async () => {
    configureProjects([]);
    render(<Home />);
    await settleInitialLoad();

    await editBody("first edit");
    await advanceDebounce();

    expect(storage.saveProject).toHaveBeenCalledTimes(1);
    expect(storage.saveProject.mock.calls[0][0].id).toMatch(/^proj_/);
    expect(storage.saveProject.mock.calls[0][0].doc.blocks[0].text).toBe("first edit");
    expect(screen.getByText("已保存到本地")).toBeInTheDocument();
    const projectId = storage.saveProject.mock.calls[0][0].id;
    await advanceDebounce();
    expect(storage.saveProject).toHaveBeenCalledTimes(1);
    await editBody("second edit");
    await advanceDebounce();
    expect(storage.saveProject.mock.calls[1][0].id).toBe(projectId);
    expect(captured.history!.projects).toHaveLength(1);
  });

  it("a review status change stays pending when an earlier body save finishes", async () => {
    const project = makeProject("a", "original");
    project.reviews = [{
      id: "opinion", documentRevision: 0, scope: { type: "document" },
      kind: "opinion", category: "clarity", severity: "suggestion",
      title: "Clarify", explanation: "Add context", status: "open",
    }];
    configureProjects([project]);
    const firstSave = deferredSave();
    storage.saveProject.mockImplementationOnce(() => firstSave.promise);
    render(<Home />);
    await settleInitialLoad();
    await editBody("edited");
    await advanceDebounce();
    await act(async () => {
      captured.review!.onReject("opinion");
      firstSave.resolve();
    });
    expect(screen.getByText("保存中…")).toBeInTheDocument();
    await advanceDebounce();
    expect(storage.saveProject).toHaveBeenCalledTimes(2);
    expect(storage.saveProject.mock.calls[1][0].reviews[0].status).toBe("rejected");
    expect(screen.getByText("已保存到本地")).toBeInTheDocument();
  });

  it("out-of-order save completion cannot cancel a third pending edit", async () => {
    configureProjects([makeProject("a", "original")]);
    const firstSave = deferredSave();
    const secondSave = deferredSave();
    storage.saveProject
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise);
    render(<Home />);
    await settleInitialLoad();
    await editBody("version one");
    await advanceDebounce();
    await editBody("version two");
    await advanceDebounce();
    await act(async () => { secondSave.resolve(); });
    expect(screen.getByText("已保存到本地")).toBeInTheDocument();
    await editBody("version three");
    await act(async () => { firstSave.resolve(); });
    expect(screen.getByText("保存中…")).toBeInTheDocument();
    await advanceDebounce();
    expect(storage.saveProject).toHaveBeenCalledTimes(3);
    expect(storage.saveProject.mock.calls[2][0].doc.blocks[0].text).toBe("version three");
    expect(screen.getByText("已保存到本地")).toBeInTheDocument();
  });

  it("deleting the current project cancels its unsaved draft without recreating it", async () => {
    configureProjects([makeProject("a", "original")]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Home />);
    await settleInitialLoad();
    await editBody("unsaved edit");

    await act(async () => { captured.history!.onDelete("a"); });

    expect(storage.deleteProject).toHaveBeenCalledWith("a");
    expect(captured.editor!.document.blocks.every((block) => block.text === "")).toBe(true);
    expect(screen.getByRole("textbox", { name: "文档标题" })).toHaveValue("");
    expect(captured.history!.activeId).toBeNull();
    expect(captured.history!.projects).toHaveLength(0);
    await advanceDebounce();
    await advanceDebounce();
    expect(storage.saveProject).not.toHaveBeenCalled();
    expect(captured.history!.projects).toHaveLength(0);
  });

  it("waits for an in-flight save before deleting so its completion cannot restore the project", async () => {
    configureProjects([makeProject("a", "original")]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const pendingSave = deferredSave();
    const stored = new Map<string, Project>();
    storage.saveProject.mockImplementation(async (project) => {
      await pendingSave.promise;
      stored.set(project.id, project);
    });
    storage.deleteProject.mockImplementation(async (id) => { stored.delete(id); });
    render(<Home />);
    await settleInitialLoad();
    await editBody("saving edit");
    await advanceDebounce();
    expect(storage.saveProject).toHaveBeenCalledTimes(1);

    await act(async () => { captured.history!.onDelete("a"); });
    expect(storage.deleteProject).not.toHaveBeenCalled();
    await advanceDebounce();
    expect(storage.saveProject).toHaveBeenCalledTimes(1);

    await act(async () => { pendingSave.resolve(); });
    expect(storage.deleteProject).toHaveBeenCalledWith("a");
    expect(stored.has("a")).toBe(false);
    expect(captured.history!.activeId).toBeNull();
    expect(captured.history!.projects).toHaveLength(0);
    expect(captured.editor!.document.blocks.every((block) => block.text === "")).toBe(true);
    await advanceDebounce();
    expect(storage.saveProject).toHaveBeenCalledTimes(1);
    expect(stored.size).toBe(0);
  });

  it("does not autosave while deletion itself takes longer than the debounce", async () => {
    configureProjects([makeProject("a", "original")]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const pendingDelete = deferredSave();
    storage.deleteProject.mockImplementationOnce(() => pendingDelete.promise);
    render(<Home />);
    await settleInitialLoad();
    await editBody("unsaved edit");

    await act(async () => { captured.history!.onDelete("a"); });
    expect(storage.deleteProject).toHaveBeenCalledTimes(1);
    await advanceDebounce();
    await advanceDebounce();
    expect(storage.saveProject).not.toHaveBeenCalled();

    await act(async () => { pendingDelete.resolve(); });
    await advanceDebounce();
    expect(storage.saveProject).not.toHaveBeenCalled();
    expect(captured.history!.activeId).toBeNull();
    expect(captured.history!.projects).toHaveLength(0);
  });

  it("cancelling deletion keeps the edit and its normal autosave", async () => {
    configureProjects([makeProject("a", "original")]);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Home />);
    await settleInitialLoad();
    await editBody("unsaved edit");

    await act(async () => { captured.history!.onDelete("a"); });
    expect(storage.deleteProject).not.toHaveBeenCalled();
    expect(captured.history!.activeId).toBe("a");
    expect(captured.editor!.document.blocks[0].text).toBe("unsaved edit");
    await advanceDebounce();
    expect(storage.saveProject).toHaveBeenCalledTimes(1);
    expect(storage.saveProject.mock.calls[0][0].id).toBe("a");
    expect(storage.saveProject.mock.calls[0][0].doc.blocks[0].text).toBe("unsaved edit");
    expect(screen.getByText("已保存到本地")).toBeInTheDocument();
  });

  it("deleting another project preserves the current draft and pending autosave", async () => {
    configureProjects([makeProject("a", "original"), makeProject("b", "other")]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Home />);
    await settleInitialLoad();
    await editBody("unsaved edit");

    await act(async () => { captured.history!.onDelete("b"); });
    expect(storage.deleteProject).toHaveBeenCalledWith("b");
    expect(captured.history!.activeId).toBe("a");
    expect(captured.history!.projects.map((project) => project.id)).toEqual(["a"]);
    expect(captured.editor!.document.blocks[0].text).toBe("unsaved edit");
    await advanceDebounce();
    expect(storage.saveProject).toHaveBeenCalledTimes(1);
    expect(storage.saveProject.mock.calls[0][0].id).toBe("a");
    expect(storage.saveProject.mock.calls[0][0].doc.blocks[0].text).toBe("unsaved edit");
    expect(screen.getByText("已保存到本地")).toBeInTheDocument();
  });

  it("a failed deletion reports the error, restores autosave and allows further edits", async () => {
    configureProjects([makeProject("a", "original")]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    storage.deleteProject.mockRejectedValueOnce(new Error("storage unavailable"));
    render(<Home />);
    await settleInitialLoad();
    await editBody("unsaved edit");

    await act(async () => { captured.history!.onDelete("a"); });
    expect(screen.getByText("删除文章失败，内容已保留，请重试。")).toBeInTheDocument();
    expect(captured.history!.activeId).toBe("a");
    expect(captured.history!.projects).toHaveLength(1);
    expect(captured.history!.interactionLocked).toBe(false);
    expect(captured.editor!.document.blocks[0].text).toBe("unsaved edit");
    await advanceDebounce();
    expect(storage.saveProject).toHaveBeenCalledTimes(1);
    expect(storage.saveProject.mock.calls[0][0].doc.blocks[0].text).toBe("unsaved edit");
    await editBody("edit after failed deletion");
    await advanceDebounce();
    expect(storage.saveProject).toHaveBeenCalledTimes(2);
    expect(storage.saveProject.mock.calls[1][0].id).toBe("a");
    expect(storage.saveProject.mock.calls[1][0].doc.blocks[0].text).toBe("edit after failed deletion");
    expect(screen.getByText("已保存到本地")).toBeInTheDocument();
  });

  it("resumes a historical range discussion using its own history and the latest paragraph", async () => {
    const project = projectWithRangeHistory();
    configureProjects([project]);
    const { requests } = captureChatRequests();
    render(<Home />);
    await settleInitialLoad();
    await act(async () => { captured.chat!.onJumpToTurn("range-discussion", 0); });
    expect(captured.chat!.sendDisabled).toBe(false);
    await editBody("Latest prefix target phrase latest suffix.");
    await act(async () => { captured.chat!.onSend("Follow-up question"); });

    expect(requests).toHaveLength(1);
    expect(requests[0].blocks).toEqual([
      { id: project.doc.blocks[0].id, text: "Latest prefix target phrase latest suffix." },
    ]);
    expect(requests[0].history).toEqual(project.nodes[0].turns);
    expect(requests[0].message).toBe("Follow-up question");
    expect(requests[0].includeFullDocument).toBe(false);
    expect(requests[0].anchorStale).toBe(false);
    expect(requests[0].context.selectedText).toBe("target phrase");
    expect(JSON.stringify(requests[0])).not.toContain("rangeLocator");
    expect(JSON.stringify(requests[0])).not.toContain("Historic prefix");
    expect(JSON.stringify(requests[0])).not.toContain("Unrelated discussion");
  });

  it("allows follow-up on a stale range using the old selection and its surviving current paragraph", async () => {
    const project = projectWithRangeHistory();
    project.doc.blocks[0].text = "The selection was replaced in the current paragraph.";
    configureProjects([project]);
    const { requests } = captureChatRequests();
    render(<Home />);
    await settleInitialLoad();
    await act(async () => { captured.chat!.onJumpToTurn("range-discussion", 0); });
    expect(captured.chat!.anchorStale).toBe(true);
    expect(captured.chat!.sendDisabled).toBe(false);
    await act(async () => { captured.chat!.onSend("Discuss the old phrase"); });

    expect(requests).toHaveLength(1);
    expect(requests[0].anchorStale).toBe(true);
    expect(requests[0].includeFullDocument).toBe(false);
    expect(requests[0].context.selectedText).toBe("target phrase");
    expect(requests[0].blocks).toEqual([
      { id: project.doc.blocks[0].id, text: project.doc.blocks[0].text },
    ]);
    expect(requests[0].history).toEqual(project.nodes[0].turns);
    expect(JSON.stringify(requests[0])).not.toContain("Historic prefix");
  });

  it("does not send unrelated document text when the historical range paragraph was deleted", async () => {
    const project = projectWithRangeHistory();
    project.doc.blocks = [{ id: "unrelated-block", type: "paragraph", text: "Private unrelated text." }];
    configureProjects([project]);
    const { requests } = captureChatRequests();
    render(<Home />);
    await settleInitialLoad();
    await act(async () => { captured.chat!.onJumpToTurn("range-discussion", 0); });
    expect(captured.chat!.sendDisabled).toBe(false);
    await act(async () => { captured.chat!.onSend("Discuss the deleted phrase"); });

    expect(requests).toHaveLength(1);
    expect(requests[0].anchorStale).toBe(true);
    expect(requests[0].blocks).toEqual([]);
    expect(requests[0].includeFullDocument).toBe(false);
    expect(requests[0].history).toEqual(project.nodes[0].turns);
    expect(JSON.stringify(requests[0])).not.toContain("Private unrelated text");
    expect(JSON.stringify(requests[0])).not.toContain("Historic prefix");
  });

  it("keeps sending disabled without a selected anchor or explicit full-document context", async () => {
    configureProjects([makeProject("a", "Private document text.")]);
    const { fetchMock } = captureChatRequests();
    render(<Home />);
    await settleInitialLoad();
    expect(captured.chat!.includeFullDocument).toBe(false);
    expect(captured.chat!.sendDisabled).toBe(true);
    await act(async () => { captured.chat!.onSend("No context question"); });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([true, false])("a missing source review sends only a surviving known paragraph (exists: %s)", async (blockExists) => {
    const project = projectWithRangeHistory();
    const node = project.nodes[0];
    node.anchor = { type: "review", reviewId: "deleted-review", blockId: project.doc.blocks[0].id };
    if (!blockExists) {
      project.doc.blocks = [{ id: "unrelated-block", type: "paragraph", text: "Private unrelated text." }];
    }
    configureProjects([project]);
    const { requests } = captureChatRequests();
    render(<Home />);
    await settleInitialLoad();
    await act(async () => { captured.chat!.onJumpToTurn(node.id, 0); });
    expect(captured.chat!.sendDisabled).toBe(false);
    await act(async () => { captured.chat!.onSend("Discuss the old review"); });
    expect(requests).toHaveLength(1);
    expect(requests[0].anchorStale).toBe(true);
    expect(requests[0].includeFullDocument).toBe(false);
    expect(requests[0].blocks).toEqual(blockExists
      ? [{ id: project.doc.blocks[0].id, text: project.doc.blocks[0].text }]
      : []);
    expect(JSON.stringify(requests[0])).not.toContain("Private unrelated text");
    expect(JSON.stringify(requests[0])).not.toContain("Historic prefix");
  });

  it("regenerates a stale historical answer with the same restricted current context", async () => {
    const project = projectWithRangeHistory();
    project.doc.blocks = [{ id: "unrelated-block", type: "paragraph", text: "Private unrelated text." }];
    configureProjects([project]);
    const { requests } = captureChatRequests();
    render(<Home />);
    await settleInitialLoad();
    await act(async () => { captured.chat!.onJumpToTurn("range-discussion", 0); });
    await act(async () => { captured.chat!.onRegenerate("range-discussion", 1); });
    expect(requests).toHaveLength(1);
    expect(requests[0].message).toBe("Earlier question");
    expect(requests[0].anchorStale).toBe(true);
    expect(requests[0].includeFullDocument).toBe(false);
    expect(requests[0].blocks).toEqual([]);
    expect(requests[0].history).toEqual([]);
    expect(captured.chat!.turns).toEqual([
      { role: "user", content: "Earlier question" },
      { role: "assistant", content: "Follow-up answer" },
    ]);
  });
});

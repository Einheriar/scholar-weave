<p align="center">
  <strong>English</strong> · <a href="./README.zh-CN.md">简体中文</a>
</p>

# ScholarWeave

> A local-first academic writing workspace that weaves anchored selections, contextual AI conversations, and user-controlled manuscript revisions into one workflow.

ScholarWeave is an academic writing assistant for researchers. It keeps every piece of feedback connected to the exact source text that prompted it: review suggestions, manuscript selections, and follow-up discussions all live in the same workspace. You can move naturally from “what needs to change?” to “why?” and then apply the revision after confirming it, without losing context. It is designed for people who want LLM-assisted polishing while retaining close control over their papers.

## Why ScholarWeave?

Have you encountered these problems while revising a paper?

Even a small change made through a chatbot can require repeatedly supplying the source text, background, and instructions. As the conversation grows, so does the context and the cost of every request. Models with strong prose and a refined sense of language are often expensive. Reducing the context can easily remove essential background, leaving you to copy, supplement, and explain it again. The process is cumbersome and interrupts the flow of writing.

Agent-based applications reduce copying and pasting by editing the document directly, but their output is not always precise enough, and they often provide less flexible control over local wording, tone, and sentence structure.

I wanted a tool between these two approaches:

- Understand the structure of an article and assist with revisions like an agent, reducing repetitive copying and pasting.
- Let users control the context precisely like a chatbot, avoiding unnecessary token usage.
- Support focused discussion of a word, sentence, or individual change while still considering it within its paragraph or the full document.
- Bring interactive model suggestions into a clear review workflow where the user chooses whether to accept, ignore, discuss, or revise them further.

ScholarWeave is an implementation of that idea: an LLM-powered, Grammarly-like workflow for academic writing.

At its core, it is still a conversation between a person and an LLM. Anchored selections, context management, and a review system keep each discussion centered on a clearly defined portion of the manuscript. The model provides language suggestions, while the user retains final control over the text and the revision process. The result is a human-led, LLM-assisted writing workflow that balances precision, efficiency, and cost.

The project uses UI design and context management to make revising English papers less cumbersome without asking users to surrender control of their writing.

I originally built ScholarWeave to revise my own academic papers. It currently focuses on language polishing and revision for English manuscripts, with Chinese as the fixed interface language. Interested users are welcome to adapt it for their own needs.

My C: drive is currently critically short on space, so Tauri packaging is on hold for now.

## Core capabilities

ScholarWeave keeps the manuscript at the center of the workflow:

- **Anchored feedback**: Suggestions can target the full document, a paragraph, or a precise text selection.
- **Contextual conversations**: Ask the LLM about the current selection, a review suggestion, a paragraph, or the full document.
- **Controlled revisions**: Every edit is previewed and confirmed before it touches the manuscript. Nothing silently rewrites your work.
- **A clear review lifecycle**: Accept, ignore, undo, and inspect stale suggestions that can no longer be located.
- **Local-first storage**: Drafts and chat history stay in the current browser through IndexedDB.
- **Built-in demo content**: The app opens with a sample manuscript, so the complete review workflow can be explored before connecting a model.

![ScholarWeave home page](doc/image/homepage.png)

## Quick start

Requirement: **Node.js 20.9 or newer**.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The editor and built-in demo data work without an API key. To run a real review or chat, create a local environment file from the template:

```bash
# macOS / Linux
cp .env.example .env.local

# Windows PowerShell
Copy-Item .env.example .env.local
```

Then fill in the model provider settings in `.env.local`, or configure an OpenAI-compatible provider under **Settings → Model**. `.env.local` is ignored by Git and must never be committed or shared.

## Model configuration

ScholarWeave uses the OpenAI-compatible chat protocol and can connect to OpenAI, DeepSeek, OpenRouter, and other services that provide a compatible API. Model details can be supplied through the local environment file described above or through the web interface.

### Configure through the web interface

Open **Settings → Model** to create and switch between multiple model presets. Each preset can store its own API key, base URL, model name, reasoning effort, and proxy settings, making it easy to move between models or providers.

Web presets are stored in the current browser's `localStorage`. They take effect immediately after being saved, are never written into project files, and cannot be committed through Git. Because API keys are stored as plaintext in the browser, this method should only be used on a trusted personal device.

![Model configuration](doc/image/modelconfig.png)

## Using ScholarWeave

### Choose a review mode and start reviewing

First choose one of the three review modes: **Corrections only**, **Moderate polishing**, or **In-depth review**. These modes control the range and degree of LLM intervention. You can limit the review to clear language errors, or ask it to examine clarity, structural coherence, and the overall suitability of the writing style for an academic paper. After you click **Start review**, ScholarWeave sends the review request to the configured LLM.

![Start review](doc/image/startreview.png)

### Review suggestions

Review suggestions are grouped into three types:

- **Document**: Examines overall structure, argumentative order, writing style, and terminology consistency. These suggestions usually offer directions for improvement rather than directly rewriting the manuscript.
- **Paragraph**: Examines the role and internal organization of one paragraph and how it connects to the surrounding text, including whether it should be split, merged, or reordered.
- **Local**: Anchors to a specific word or sentence and displays the source text, proposed replacement, and reasoning. Once confirmed, the edit can be accepted directly.

Most review suggestions can be handled with **Accept** or **Ignore**. Clicking a suggestion quickly locates the corresponding paragraph or phrase in the manuscript.

![Review suggestion workflow](doc/image/selectandcheck.webp)

### Talk with the LLM

When you want to discuss a specific passage, select it and ask the LLM a question. ScholarWeave sends both the selection and its containing paragraph as context.

![Contextual LLM conversation](doc/image/LLM.webp)

### Turn a conversation result into a review suggestion

The result of an LLM conversation can also be converted into a review suggestion and applied through the same controlled workflow.

![Turn a conversation result into a review suggestion](doc/image/interactiontoreview.webp)

## Privacy

- Drafts and conversation history are stored in the current browser's IndexedDB.
- Starting a review or sending a chat message sends the relevant document context to the model provider selected by the user.
- Server-side credentials stay in environment variables. A key entered in the settings panel is stored locally in the browser and is suitable only for personal use.
- The project does not provide a hosted service, account system, or telemetry.

Do not use the current prototype for confidential manuscripts until you have reviewed the provider's data-retention policy and the security of local browser storage.

## Technology

- Next.js 16, React 19, and TypeScript
- Tiptap 3 editor
- Zod runtime protocol validation
- Dexie / IndexedDB local persistence
- Tailwind CSS interface styling
- Vitest and Playwright automated tests

## Project status

ScholarWeave is still an actively developed prototype. The core review, anchoring, chat, persistence, and local packaging flows are implemented, but APIs and interface details may continue to change.

For implementation conventions, architecture notes, packaging details, and troubleshooting, see [DEVELOPMENTER.md](./DEVELOPMENTER.md). Product planning and milestone history are recorded in [plan/CHANGELOG.md](./plan/CHANGELOG.md).

## Contributing

Issues, design feedback, and focused pull requests are welcome. Please read [DEVELOPMENTER.md](./DEVELOPMENTER.md) before changing the data model, anchoring rules, LLM protocol, or persistence layer.

## License

This project is released under the [MIT License](./LICENSE). Third-party dependencies, fonts, and sample content may have their own licenses and are not relicensed by this project.

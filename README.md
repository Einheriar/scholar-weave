# ScholarAnchor

> A local-first academic writing workspace with anchored reviews, contextual AI conversations, and user-controlled manuscript revisions.

ScholarAnchor is an academic writing assistant for researchers who want feedback to stay connected to the exact part of a manuscript that prompted it. Review suggestions, source selections, and follow-up conversations live in one workspace, so you can move from **“what should change?”** to **“why?”** and then to a controlled revision without losing context.

## Why ScholarAnchor

Most writing assistants treat feedback as a stream of disconnected messages. ScholarAnchor treats a manuscript as the center of the workflow:

- **Anchored feedback** — suggestions can target the whole document, a paragraph, or a precise text range.
- **Contextual conversations** — ask the LLM about the current selection, a review suggestion, a paragraph, or the full document.
- **Controlled revisions** — edits are previewed and confirmed before they touch the manuscript. Nothing silently rewrites your work.
- **A clear review lifecycle** — accept, ignore, undo, and inspect stale suggestions without losing the original context.
- **Local-first storage** — drafts and chat history stay in the current browser through IndexedDB.
- **Built-in demo content** — the app opens with a sample manuscript, so the review workflow can be explored before connecting a model.

![homepage](doc/image/homepage.png)

## Quick start

Requirements: **Node.js 20.9 or newer**.

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

Then fill in the provider settings in `.env.local`, or configure an OpenAI-compatible provider in **Settings → Model**. `.env.local` is ignored by Git and must never be committed or shared.

## Supported model configuration

The server uses the OpenAI-compatible chat protocol. You can connect OpenAI, DeepSeek, OpenRouter, or another compatible provider by setting:

```env
LLM_PROVIDER=openai
OPENAI_API_KEY=your-key
OPENAI_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-flash
```

The exact variables and provider notes are documented in [.env.example](./.env.example).

## Local distribution

To create a self-contained `dist/` directory for local distribution:

```bash
npm run package:app -- --without-env
```

The `--without-env` flag keeps your local credentials out of the package. On Windows, double-click `dist/start.cmd`; on macOS or Linux, run `./dist/start.sh`. The target machine still needs Node.js 20.9+.

Build the package on the same operating system where it will be used, because the production bundle includes platform-specific native dependencies.

## Privacy model

- Drafts and conversation history are stored in the current browser's IndexedDB.
- Starting a review or sending a chat message sends the relevant document context to the model provider selected by the user.
- Server-side credentials stay in environment variables. A key entered in the settings panel is stored locally in browser storage for personal use.
- The project does not include a hosted service, account system, or telemetry layer.

Do not use the current prototype for confidential manuscripts until you have reviewed the provider's data-retention policy and the local-storage security model.

## Technology

- Next.js 16, React 19, and TypeScript
- Tiptap 3 for the manuscript editor
- Zod for runtime protocol validation
- Dexie / IndexedDB for local persistence
- Tailwind CSS for the interface
- Vitest and Playwright for automated tests

## Project status

ScholarAnchor is an actively developed prototype. The core review, anchoring, chat, persistence, and local packaging flows are implemented, but APIs and visual details may continue to evolve.

For implementation conventions, architecture notes, packaging details, and troubleshooting, see [DEVELOPMENTER.md](./DEVELOPMENTER.md). Product planning and milestone history live in [plan/PLAN.md](./plan/PLAN.md) and [plan/CHANGELOG.md](./plan/CHANGELOG.md).

## Contributing

Issues, design feedback, and focused pull requests are welcome. Please read [DEVELOPMENTER.md](./DEVELOPMENTER.md) before changing the data model, anchoring rules, LLM protocol, or persistence layer.

## License

This project is released under the [MIT License](./LICENSE). Third-party dependencies, fonts, and sample content may have their own licenses and are not relicensed by this project.

---

中文简介：ScholarAnchor 是一个面向学术论文的本地优先写作工作台，将选区锚定、AI 审阅、上下文对话和可控修改放在同一条工作流中。所有正文修改都需要先预览、再由用户确认。

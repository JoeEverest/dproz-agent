# Dproz Agent

A desktop app that runs a job search for you in the background. You give it your resume once. It then looks for jobs a few times a day, writes a resume and cover letter for each good match, applies in its own browser, and keeps a Kanban board of everything it sent.

It is local only: no Dproz account, no server, no sync. The agent runs on the Claude Code sign-in already on the machine.

## Requirements

- macOS (Apple Silicon), Linux (x64) or Windows (x64).
- Your own model, one of:
  - [Claude Code](https://claude.com/claude-code) installed and signed in (`claude` in a terminal).
  - An Anthropic API key.
  - Another endpoint that speaks the Anthropic Messages API: a gateway, or [Ollama](https://docs.ollama.com/integrations/claude-code) for open-weight models. You give its address and, if it needs one, a token, then pick a model from the ones it lists (for Ollama that is what is installed plus its cloud models) or type any name. The model can be switched later under Settings.

  The last two are set during setup or under Settings, Model provider. They are checked before they are saved, stored encrypted, and win over the Claude Code sign-in while set. Models other than Claude are not supported by Anthropic and may handle the agent's work poorly; use one that supports tools, with a context of at least 64k.
- Node 22 or newer to build.

## Run it

```bash
cp .env.example .env    # then set DPROZ_API_KEY, the x-api-key for the Dproz jobs API
npm install
npm run dev
```

The key is read from `.env` when the app is built and is not in the repository. Release builds take it from the `DPROZ_API_KEY` repository secret.

First launch is a setup screen: add your documents, and it checks the Claude sign-in and downloads the agent's own Chromium (about 170 MB, once). Press Start and it is on its own from there.

## How it works

The main screen is the board. Nothing has to be asked for:

- After setup the agent reads your documents and writes `about-me.md`, its memory of who you are.
- It then searches Dproz on a timer (every 6 hours by default; 4 hours, twice a day and daily are the other choices), looking at jobs posted since the last search. There is no cap: every real fit is pursued.
- When it needs something only you know, the question appears on the Questions screen, as a chat. Your answer is saved to `about-me.md`, so it is asked once, and the job that was waiting carries on.
- Each card lists the documents written for that job; clicking one slides a preview out beside the card, with a Download button that saves a copy.
- **Add a job** takes a link or pasted posting for a job you found yourself, to apply to or only prepare.
- Pause stops the current run and holds everything until you resume.

### Agents

Every job is handed to subagents that start with a fresh context (`src/main/agent/prompt.ts`):

| Agent | Runs | Does |
| --- | --- | --- |
| Coordinator | once per run | Searches, screens postings, creates cards, delegates, and never writes or submits itself. |
| `application-writer` | one per job, in parallel | Saves the posting, checks fit, decides the pitch, tailors the resume and cover letter, renders PDFs. No browser. |
| `application-judge` | one per prepared job, in parallel | Read-only. Checks every claim against `about-me.md` and reads as the hiring manager. Returns SEND or REVISE (two rounds at most). |
| `application-sender` | one at a time | Fills and submits the form in the shared browser, creates and saves a portal account if needed, and marks the card Applied once it has seen a confirmation. |

Email-only jobs are never sent by the agent: the card moves to Apply manually with the documents and a draft message. A CAPTCHA, one-time code or login challenge is handed to you in the agent's browser window.

### Parts

| Part | Where | What it does |
| --- | --- | --- |
| Run manager | `src/main/agent/manager.ts` | Schedules searches, queues runs, pauses, and tracks which cards the subagents are working on. |
| Desk tools | `src/main/tools/desk.ts` | In-process MCP server: the board, questions, logins, PDF rendering, browser hand-off. |
| Dproz tools | `src/main/tools/dproz.ts` | In-process MCP server over the public Dproz jobs API: `search_jobs`, `get_job`, `list_categories`. |
| Browser | `src/main/runtime.ts` | Playwright MCP driving a private Chromium with a persistent profile, so portal logins survive between runs. |
| Interface | `src/renderer` | React, Tailwind 4 and UI SDK primitives, in the Dproz palette. |

### Where things are kept

Everything is ordinary files in the app's data folder (`workspace/` inside it); each card's Folder button opens its own folder.

```
about-me.md              what the agent knows about you
documents/               your originals
templates/               starting points for the resume and cover letter
applications/<id>/       one folder per job
  application.json       the card: status, fit, strategy, documents, questions, history
  job.md                 snapshot of the posting
  *.pdf                  the documents that were sent
inbox.json               general questions the agent has asked you
```

### Profile settings and Settings

- **Profile settings** (sidebar): the documents the agent holds on you, what it knows about you (`about-me.md`, editable in the app), and site logins. Logins are encrypted with the system keychain (Keychain on macOS, the Secret Service on Linux); on a Linux machine with no keyring the page says so.
- **Settings** (gear, bottom of the sidebar): send automatically (on by default; off means every application waits at Ready to submit and the browser can read but not click, type or upload), how often it searches, the model, and the installed version.

### Updates

The app asks the download site for the latest release when it starts and every 4 hours (`src/main/updates.ts`). When a newer version is out, an update icon appears at the bottom of the sidebar and on the Settings page. Pressing it downloads the new version inside the app, checks it against the SHA-256 GitHub records for the release file, and then offers **Restart to update**, which closes the app, puts the new version in place and opens it again.

The builds are not signed with an Apple Developer ID, and the standard macOS updater refuses to update an unsigned app, so the app does the swap itself:

| Install | How it updates |
| --- | --- |
| macOS | Downloads the zipped app, unpacks it, and a small script swaps the `.app` bundle once the app has quit. |
| Linux AppImage | The same, swapping the AppImage file. |
| Windows | Downloads the installer and runs it silently. |
| Linux `.deb`, an app opened from the disk image, a development run | Cannot replace itself: the button opens the installer download instead. |

Nothing is downloaded until the button is pressed. `node tests/e2e/run.mjs update` runs a real update of a packaged macOS copy inside a sandbox (the two builds it needs are named at the top of `tests/e2e/update.mjs`).

## Tests

```bash
npm run typecheck
npm run lint
npm test                              # unit tests
npm run build
node tests/e2e/run.mjs platform       # setup, board, questions panel, drawer, settings, vault (no agent run)
node tests/e2e/run.mjs gallery        # screenshots of every screen, light and dark, with demo cards
node tests/e2e/run.mjs full           # the whole autonomous flow against a local mock jobs feed and careers portal
npm run pack && node tests/e2e/run.mjs packaged   # the packaged app, including a prepare-only agent run
./tests/e2e/linux.sh                  # builds and runs the platform test on Linux in Docker
```

`full` and `packaged` use your Claude account. They set `DPROZ_AGENT_TEST_ORIGIN` and point `DPROZ_API_URL` at the mock, which restricts the agent's browser to the mock portal and removes the web tools, so a test with a fictional candidate cannot reach a real employer. Test sandboxes also start paused unless a test turns that off. Keep both in place for any test that lets the agent run.

## Packaging and releases

```bash
npm run pack    # unpacked app in dist/
npm run dist    # dmg on macOS; AppImage and deb on Linux
```

To release, set the version in `package.json`, commit, then push a matching tag:

```bash
git tag v0.2.0 && git push origin v0.2.0
```

`.github/workflows/release.yml` builds the macOS (Apple Silicon), Linux (x64) and Windows (x64) installers on their own runners and publishes a GitHub release. `.github/workflows/test.yml` runs the type checks, unit tests and the app-level test on all three for every push. Each platform is built on that platform because the Agent SDK ships its Claude Code binary as a per-platform package. Builds are not signed with a paid certificate: on a Mac the app has to be cleared once with `xattr -cr "/Applications/Dproz Agent.app"`, and on Windows SmartScreen asks for More info, then Run anyway.

The app icon is rendered from the Dproz logo by `node tools/icon.mjs` into `build/` (installers) and `resources/icon.png` (window and tray).

## Download site

`site/` is the landing page, deployed to Vercel (`cd site && vercel deploy --prod`).

- `GET /api/latest` returns the newest version, its download links, and the package and checksum the app uses to update itself, read from this repository's public releases and cached for five minutes. The app's update check reads the same endpoint.
- `GET /api/download?platform=mac|linux|deb` redirects to that installer.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DPROZ_AGENT_USER_DATA` | Use another folder for settings, logins and the browser profile. |
| `DPROZ_AGENT_BROWSERS_PATH` | Where the agent's Chromium is installed. |
| `DPROZ_AGENT_HEADLESS` | Run the agent's browser without a window. Hand-offs need a window, so this is for tests. |
| `DPROZ_AGENT_TEST_ORIGIN` | Fence the agent to one origin (see Tests). |
| `DPROZ_API_URL`, `DPROZ_API_KEY`, `DPROZ_SITE_URL` | Point the Dproz tools at another API. |
| `DPROZ_AGENT_UPDATE_URL` | Where the app checks for a newer release. Empty turns the check off. |
| `DPROZ_AGENT_ANTHROPIC_URL` | Where an Anthropic API key is checked before it is saved. Tests point it away from the real API. |

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

The key is read from `.env` when the app is built and is not in the repository. Release builds take it from the `DPROZ_API_KEY` repository secret. `DPROZ_AGENT_POSTHOG_KEY` works the same way and is optional: see Usage analytics.

First launch is a setup screen: add your documents, and it checks the Claude sign-in and downloads the agent's own Chromium (about 170 MB, once). Press Start and it is on its own from there.

## How it works

The main screen is the board. Nothing has to be asked for:

- After setup the agent reads your documents and writes your master resume, `about-me.md`: everything about you in one Markdown document. Every job with all you did there and what came of it, your education, certifications, skills, achievements and referees, and the other facts that matter to some jobs and not others. It is not a resume to send. It is the record each resume is cut from, and the source of truth about you.
- A source can also be a link, pasted where documents are added. A link to a file (a resume PDF, a Google Doc or Drive file shared with anyone who has the link) is downloaded and becomes a document. A link to a page (a portfolio, a profile) is kept as a link, and the agent reads the page itself, in its browser when the page needs a sign-in.
- It then searches Dproz on a timer (every 6 hours by default; 4 hours, twice a day and daily are the other choices), looking at jobs posted since the last search. There is no cap: every real fit is pursued.
- When it needs something only you know, the question appears on the Questions screen, as a chat. A requirement a job asks for that nothing you have given it shows is a quick question: **I have it** or **Not yet**, one click, as in Dproz Fit Check. One click is the whole answer: it never asks you to explain. Anything else it asks is something an application cannot go ahead without, such as the salary a form requires. It does not ask about your experience. Each answer is worked into your master resume as a fact, where it belongs: a licence under Certifications and licences, something you do not have under Do not have. So it is asked once, and the same requirement on another job is answered for you.
- A resume for one job is a selection from the master resume, not a copy of it. The agent picks what that employer cares about and leaves the rest out: a desk job does not hear about a commercial driving licence, and an answer you gave for one job is not put on every resume.
- Each card lists the documents written for that job; clicking one slides a preview out beside the card, with a Download button that saves a copy.
- **Add a job** takes jobs you found yourself: one link, several links pasted one per line, or the text of a posting. Each becomes a card, even when the fit is not obvious, since you chose it. **Apply for me** takes it through prepare, judge and send; **Prepare only** stops at Ready to submit. A job that only takes applications by email cannot be sent from here: the resume, the cover letter and the email are prepared, and the card waits under Apply manually for you to send.
- Pause stops the current run and holds everything until you resume.

### How resumes are written

The writing rules are in `src/main/agent/prompt.ts` and come from two places.

The form comes from the career services that publish their guidance ([Harvard](https://careerservices.fas.harvard.edu/resources/create-a-strong-resume/), [Yale](https://ocs.yale.edu/resources/writing-impactful-resume-bullets/), [MIT](https://capd.mit.edu/resources/resumes-writing-about-your-skills/)). A bullet is one accomplishment: a verb, what you did, and what came of it. That is a STAR answer with the situation and task cut to a few words. It opens with the verb, runs a line or two, uses no "I", and no two bullets in a role open with the same verb. The resume shows requirements through accomplishments and never argues that you meet them.

What may be claimed comes from the Dproz AI service, which tailors resumes for Fit Check. The posting is the employer's wording and the resume is your facts. Keywords go in the skills and the summary, lightly, and only for what you have confirmed. Years, degrees and titles are yours, never the posting's thresholds. What you said you lack is not claimed.

The agent may rewrite the wording of anything. It may not add a fact. When your documents say what you did but not what came of it, the bullet says what you did and stops: it does not ask you for a number, and it does not make one up. To give it more, add it to your master resume.

A tailored resume is structured data in the Dproz AI service's master resume shape (`src/shared/resume.ts`), printed by `render_resume` in one of five layouts ported from Fit Check's resume tailoring: classic, modern, compact, minimal and executive (`src/main/resume/templates`). Minimal is set in Libre Franklin, as in Fit Check; the font ships with the app (`resources/fonts`) and is embedded in the PDF, so nothing is fetched when a resume is printed. The master resume page uses the same typeface. Each print returns notes on the wording, checked against your master resume and the posting (`src/main/resume/review.ts`): the first person, duties, repeated verbs, long bullets, a figure you never gave, the posting's thresholds or sentences, the job's title or employer in the summary, and skills that are not skills. The writer fixes them before the judge reads it, and the judge holds the resume to the same rules.

### Agents

Every job is handed to subagents that start with a fresh context (`src/main/agent/prompt.ts`):

| Agent | Runs | Does |
| --- | --- | --- |
| Coordinator | once per run | Searches, screens postings, creates cards, delegates, and never writes or submits itself. |
| `application-writer` | one per job, in parallel | Saves the posting, checks fit requirement by requirement, asks quick questions about what is unknown, decides the pitch, selects from the master resume what this employer cares about, writes the resume and cover letter, renders PDFs. No browser. |
| `application-judge` | one per prepared job, in parallel | Read-only. Checks every claim against `about-me.md`, reads as the hiring manager, and holds the resume to the writing rules. Returns SEND or REVISE (two rounds at most). |
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
about-me.md              your master resume: everything about you, and the source of truth
documents/               your originals
links.json               pages you gave as sources about yourself
templates/               the starting point for the cover letter
applications/<id>/       one folder per job
  application.json       the card: status, fit, strategy, documents, questions, history
  job.md                 snapshot of the posting
  resume.json            the tailored resume as data
  *.pdf                  the documents that were sent
inbox.json               general questions the agent has asked you
```

### Profile settings and Settings

- **Profile settings** (sidebar): your master resume as a page you edit in place, with your documents and links in a bar beside it. Click a document to preview it. Correct or add anything on the page and save: what is written there is the truth about you from then on. The agent then checks the applications it has not sent yet and prepares again any that relied on what you changed, and tells you if one already sent claimed it. If the agent added to the page while you were editing, you choose which version to keep.
- **The agent's browser** (Settings → Site logins → Open browser): the agent drives its own Chromium and keeps its profile between runs. This button opens that same browser for you, so you can sign in to your email and job sites once by hand. The agent starts nothing while it is open and finds itself signed in afterwards. With your webmail signed in there, it also picks up the verification codes and confirmation links that sites email you, instead of asking you for them.
- **Settings** (gear, bottom of the sidebar): send automatically (on by default; off means every application waits at Ready to submit and the browser can read but not click, type or upload), how often it searches, site logins, the model, and the installed version. Logins are encrypted with the system keychain (Keychain on macOS, the Secret Service on Linux); on a Linux machine with no keyring the page says so.

### Usage analytics

The app reports anonymous usage figures to PostHog (`src/main/analytics.ts`), to show which models people use and what they spend, how far applications get and where they stop, and what an application costs by how it is sent. **Settings → About → Share anonymous usage figures** turns it off. Only an installed build reports: a development run, a test, and a build made without `DPROZ_AGENT_POSTHOG_KEY` send nothing.

What is sent: counts, timings, token counts, estimated costs, model names, card statuses, the hostname of the website an application goes through, and the app version and platform. PostHog also records an approximate location from the connection. What is never sent: your name or contact details, your documents or master resume, your answers, or the title or employer of any job. An install is a random id, a card is a hash, no person profile is built, and error messages have the home folder and any email address taken out.

| Event | When | What it carries |
| --- | --- | --- |
| `app opened` | The app starts | Version, platform, how the agent reaches a model, the model chosen, how many cards are at each stage |
| `setup completed` | Setup is finished | |
| `job added` | **Add a job** is used | How many links, or pasted text; apply or prepare only |
| `run finished` | Each agent run ends | Kind (`sweep`, `onboard`, `answers`, `add_job`, `submit`, …), outcome, duration, cost, tokens, models, the error if it failed |
| `model used` | Once per model in a run | Model, cost and tokens, so spending can be broken down by model |
| `application step` | A subagent finishes | `write`, `judge` or `send`; how it ended (`READY`, `NEEDS_INPUT`, `MANUAL`, `CLOSED`, `BLOCKED`, `SEND`, `REVISE`, `APPLIED`, `ERROR`, `INTERRUPTED`); duration; its share of the run's cost |
| `application found`, `needs input`, `ready`, `manual`, `applied`, `interview`, `closed` | A card changes status | The status it left, whether the agent or you moved it, how it is sent, the site, the fit verdict, minutes since it was found, and for a closed card the kind of reason |
| `application completed` | A card reaches Applied or Apply manually | Total cost across every run that worked on it, steps, revisions, questions asked, how it is sent |
| `question asked`, `question answered` | The agent asks, you answer | Quick or typed, the kind of requirement, I have it or Not yet, minutes to answer |
| `browser help requested` | The agent hands you the browser | Kind (`captcha`, `code`, `sign_in`), whether you did it, how long it waited |

The SDK reports one cost for a whole run. Each step's share is worked out from the tokens its own messages used (`src/main/agent/meter.ts`), so per-application costs are estimates that add up to the run's total, less what the coordinator itself used.

Questions these answer in PostHog:

- **Models and spending**: sum of `cost_usd` on `model used`, broken down by `used_model`; sum of `cost_usd` on `run finished` per install per week.
- **The funnel**: `application found` → `application ready` or `application manual` → `application applied`, broken down by `apply_method` or `apply_host`.
- **Where it fails or sticks**: `application step` broken down by `step` and `outcome`; `run finished` where `outcome` is not `success`, by `error`; `application needs input` with no later status; `browser help requested` by `kind` and `outcome`.
- **Jobs applied to per person**: count of `application applied` where `by` is `agent`, per install.
- **Cost per application by method**: average `cost_usd` on `application completed`, broken down by `apply_method`.

### Updates

The app asks the download site for the latest release when it starts and every 4 hours (`src/main/updates.ts`). When a newer version is out, an update icon appears at the bottom of the sidebar and on the Settings page. Pressing it downloads the new version inside the app, checks it against the SHA-256 GitHub records for the release file, and then offers **Restart to update**, which closes the app, puts the new version in place and opens it again.

The builds are not signed with an Apple Developer ID, and the standard macOS updater refuses to update an unsigned app, so the app does the swap itself:

| Install | How it updates |
| --- | --- |
| macOS | Downloads the zipped app, unpacks it, and a small script swaps the `.app` bundle once the app has quit. |
| Linux AppImage | The same, swapping the AppImage file. |
| Windows | Downloads the installer and runs it silently. |
| Linux `.deb`, an app opened from the disk image, a development run | Cannot replace itself: the button opens the installer download instead. |

Before opening an installer in the browser, Download checks the latest release
again and uses that release's installer for your platform. If the check fails or
the installer is missing, it shows an error so you can retry; it does not open
the older download link.

Nothing is downloaded until the button is pressed. `node tests/e2e/run.mjs update` runs a real update of a packaged macOS copy inside a sandbox (the two builds it needs are named at the top of `tests/e2e/update.mjs`).

## Tests

```bash
npm run typecheck
npm run lint
npm test                              # unit tests
npm run build
node tests/e2e/run.mjs platform       # setup, board, questions, drawer, master resume editor, settings, vault (no agent run)
node tests/e2e/run.mjs update-download # fresh installer links, busy controls, failures and retry (no agent run)
node tests/e2e/run.mjs gallery        # screenshots of every screen, light and dark, with demo cards
node tests/e2e/run.mjs full           # the whole autonomous flow against a local mock jobs feed and careers portal
node tests/e2e/run.mjs edits          # you edit your master resume, and the agent prepares again the unsent application that relied on it
node tests/e2e/run.mjs addjob         # you paste two job links: one is applied for, one is prepared for email; checks what is reported as usage
node tests/e2e/run.mjs links          # the agent reads a linked page into about-me.md, against a local page
node tests/e2e/run.mjs browser        # you sign in through the agent's browser, then its next run is signed in (opens a Chromium window)
npm run pack && node tests/e2e/run.mjs packaged   # the packaged app, including a prepare-only agent run
./tests/e2e/linux.sh                  # builds and runs the platform test on Linux in Docker
```

`full`, `edits`, `addjob`, `links`, `browser` and `packaged` use your Claude account. They set `DPROZ_AGENT_TEST_ORIGIN` and point `DPROZ_API_URL` at the mock, which restricts the agent's browser to the mock portal and removes the web tools, so a test with a fictional candidate cannot reach a real employer. Test sandboxes also start paused unless a test turns that off. Keep both in place for any test that lets the agent run.

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
| `DPROZ_AGENT_POSTHOG_KEY` | The PostHog project key for usage analytics, read from `.env` at build time or from the environment. Empty sends nothing. Release builds take it from the repository secret of the same name. |
| `DPROZ_AGENT_POSTHOG_HOST` | Where usage figures are sent. Naming a host also lets a build that is not installed report, which is how the tests see what is sent. |
| `DPROZ_AGENT_UPDATE_URL` | Where the app checks for a newer release. Empty turns the check off. |
| `DPROZ_AGENT_ANTHROPIC_URL` | Where an Anthropic API key is checked before it is saved. Tests point it away from the real API. |

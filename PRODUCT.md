# Dproz Agent

Product truth for design work. Captured from the scoping conversation with the product owner (November 2026), not from a separate interview.

## Platform

Desktop app (Electron). macOS and Linux are supported and tested targets; Windows is possible but untested.

## Stack

Electron, React 19, Tailwind CSS 4, UI SDK (`@ui-sdk/react`) for behavior, lucide icons. The agent is the Claude Agent SDK with a Playwright-driven Chromium.

## Users

A small group of agent-first people, starting with the owner's engineering friends. They already pay for Claude and are signed in to Claude Code. They are comfortable with files, terminals and agents, and they are looking for a job.

## Product Purpose

A background agent that finds jobs matching the user's profile, prepares the strongest application it can for each (fit check, pitch strategy, tailored resume and cover letter), submits it in its own browser, and records everything on a Kanban board the user takes over from.

## Positioning

A separate product from the public Dproz web app. Local only: no Dproz account, no backend, no sync. Job discovery starts with Dproz (Tanzania) through a bundled MCP server and extends to the wider web.

## Operating Context

The agent works unattended for long stretches. The user checks in between other work, usually to answer a question, clear a browser challenge, or see what was sent. Applications go out under the user's own name, so the record of what was done has to be exact.

## Capabilities and Constraints

- Fully autonomous: after setup it searches on a timer and applies to every real fit without being asked. One setting turns automatic sending off; pause stops everything.
- Each job is delegated to fresh-context subagents: a writer, a judge, then a sender.
- The user can add a job themselves, to apply to or only prepare.
- The chat panel exists for the agent's questions; answers feed its memory and unblock the job.
- The agent asks for missing facts instead of inventing them, and saves answers to `about-me.md`.
- Email-only jobs are prepared (documents and a draft) for the user to send themselves.
- CAPTCHAs, one-time codes and login challenges are handed to the user in the agent's browser window.
- Portal passwords are stored encrypted with the OS keychain and are available to the agent.
- Everything lives in ordinary files in the app's data folder; the user is not asked where.

## Brand Commitments

Named "Dproz Agent". Dproz palette (blue ramp, grey ramp, yellow, success green, error red) and the Dproz wordmark, from the professional app. Plus Jakarta Sans, the Dproz brand face.

## Evidence on Hand

The Dproz jobs API (about 440 live jobs). No testimonials, metrics or marketing claims exist; none should be invented.

## Product Principles

- The board tells the whole story without the conversation.
- Never misrepresent the user.
- Ask once, remember.
- Files the user can read beat state they cannot.

## Accessibility & Inclusion

Keyboard operable throughout, visible focus, 4.5:1 text contrast, reduced-motion support, light and dark following the system.

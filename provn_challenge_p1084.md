# Provn / Golden Analytics — Take-Home Challenge (active #123)

**Status:** Applied 2026-05-28. Challenge NOT started.
**Deadline:** Not explicitly stated on the brief. Assume soon — Provn challenges typically have a 5-7 day window from application.

## Links

- Challenge: https://provn.co/challenge-details/98
- Dataset (SharePoint, requires auth): https://provnco.sharepoint.com/:x:/s/Technology/IQCgqYJsp95jRKMYstu_QckkAQmtG_6nt1LD-G3Ry4ombuI?rtime=Ens_LCG93kg
- Dataset filename: Vendor-Payments_2021-23.xlsx (Washington State fiscal data, public government spending by fund type and fiscal year). Download locally before starting since the SharePoint link is behind Provn's auth.

## The challenge in one paragraph

Build a working web-app proof-of-concept that helps a non-technical user (city councilmember / journalist / policy analyst) get value from raw government spending data. Stack: TypeScript + React + Postgres (optional, mock OK). 30-45 min build window. AI integration is optional but explicitly graded — if you skip AI you must explain why in the README. The goal is "Canva for data" — surface insights without making the user write SQL.

## Hard constraints

1. **Non-technical user.** SQL must not be visible unless explicitly requested.
2. **Working web app.** Mock/stub data is OK; UI must function and core interaction must work.
3. **If you use AI/ML:** all inputs to any model/vector store/intelligent component must be logged (code must show clearly where/how — no persistent store required).

## Scoring rubric (weights)

- 28% Engineering Execution — working code, 2+ explicit trade-offs named, structure reflects intentional decisions
- 22% AI-Native Product Thinking — explicit UX decision referencing non-technical user, alternatives considered
- 22% Production & Data Mindset — gap between POC and prod, what would break, data handling if AI used
- 28% AI Fluency — documented AI collaboration with specificity + the mandatory video question

## Three deliverables

### 1. Web app code (any format, any stack)
Single-file component, small app, or structured set of files. Mock data OK if documented.

### 2. README (.md / .pdf / .doc / .txt)
Three sections:
1. **Problem** — specific user pain you addressed + why this direction over alternatives
2. **Tech and architectural choices** — what you built, how it works, what you deferred, what would change in prod
3. **AI usage log** — for 3+ significant AI interactions: what you asked, what it gave you, what you kept/changed/rejected

### 3. Video walkthrough (10-15 min, .mp4/.mov/.webm)
Sections with target durations:
- 60s — Summary: problem + why
- 3-4 min — Code walkthrough: what you built, decisions, intentional omissions
- 3-4 min — Product/production walkthrough: UX + what would change for prod
- **1-2 min — MANDATORY AI QUESTION:** "Walk me through one moment where you disagreed with, pushed back on, or redirected what the AI gave you. Name the specific moment. Explain what the AI produced that didn't meet the bar, what you did differently, and why."
- 30-60s — Reflection: what next, what differently with more time

The mandatory AI question is **the highest-signal indicator** per the brief. If you cannot name a specific redirect moment, evaluators assume you didn't push back. Plan for this — when you build, intentionally note one moment Claude/Cursor gave you something you rejected and what you did instead.

## Sai-specific notes

- Stack alignment is clean: TS + React is your daily lane.
- AI integration angle is your strongest play (matches Provn's positioning + your daily Claude Code workflow).
- 30 min is tight — don't over-engineer. Pick ONE user persona (probably journalist or policy analyst), build ONE focused interaction (e.g., "ask in plain English, get a chart + summary"), defer everything else explicitly in README.
- Easy AI redirect moment to capture for the video: when Claude proposes a generic dashboard with 10 charts, push back to "no, focus on the one question the user actually has." Note the timestamp and what you said in your AI usage log.
- Data handling for the AI input logging: simple `console.log` or a file-append in a `logs/` dir is enough for POC — just demonstrate where it WOULD go in prod (mention BigQuery / Datadog / similar in the README).

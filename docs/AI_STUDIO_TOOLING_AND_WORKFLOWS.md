# AI Studio Tooling And Workflows

This document records the three external tools that are currently the best fit for this project and explains how to apply the useful ideas from `Claude-Code-Game-Studios` while continuing to work in the Codex app.

## Goal

Use Codex as the main coding surface, but add enough structure that work is no longer just one long prompt/response loop.

That means:

- clear role boundaries
- reusable workflows
- explicit handoffs
- task parallelism when useful
- separate code, design, art, QA, and release concerns

## Recommended external tools

### 1. Claude Code Game Studios

Repo:
- [Donchitos/Claude-Code-Game-Studios](https://github.com/Donchitos/Claude-Code-Game-Studios)

What it is:
- A template that turns a single AI coding environment into a structured "studio" with specialized agents, workflow commands, hooks, rules, and templates.

What is useful for this repo:
- Studio hierarchy and domain ownership.
- Reusable workflows instead of ad hoc prompting.
- Path-scoped rules for different code areas.
- Project templates for plans, reviews, and handoffs.
- Explicit coordination between design, programming, art, QA, and production.

What is not directly portable:
- Claude-specific slash commands.
- Claude-specific hook/config layout under `.claude/`.
- The exact agent file format and command UX.

Best use here:
- Treat it as an operating model, not as software to install unchanged.
- Copy the structure ideas into repo-local docs and working conventions for Codex.

High-value ideas to adopt:
- Tiered roles: director, lead, specialist.
- Feature workflows: design -> implementation -> QA -> release notes.
- Domain boundaries: gameplay, rendering, networking, UI, content, ops.
- Quality gates before merge.

### 2. ComfyUI

Repo:
- [Comfy-Org/ComfyUI](https://github.com/Comfy-Org/ComfyUI)

What it is:
- A node/graph-based local AI generation system for image, video, audio, and some 3D workflows.

What is useful for this repo:
- Character concept art.
- Portraits and key art.
- Menu/background art.
- VFX source frames and texture generation.
- Style-consistent asset iteration through saved workflows.
- Repeatable generation pipelines instead of one-off prompting.

What is not enough by itself:
- It does not define your art direction.
- It does not guarantee consistent naming, formats, budgets, or quality.
- It does not integrate assets into the game without a pipeline around it.

Best use here:
- Use it as the asset generation workbench.
- Store chosen workflows, model notes, output conventions, and review criteria in repo docs.
- Keep generated assets out of ad hoc folders. Route them through the existing content and validation workflows.

Suggested role in this project:
- Primary AI art pipeline.

### 3. Remotion

Repo:
- [remotion-dev/remotion](https://github.com/remotion-dev/remotion)

What it is:
- A React-based framework for creating videos programmatically.

What is useful for this repo:
- Trailers and social clips.
- Patch note videos.
- Character reveal sequences.
- Pre-rendered menu/cutscene experiments.
- Automated video outputs from replay or balance data.

What is not a good fit:
- Core gameplay runtime.
- Interactive in-game UI.
- General asset generation in the way ComfyUI supports.

Best use here:
- Use it as a supporting media tool, not a core production dependency.
- Keep it separate from the game runtime unless you have a concrete need for generated videos.

Suggested role in this project:
- Marketing, presentation, and pre-rendered content.

## Recommended stack for this repo

- Codex app: main coding, planning, code review, docs, repo changes.
- ComfyUI: primary AI asset generation and asset iteration tool.
- Remotion: trailers, promo videos, patch-note clips, cutscene prototypes.
- Repo docs + validation scripts: the structure layer that Claude Code Game Studios would normally supply.

## How to apply Claude Code Game Studios ideas in Codex

The useful part of `Claude-Code-Game-Studios` is not "Claude". It is the operating structure:

1. Define roles.
2. Define workflows.
3. Define gates.
4. Keep artifacts.
5. Split work by domain.

Codex can do all of that if the project gives it enough structure.

## Codex-native studio model

### Tier 1: Direction

Use these as planning modes, not separate tools:

- Creative Director
  - owns tone, fantasy, player experience, visual identity
- Technical Director
  - owns architecture, determinism, tooling, performance, delivery risk
- Producer
  - owns scope, sequence, acceptance criteria, handoffs

When to use:
- New feature definition
- Epic planning
- Scope cuts
- Cross-system tradeoff decisions

### Tier 2: Leads

- Lead Programmer
  - gameplay/client/API boundaries, implementation plans, technical standards
- Art Director
  - visual consistency, style packs, asset acceptance criteria
- QA Lead
  - tests, smoke coverage, replay checks, bug reproduction criteria
- Release Manager
  - verify/build/release checklist, artifacts, deployment notes

When to use:
- Before implementation starts
- Before assets are accepted
- Before merge/release

### Tier 3: Specialists

Map them onto the current repo:

- Gameplay Programmer
  - `apps/game-web/src/sim`
- Rendering/UI Programmer
  - `apps/game-web/src/view`
- Input/Platform Programmer
  - `apps/game-web/src/input`
  - `apps/game-web/src/platform`
- Network/API Programmer
  - `apps/game-web/src/net`
  - `apps/api/src`
- Tools Programmer
  - `apps/game-web/scripts`
  - `apps/api/scripts`
- Technical Artist
  - `apps/game-web/content`
  - asset docs and validation flows
- QA Tester
  - tests, replay fixtures, smoke checks, validation scripts

## Repo structure to support this

The current repo already has strong separation in:

- `apps/game-web`
- `apps/api`
- `docs`

To make Codex more "studio-like", keep adding lightweight structure in repo files, not in chat memory.

Recommended additions over time:

- `docs/ADR_*.md`
  - architecture decisions
- `docs/FEATURE_*.md`
  - feature intent, scope, UX, acceptance criteria
- `docs/WORKFLOWS_*.md`
  - repeatable pipelines for art, QA, balance, release
- `production/`
  - sprint plans, current milestone, active task board snapshots
- `templates/`
  - feature brief, bug report, playtest report, review checklist

These do not require Claude Code. They just give Codex stable artifacts to read and update.

## Multi-agent workflows in Codex

Codex can work beyond a single linear conversation in two ways:

1. Structured local workflows
- You ask for planning, execution, verification, and review as distinct stages.

2. Parallel sub-agents
- When explicitly requested, Codex can delegate bounded tasks to multiple agents in parallel and integrate the results.

### When to use multiple agents

Good fits:

- one agent explores gameplay code while another reviews API impact
- one agent implements a UI slice while another updates docs or tests
- one agent audits content files while another checks validation scripts
- one agent reviews regressions while another prepares release notes

Bad fits:

- several agents editing the same file set
- vague prompts with no ownership
- urgent work where the next local step is blocked on the delegated result

### Codex delegation pattern

Use this pattern when asking Codex for multi-agent work:

1. Ask for a short plan first.
2. Ask for explicit task splitting by file ownership.
3. Ask for one agent per non-overlapping slice.
4. Ask for integration and a final verification pass.

Example:

```text
Split this into parallel work.

Agent 1: audit and update `apps/game-web/src/view/*` for the menu motion work.
Agent 2: inspect tests and add or adjust coverage for the same feature without editing runtime files.
You: integrate the results, resolve conflicts, run relevant verification, and summarize risks.
```

### What to ask Codex for

Useful prompts:

- "Act as producer first. Break this feature into design, implementation, QA, and release tasks."
- "Act as technical director. Identify the risky files and define safe task boundaries for parallel work."
- "Use sub-agents for non-overlapping workstreams and keep ownership explicit."
- "Do implementation with one worker and verification with another, then integrate locally."
- "Write the feature brief in `docs/` before touching code."

## A practical workflow for this project

### Workflow A: New gameplay feature

1. Feature brief
- Write a short doc in `docs/` with:
  - player goal
  - feature scope
  - affected systems
  - acceptance criteria
  - test plan

2. Technical slice
- Split by domain:
  - sim
  - view
  - input/platform
  - API if needed

3. Implementation
- Keep each task file-scoped where possible.

4. Verification
- Run targeted tests first.
- Then run broader repo checks if needed.

5. Review artifact
- Update the feature doc with what actually changed and residual risks.

### Workflow B: New asset/content drop

1. Art brief
- theme
- references
- required outputs
- file constraints
- budget limits

2. ComfyUI generation pass
- save workflow JSON
- record checkpoint/LoRA/prompt notes
- export candidates

3. Technical art pass
- resize, naming, consistency, fallback handling

4. Game integration
- put assets into content structure
- update manifests or package definitions

5. Validation
- run budget, schema, and smoke checks

6. Acceptance
- keep only approved outputs
- document final source workflow and settings

### Workflow C: Release/promo content

1. Select source material
- replay captures
- screenshots
- patch-note deltas

2. Generate or clean assets
- ComfyUI for stills, touchups, variants

3. Produce video
- Remotion for trailer, patch clip, or reveal sequence

4. Archive inputs
- script, timing notes, assets, and output target

## Suggested operating artifacts

These are the minimum artifacts that make Codex much more effective:

- `docs/CURRENT_MILESTONE.md`
  - what the team is trying to finish now
- `docs/CURRENT_SPRINT.md`
  - active tasks, owners, blockers
- `docs/FEATURE_<name>.md`
  - feature brief and acceptance criteria
- `docs/PLAYTEST_REPORT_<date>.md`
  - findings and follow-ups
- `docs/ASSET_PIPELINE.md`
  - naming, resolutions, review, source workflow storage
- `docs/RELEASE_CHECKLIST.md`
  - verify, smoke, artifacts, patch notes

Without these, each session has to rediscover too much context.

## How to move beyond prompt-response in practice

### Baseline mode

Use Codex as:

- planner
- implementer
- verifier
- reviewer

But keep the stages explicit in your request.

Example:

```text
First write a short feature brief in docs.
Then implement the smallest viable slice.
Then run targeted checks.
Then review your own change for regressions.
```

### Parallel mode

When the work can be split cleanly, explicitly ask for delegation.

Example:

```text
Use parallel sub-agents.

One agent should inspect current menu transition code and propose the runtime changes.
One agent should inspect tests and identify missing coverage.
You should integrate, implement the final patch, and run verification.
```

### Studio mode

Ask Codex to simulate roles in sequence:

```text
Act as producer, then technical director, then implementer, then QA lead.

1. Producer: define scope and acceptance criteria.
2. Technical director: split the task safely by files and identify risks.
3. Implementer: make the code changes.
4. QA lead: review for regressions and propose any missing tests.
```

This works well even without spawning sub-agents because it forces stage separation.

## Recommended next step for this repo

If the goal is to make this project genuinely multi-agent and end-to-end, the next practical move is:

1. Keep Codex as the primary coding environment.
2. Add a small production layer inside the repo.
3. Add one documented asset workflow around ComfyUI.
4. Add one documented release-media workflow around Remotion.
5. Start using explicit delegation requests for parallelizable work.

The first repo additions that would help most are:

- `docs/CURRENT_MILESTONE.md`
- `docs/CURRENT_SPRINT.md`
- `docs/ASSET_PIPELINE.md`
- `docs/RELEASE_CHECKLIST.md`

## Source notes

This guidance is based on the current public project descriptions:

- `Claude-Code-Game-Studios` describes a template with 48 agents, 37 workflows, hooks, rules, templates, a tiered studio hierarchy, and path-scoped standards.
- `ComfyUI` describes a graph-based local AI engine with workflow JSON, queueing, offline operation, and image/video/audio/3D support.
- `Remotion` describes a React-based framework for creating videos programmatically.

Use those projects as reference implementations for process and tooling ideas, not as a reason to replace the current repo stack.

# AGENTS.md

## Project Working Rules

This project prioritizes building a durable local map data pipeline rather than relying on repeated one-off online lookups.

### 1. Data acquisition priority

When a new map feature requires external data, the preferred execution order is:

1. Find an authoritative or stable data source that can be downloaded, exported, or bulk-collected.
2. Bring that data into the local project in a reusable form.
3. Convert it into a format that can be rendered or queried locally.
4. Document the acquisition and processing workflow in Markdown.
5. Only fall back to temporary online-only querying when no practical local data path exists.

This means the default goal is not “look it up again every time”, but “find a source once, ingest it properly, and reuse it locally”.

### 2. Offline-first map data workflow

For map-related features such as scenic spots, landmarks, trailheads, parks, route metadata, or POI overlays:

- Prefer downloadable datasets, official exports, OpenStreetMap-derived extracts, or stable structured APIs that can be persisted locally.
- Save the raw or normalized data into the repository data workflow when practical.
- If the dataset is too large for direct commit, save the processing scripts, output paths, and regeneration steps in project docs.
- Any frontend display layer should be backed by local files, local services, or project-owned derived data whenever feasible.

### 3. Documentation requirement

Each meaningful data ingestion or map-processing step should be recorded in Markdown, including:

- source of truth
- download location
- local storage path
- transformation script
- generated artifacts
- how the frontend or backend uses the result

The project should accumulate a repeatable map-processing workflow, not a sequence of undocumented manual steps.

### 4. Online research rule

If browsing is needed, use it to identify:

- the best available source
- licensing constraints
- download method
- update cadence
- whether the data can be stored and reused locally

Browsing should support local data ownership. It should not become the final product dependency unless that is explicitly accepted as a temporary exception.

### 5. API dependency rule

Whenever a feature depends on query-time service calls, explicitly label the dependency as one of:

- `local-data`
- `local-service`
- `external-api`

For any `external-api`, document:

- what it is used for
- whether a self-hostable substitute exists
- whether the project intends to migrate to a local service later

Preferred order for map-related querying is:

1. local data already stored in the project
2. self-hostable local services such as Nominatim, OSRM, GraphHopper, or similar
3. online third-party APIs only when no practical local path exists yet

### 6. Product development implication

Dummy data is acceptable only for very early UI scaffolding.

Once a feature direction is confirmed, implementation should move from dummy data to:

- real source discovery
- local ingestion
- documented transformation
- local rendering or querying

This rule applies especially to map overlays such as scenic spots and key landmarks.

### 7. Skill invocation rule

For this repository, do not automatically invoke optional Codex skills unless the user explicitly asks for that specific skill.

Allowed automatic skills:

- `codegraph` and similarly lightweight local code-intelligence or search helpers that primarily save tokens, reduce manual file reading, or speed up navigation without adding meaningful external/tooling cost
- other low-overhead local helpers only when they are clearly in the same “token-saving / local-inspection” category

Restricted skills:

- any skill that introduces noticeable extra tool usage, external network activity, generation overhead, long workflows, plugin/app dependencies, browser automation, or substantial additional token consumption must not be invoked automatically
- for those skills, ask first unless the user explicitly names the skill or clearly instructs that it should be used

When in doubt, classify the skill as restricted and ask first.

### 8. Product runtime assumption

This project should be designed mobile-first, with the primary long-term runtime target being:

- iPhone app
- Android or other mobile device app

The browser playground is only an early development shell, not the final product assumption.

Implications:

- core hiking logic should be portable and should not be tightly coupled to browser-only APIs
- route progress, walked distance, remaining distance, and GPX-path navigation should be designed so they can run locally on-device with minimal refactoring
- any browser-only capability should be treated as a temporary adapter layer around portable product logic
- offline-first behavior is a product requirement, not a later enhancement
- when choosing data structures, workflows, or storage formats, prefer designs that can later move cleanly into a native or hybrid mobile app architecture

### 9. Current product priority: first demo

The current highest-priority deliverable is the first end-to-end demo described in:

- `docs/beijing-city-walk-ai-demo-plan.md`

That document is the active implementation brief for the next phase of work.

Current execution priority:

1. Build a showable demo before expanding scope.
2. Optimize for a clear 3-5 minute product walkthrough.
3. Prove the core loop: GPX route data can be parsed, rendered, analyzed, and turned into shareable AI-style route content.

Until this demo loop works, avoid expanding into full product features such as:

- accounts
- social systems
- backend persistence that is not required for the demo
- complex recommendation systems
- production-grade commercialization features
- native app packaging

Implementation direction for the current phase:

- Prefer a web demo shell if that is the fastest path inside the current repo.
- Keep GPX parsing, route analysis, and AI-style text generation as independent helper modules.
- Use mock or rule-based AI generation by default unless the user explicitly requests real LLM integration.
- Treat upload, local parsing, route visualization, and route-card generation as P0 demo capabilities.

If there is a tradeoff between polish breadth and completing the demo loop, complete the demo loop first.

### 10. Business plan editing rule

For `docs/business-plan-plus-scaffold.html` and any future BP-style documents in this repository:

- Keep the distinction between `正文` and `脚手架/备注` strict.
- Do not let meta-writing guidance leak into the outward-facing正文.

Examples of text that should stay out of正文 and belong in notes/panels instead:

- “这一章的重点是……”
- “这里不再解释……”
- “这句话适合放在……”
- “这一页要回答的问题是……”
- any other wording that explains how the document is being written rather than advancing the business narrative itself

Before editing any BP正文, explicitly check whether the proposed change has this problem:

1. Is this sentence describing the project?
2. Or is it describing how the chapter/document is organized?

If it is the second kind, move it to:

- internal notes
- caution panels
- editing scaffolding

Use正文 only for statements that an external reader should directly see as part of the business narrative.

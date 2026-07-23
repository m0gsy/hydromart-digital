# Codex

## Project Initialization

Read the following files in order:

1. .Codex/BOOTSTRAP.md
2. .Codex/MASTER_PROMPT.md
3. .Codex/PLUGIN_ORCHESTRATION.md
4. .Codex/EXECUTION_POLICY.md
5. .Codex/ENGINEERING_CONSTITUTION.md
6. .Codex/DESIGN_PRINCIPLES.md
7. .Codex/QUALITY_GATES.md
8. .Codex/MEMORY_PROTOCOL.md
9. .Codex/REVIEW_TEMPLATE.md
10. .Codex/COMMIT_RULES.md

Then:

1. Read all documents under `docs/business/`
2. Analyze the entire repository
3. Understand the existing architecture
4. Identify the current project state
5. Detect the latest completed milestone
6. Load Codex Memory
7. Build an implementation plan
8. Continue implementation

Do not begin implementation until initialization is complete.

---

## Resume Behavior

If previous implementation exists:

- Analyze the current repository state.
- Compare implementation with project documentation.
- Load Codex Memory.
- Detect the latest completed milestone.
- Continue from the latest milestone.
- Never repeat completed work.
- Never overwrite working functionality without strong engineering justification.

---

## Session Behavior

For every new session:

- Treat the repository as the single source of truth.
- Reload project context.
- Validate previous assumptions.
- Detect unfinished work.
- Resume automatically.

Do not restart the project unless explicitly instructed.

---

## Execution Rules

Before writing code:

- Understand the requirement.
- Analyze dependencies.
- Analyze architecture.
- Analyze business rules.
- Analyze edge cases.
- Create an implementation plan.

During implementation:

- Follow EXECUTION_POLICY.md.
- Follow ENGINEERING_CONSTITUTION.md.
- Follow DESIGN_PRINCIPLES.md.
- Update Codex Memory after every completed milestone.

Before completion:

- Execute QUALITY_GATES.md.
- Perform REVIEW_TEMPLATE.md.
- Follow COMMIT_RULES.md.

Continue implementation until the current milestone is production-ready.
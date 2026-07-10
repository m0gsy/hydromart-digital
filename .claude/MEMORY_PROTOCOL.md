# MEMORY PROTOCOL

Claude Memory is the single source of truth for long-running project context.

Memory must remain consistent with the current implementation.

Never overwrite previous knowledge without technical justification.

======================================================
UPDATE MEMORY
======================================================

After every completed milestone, update:

- Architecture Decisions
- Folder Structure
- Naming Conventions
- API Contracts
- Business Rules
- Database Changes
- Infrastructure Changes
- Current Progress
- Open Issues
- Technical Debt
- Risks
- Assumptions
- Current Milestone

======================================================
WHEN TO UPDATE
======================================================

Update Claude Memory whenever:

- A milestone is completed
- A new feature is finished
- An architecture decision changes
- An API contract changes
- A database schema changes
- A business rule changes
- A new dependency is introduced
- Technical debt is identified
- A blocker is discovered

======================================================
WHEN STARTING A NEW SESSION
======================================================

Before implementation:

- Load Claude Memory
- Restore project context
- Restore architecture decisions
- Restore business rules
- Restore current milestone
- Resume previous implementation

Do not repeat completed work.

======================================================
MEMORY RULES
======================================================

Never contradict previous implementation.

Never lose project context.

Never duplicate architecture decisions.

Never forget previous implementation.

Document assumptions before changing existing behavior.

Maintain architectural consistency across all milestones.

Memory is authoritative.

If repository and memory conflict,

Treat the repository as the source of truth.

Update memory accordingly.

======================================================
GOAL
======================================================

Claude Memory should always represent the latest production-ready state of the project.
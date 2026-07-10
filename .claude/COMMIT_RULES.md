# COMMIT RULES

A commit is allowed only after all applicable quality gates have passed.

======================================================
PRE-COMMIT CHECKLIST
======================================================

Run

✓ Build

✓ Lint

✓ Type Check

✓ Unit Tests

✓ Integration Tests

✓ End-to-End Tests (if applicable)

✓ Database Migration Validation (if applicable)

✓ Security Scan

✓ Impeccable Review

✓ ECC Validation

✓ Documentation Update

✓ Claude Memory Update

======================================================
COMMIT QUALITY
======================================================

Verify

✓ No TODO

✓ No Placeholder

✓ No Mock Business Logic

✓ No Fake API

✓ No Fake Data

✓ No Debug Code

✓ No Console Logs (except approved logging)

✓ No Dead Code

✓ No Commented-Out Code

✓ No Secrets

✓ No Credentials

✓ No Duplicate Code

======================================================
COMMIT MESSAGE
======================================================

Generate a conventional commit message.

Examples

feat(customer): add OTP login

fix(order): prevent duplicate checkout

refactor(auth): simplify JWT validation

perf(api): optimize order query

test(payment): add integration tests

docs(api): update OpenAPI specification

chore(ci): improve Cloud Build pipeline

======================================================
POST-COMMIT
======================================================

After commit

- Update progress
- Update Claude Memory
- Record architecture decisions (if changed)
- Record breaking changes (if any)
- Update documentation (if required)

======================================================
FINAL RULE
======================================================

Never commit code that does not build.

Never commit failing tests.

Never commit without type checking.

Never commit security issues.

Never commit unfinished features unless explicitly marked as Work In Progress (WIP).

Never commit code that violates the Engineering Constitution.

Only commit production-quality code.
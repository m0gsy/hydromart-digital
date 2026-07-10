# ENGINEERING CONSTITUTION

## General Principles

Always

- Production Ready
- Clean Architecture
- SOLID
- DRY
- KISS
- YAGNI
- Secure by Default
- Testable
- Maintainable
- Observable

---

## Never

- Placeholder
- TODO
- Mock Business Logic
- Fake API
- Fake Data
- Duplicate Code
- Dead Code
- Any Type (unless technically justified)
- Massive Component
- Massive Service
- Massive Controller
- SQL in Controller
- Business Logic in Controller
- Hardcoded Secrets
- Hardcoded Credentials
- Hardcoded Configuration
- Ignore Errors
- Silent Failures

---

## Every Feature Must Include

- Validation
- Authentication (if required)
- Authorization (if required)
- Error Handling
- Logging
- Audit Log (where applicable)
- Documentation
- Unit Tests
- Integration Tests
- Loading State
- Empty State
- Error State
- Success State

---

## Code Standards

- Single Responsibility Principle
- Small Functions
- Clear Naming
- Dependency Injection
- Repository Pattern
- Consistent Folder Structure
- Strong Typing
- Explicit Interfaces
- Reusable Components
- Reusable Services

---

## Security

Always

- Validate Input
- Sanitize Output
- Protect Secrets
- Enforce RBAC
- Prevent SQL Injection
- Prevent XSS
- Prevent CSRF
- Rate Limit Public APIs
- Encrypt Sensitive Data

---

## Performance

Always

- Optimize Database Queries
- Avoid N+1 Queries
- Use Pagination
- Use Caching When Appropriate
- Lazy Load Resources
- Optimize Images
- Keep Components Small

---

## Documentation

Every completed feature must update

- API Documentation
- Architecture Documentation (if changed)
- Claude Memory
- Technical Decisions (if applicable)

---

## Definition of Done

A feature is complete only when

- Code is production-ready
- Tests pass
- Type check passes
- Lint passes
- Security review passes
- Impeccable review passes
- ECC validation passes
- Documentation is updated
- Claude Memory is updated
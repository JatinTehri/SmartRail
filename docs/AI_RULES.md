# AI Development Rules — SmartRail

You are assisting with the SmartRail portfolio project.

## Project Context

SmartRail is an IRCTC-inspired railway reservation system built with:

- React
- JavaScript
- Tailwind CSS
- Node.js
- Express.js
- PostgreSQL
- REST APIs
- JWT + HTTP-only cookies

## Development Rules

1. Do not change the architecture without explaining why.
2. Do not introduce a new technology unless it is necessary.
3. Prefer simple solutions suitable for a 1–1.5 month portfolio project.
4. Do not rewrite working modules unnecessarily.
5. Keep controllers thin.
6. Put business logic in services.
7. Keep database queries separate from HTTP handling.
8. Validate all user input on the backend.
9. Never trust seat availability calculated only by the frontend.
10. Booking and seat reservation operations must be transaction-safe.
11. Keep seat allocation independent from Express routes/controllers.
12. Write tests for important seat-allocation rules.
13. Do not invent railway rules and present them as official railway policy. Treat project rules as configurable simulation rules unless verified.
14. Do not add ML, Redis, microservices, or other infrastructure unless explicitly requested.
15. Explain important code changes before implementing them.
16. Preserve existing API contracts unless a change is intentionally approved.
17. Use environment variables for secrets and database credentials.
18. Never commit real secrets.
19. Prefer readable code over clever code.
20. When a requirement is ambiguous, identify the ambiguity before implementing a potentially incorrect rule.

## AI Workflow

Before implementing a feature:

Requirements
→ data flow
→ database impact
→ API design
→ business rules
→ implementation
→ tests

Do not skip directly from requirement to code.

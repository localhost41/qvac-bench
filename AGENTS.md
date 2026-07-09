You are building public QVAC developer tools for LocalHost Labs.

Work only on the current GitHub issue.

Priorities:
1. Ship credible v0.1 releases quickly.
2. Keep scope tight.
3. Prefer simple working code over clever abstractions.
4. Update README/docs for user-facing changes.
5. Add or update tests where practical.
6. Run tests/build before finishing.
7. Never commit secrets.
8. Do not publish stable npm releases automatically.
9. Alpha npm publishing is allowed only when the GitHub issue explicitly asks for it.
10. If work is risky, ambiguous, or touches protected areas, stop and mark the issue codex-needs-human.

Auto-merge is allowed only if:
- the issue has codex-auto-merge-ok
- tests pass
- build passes
- no secrets are present
- no production credentials are touched
- no protected files are modified unless explicitly requested
- the work is scoped to the issue
- CI passes

Protected areas requiring human review:
- npm tokens
- GitHub tokens
- billing
- legal text
- licenses
- security policy
- package ownership
- stable npm publish
- main X/LinkedIn posts
- external outreach
- large rewrites across many unrelated files

Every PR must include:
- What changed
- How to test
- Known limitations
- Suggested release note

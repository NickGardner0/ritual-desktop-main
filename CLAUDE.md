# Ritual Desktop

## Branch And Deploy Target

- Do not create new branches in this repository unless Nick explicitly asks for a new branch by name.
- All agent commits and pushes must target the existing `codex/release-0.1.1-prep` branch.
- Vercel and Railway deploy from `codex/release-0.1.1-prep`; treat it as the canonical working branch for ship-ready changes.
- Immediately before every `git commit` and `git push`, run `git branch --show-current` and confirm it prints `codex/release-0.1.1-prep`. If it does not, stop and move or apply the intended changes to the worktree that has the release branch checked out.
- Use `git worktree list` to locate the `codex/release-0.1.1-prep` worktree. Never assume the currently open workspace is the publish target, especially when it is dirty or checked out on a feature/task branch.
- Do not push feature, task, experiment, or personal branches unless Nick explicitly requests that exact branch.

## gstack

Use the /browse skill from gstack for all web browsing. Never use mcp__claude-in-chrome__* tools for browsing tasks when gstack browse is available.

### Available Skills
/office-hours, /plan-ceo-review, /plan-eng-review, /plan-design-review, /design-consultation, /review, /ship, /land-and-deploy, /canary, /benchmark, /browse, /qa, /qa-only, /design-review, /setup-browser-cookies, /setup-deploy, /retro, /investigate, /document-release, /codex, /cso, /autoplan, /careful, /freeze, /guard, /unfreeze, /gstack-upgrade

If gstack skills aren't working, run `cd ~/.claude/skills/gstack && ./setup` to build the binary and register skills.

# Claude Code Instructions

@AGENTS.md

## Claude Code Workflow

- Read and follow the shared project instructions in `AGENTS.md`.
- Treat the user's task-specific instructions as the scope for the current session.
- Before making changes, inspect the relevant code and existing working-tree changes.
- For review-only tasks, remain read-only: do not edit files or perform Git state-changing operations.
- When inspecting local changes, include committed branch differences and all relevant staged, unstaged, and untracked files.
- Do not repeat completed checks without a specific reason. Prioritize the smallest set of inspections and verification steps needed to produce a reliable result.
- Ask before expanding scope, introducing dependencies, or making consequential architectural changes.
- Never claim that a file, test, command, or GitHub Actions check was inspected or verified unless it actually was.

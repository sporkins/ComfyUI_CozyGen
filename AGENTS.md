## CORE PRINCIPLES (never violate)
- Simplicity first. Prefer minimal code that solves the problem correctly.
- Minimal impact: smallest possible change to achieve the goal. No unnecessary refactoring.
- Correctness > elegance > speed. Get it right before making it pretty.
- No regressions: never break existing functionality without explicit reason + tests.
- No hallucinations: if unsure about design tokens, architecture, or existing code — ask or read files first.
- Assume good faith but verify everything.

## CHATGPT CODEX WORKAROUND
- Do not use Get-Content to read code files.

## WORKFLOW MANDATORY STEPS FOR COMPLEX TASKS
1. PLANNING MODE (always first for anything > trivial change)
    - Output a clear PLAN section before writing any code.
    - Include: goal, risks, affected files, test strategy, step-by-step approach.
    - Ask for confirmation/feedback if plan feels ambiguous.

2. IMPLEMENTATION
    - Write code in small, focused commits/PRs.
    - Follow existing style/conventions exactly (read files first).

3. VERIFICATION GATE (never skip)
    - After changes: run all relevant tests yourself.
    - Lint, type-check, format-check — fix issues autonomously.
    - If tests fail → debug and fix without asking unless blocked.
    - Only say "ready for review" or "done" after passing verification.

4. SELF-IMPROVEMENT LOOP (the compounding magic)
    - After ANY correction, feedback, bug, or mistake (even small):
        - Analyze root cause.
        - Write 1–3 clear, concise, "never again" rules.
        - Append them to this file in the LESSONS / RULES section below.
        - Format: "- Never [bad thing]. Always [good thing] because [brief reason]."
    - Ruthlessly prune redundant/outdated rules. Keep this file lean.

## LESSONS & RULES (accumulated from real mistakes)
- Never assume a function exists without reading the file first.
- Never add new dependencies without explicit approval.
- Always prefer existing patterns over inventing new ones.
- Never touch production config/deploy scripts without double-checking.
- When in doubt about scope — ask before expanding.
- Output diffs clearly with file paths.
- Use structured thinking: <thinking> tags for complex reasoning.
- After fix: always propose running tests / verification steps.

## PROJECT-SPECIFIC (add as needed)

## USAGE REMINDERS
- End sessions with verification summary.
- If stuck: say exactly what's blocking and suggest next step.

Update this file after every meaningful session. The goal is zero-repeat mistakes.
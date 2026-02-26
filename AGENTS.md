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
- Never route history clicks directly into applying settings when inspection is requested. Always send users to a review page first because it prevents accidental loads and makes compare/copy workflows possible.
- Never collapse history detail previews to final-only when inspection is the goal. Always show a default main preview plus selectable run/job previews because users need to inspect alternate outputs before applying settings.
- Never emit both `temp` and `output` video previews from `CozyGenVideoPreviewOutputMulti` when final outputs exist. Always prefer `output` previews because mixed VHS temp/output lists double-count history videos.
- Never auto-import ComfyUI-executed runs into CozyGen history by default. Always keep ComfyUI-run ingestion explicit/opt-in because backfill surprises users and creates phantom history entries after cache resets.
- Never trust ComfyUI history media bucket counts directly. Always dedupe by `(type, subfolder, filename)` because the same MP4 can appear in both `gifs` and `videos` buckets and double the preview count.
- Never let temp previews block history fallback. Always filter `preview_images` to non-temp before deciding whether to fetch ComfyUI output media because temp-only saved previews hide final outputs.
- Never rely on ComfyUI `/history` fallback for restart durability. Always persist `preview_images` before run end completes (or backfill from `/history` immediately) because ComfyUI history may be unavailable after restart.
- Never test or debug using the live CozyGen cache directory or running CozyGen instance data. Always ask the user to export/share sanitized debug data into this project first because cache/runtime data may contain sensitive content.
- Never replace an existing configurable node when a simpler variant is requested. Always add a separate minimal node to avoid workflow regressions.
- Never increase numeric UI precision without updating backend rounding/serialization too. Always keep them aligned because hidden truncation causes confusing value changes.
- Never assume new CozyGen node classes appear in the web UI automatically. Always update MainPage type lists and widget/value mappings because the UI uses hardcoded class-type handling.
- Never let polling timers close over mutable UI settings/state. Always read live values from refs or refreshed callbacks because stale closures make controls appear broken.
- Never add a workflow node for a feature that is global UI state by nature. Always prefer backend/UI-only implementation first because it avoids execution-graph friction and user confusion.
- Never rely on small native mobile number steppers for important controls. Always provide explicit +/- buttons because touch targets and browser UI vary too much.
- Never auto-scroll a dropdown list in response to hover-only highlight changes. Always reserve scroll-follow behavior for keyboard/programmatic navigation because wheel scrolling under a stationary cursor causes jump loops.
- Never put freshly-created derived arrays/objects in effect deps when the effect mutates UI state. Always depend on the true source inputs (or memoize) because render-to-render identity churn can create reset loops.
- Never perform side effects inside React state updater callbacks. Always keep updater functions pure because React may invoke them more than once.
- Never bolt shared media controls onto independent previews without refs. Always centralize play/pause through parent-held refs because per-element controls drift out of sync.
- Never present selectable compare state as plain text actions when a toggle is intended. Always use a checkbox-style affordance because selection state must be immediately legible.
- Never add a composite CozyGen selector with dropdowns without adding matching `/cozygen/get_choices` sources for each list because the UI hydrates choices before computing stable defaults.

## PROJECT-SPECIFIC (add as needed)

## USAGE REMINDERS
- End sessions with verification summary.
- If stuck: say exactly what's blocking and suggest next step.

Update this file after every meaningful session. The goal is zero-repeat mistakes.

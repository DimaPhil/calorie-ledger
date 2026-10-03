# Initial skill evaluation

Date: 2026-10-02. Skill version: initial `SKILL.md` in this directory's parent. Runtime: Codex subagents. Model and reasoning effort: inherited unchanged from the authoring session; exact runtime-reported identifiers were unavailable. No model comparison is claimed. Token usage and elapsed-time measurements were not exposed and are not reported.

Two fresh isolated agents ran the same three synthetic cases, one with the skill and one without. Cases were grouped within each agent, so cases within a configuration were not independent fresh sessions. No production access, web requests, or database writes occurred. The author graded explicit outputs against the twelve saved expectations; this was not blind grading or an automatic skill-activation test.

| Case | With skill | Without skill | Observed result |
| --- | --- | --- | --- |
| Serving normalization and missing values | 4/4 | 3/4 | Both correctly converted the 30 g serving to 400 kcal, 13.333… g protein, 66.666… g carbs, 6.666… g fat, 10 g fiber, 300 mg sodium per 100 g, and retained the label's added-sugar zero. The skill run named all 18 fields; the baseline correctly declined to invent the omitted schema keys. |
| Preparation and product identity | 4/4 | 4/4 | Both rejected applying dry-rice values to cooked rice or plain nonfat yogurt values to ambiguous vanilla yogurt. Both retained existing values as unverified and requested matching evidence. |
| Concurrency and dependency safety | 4/4 | 4/4 | Both detected the concurrent edit, treated the already-applied row as a no-op, excluded the other owner, required transactional service updates, and preserved legacy/manual entries. Both reported execution as not run. |

Totals: with skill 12/12 expectations; baseline 11/12. These are narrow smoke checks, not evidence of general superiority. Most assertions passed without the skill; the clearest demonstrated benefit was supplying this repository's complete nutrient schema. Further useful testing would cover actual source matching, an ambiguous nutrition-label image, and the real migration runner's transaction behavior. Those belong to production research and repository integration tests, not this synthetic claim.

Structural validation passed using the skill-creator `quick_validate.py` helper. The default Python environment lacked PyYAML; an isolated `uv --no-config run --with pyyaml` invocation supplied it without changing project dependencies. JSON formatting and `git diff --check` passed. The bundled review generator produced a local HTML comparison for optional human feedback. No human feedback has been submitted; absence of feedback is not approval.

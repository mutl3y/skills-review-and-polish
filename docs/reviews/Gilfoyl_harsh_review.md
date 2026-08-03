This is a prompt linter that burns tokens to argue with other prompts, then offers to rewrite them with a second model. The ambition is real. So is the blast radius.

## The real problems

**1. Path boundary check in the fixer is the classic prefix bug.**  
In `loadReferenceGrounding`:

```ts
if (!resolved.startsWith(path.resolve(refDir))) continue;
```

`/tmp/refs` also prefixes `/tmp/refs-evil/secret.md`. You already fixed the linked-file path in analyzer.ts with `docDir + path.sep`. The fixer still has the amateur version. Same class of bug you claim to have learned from. Cute.

**2. The expensive path is the default path.**  
`analysisMode: multiWave`, six waves, `scoreSamples: 3`. That is not “quality.” That is a token furnace with a progress notification. Output tokens are the expensive part, and you chose the architecture that multiplies them by design. Fine if users know. Most will not.

**3. Fix safety theater has the important gates off.**  
LEARNINGS.md says autonomous apply is not production-safe and the semantic/self-critique layers matter. Defaults:

- `fixMode: 'diff'` — good
- `fix.semanticCheck: false`
- `fix.selfCritique: false`

So the mechanical guards are on, and the layers that catch meaning erosion are opt-in. Diff preview is not a substitute for refusing a bad edit. It is a UI apology.

**4. Your own docs disagree about determinism.**  
ARCHITECTURE.md still sells the ±6 noise floor story and also claims a “range 3 / mostly identical” deterministic retry fix. LEARNINGS still leads with ±6. If the product’s core claim is “trust the score,” the score’s error bars should not be a choose-your-own-adventure.

**5. Always-on activation.**  
`onStartupFinished` for a specialization linter. Every workspace pays startup cost so you can lint SKILL.md files the user may never open. Activation on language/pattern would be the obvious move. You went with “load anyway.”

**6. MCP trust boundary is “hope the env is clean.”**  
Headless mode reads .skills-review.json plus `OPENROUTER_API_KEY` / `GITHUB_TOKEN`, and will analyze whatever text the client sends up to 100k chars. Error redaction exists. Good. Cost controls are soft. One chatty agent loop becomes a bill. That is not theoretical.

**7. Variance is structural, not a UI problem.**  
You paper over LLM jitter with median-of-N, finding filters, and retry/merge. That is competent damage control. It is also an admission that the core sensor is a weather vane. Shipping “authoring-time linter” confidence on top of hosted-MoE nondeterminism means every keep/revert decision is statistics cosplay unless N is paid for.

## What is not dumb

- SecretStorage for API keys, not settings.json.
- Surgical fixer instead of whole-file rewrite.
- Frontmatter protection, growth/shrink guards, fixable-code allowlist.
- Symlink rejection on reference loading.
- Provider timeout + retry + bearer redaction.
- Diff-first fix UX as the default.
- Actual tests around path escapes and sanitization. Rare.

## Bottom line

This is a serious systems attempt at an unserious substrate. The security scars show prior pain. The cost model and default fix gates show product optimism winning arguments it should lose.

Ship it if you want. Just do not pretend multi-wave × median-3 × unscoped activation is “lean,” and fix the path prefix check before you call the last Gilfoyle pass closed.
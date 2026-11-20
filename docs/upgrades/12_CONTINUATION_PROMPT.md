# Continuation prompt for a new Claude chat

Paste everything below the line into a new Claude Code chat, with its working folder set to `/Users/connor/Coding/Contracting/Logicall/Telehealth LMS`.

---

You are continuing a hardening loop on LogiCall Pulse, a Next.js 15 + Firebase LMS for call-center training.

## Where to work
- Work ONLY in `/Users/connor/Coding/Contracting/Logicall/Telehealth LMS`. Never touch other folders.
- The ACTIVE app is `upgrade-fork/`. It is its own git repo and holds a lot of uncommitted work.
- Do NOT commit, stash, reset or checkout unless Connor asks.
- Never modify `firestore.rules`.

## Read first
- `upgrade-fork/docs/upgrades/11_REVIEW_AND_FIX_STATUS_2026-11-04.md` (what was found and fixed, and what is left)
- `docs/01..07` (the spec)
- `upgrade-fork/docs/upgrades/02-05` (design intent)

## Run the stack on this Mac

**MLX model server**
- `sh upgrade-fork/mlx-runtime/start.sh` runs Qwen2.5-7B on port 8081 with 8192 max tokens.
- `status.sh` and `stop.sh` sit in the same folder.
- The Ollama models (`clef*`) cannot chat, so don't use them.

**Firebase emulators** (from `upgrade-fork`)
```
PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" npm run emulators
```

**Seed data and the app** (from `upgrade-fork`)
- `npm run seed:local` loads the demo data.
- `sh scripts/with-mlx-env.sh npm run dev` starts the app on port 3000.
- If Tailwind classes go missing, clear `.next`.

**Demo logins**
- Password `PulseDemo!2026` for `trainer@logicall.io` (Trainer), `LC-1042` (agent) and `connor@logicall.io` (super admin).

**Live end-to-end check**
- Use a headless Playwright script with `require('@playwright/test')`, `NODE_PATH=upgrade-fork/node_modules` and `chromium.launch({ channel: 'chrome' })`.
- The flow: sign in as the Trainer, go to `/studio/new`, choose the Outbound Sales division, enter a title, and upload `demo-replay/NeuroCalmRx-Recovery-Calling-Playbook.pdf`. Then click "Upload and map content", "Build N checkpoints" and "Approve source bundle revision", and poll the page until it reaches `/studio/{id}` or shows "Select Retry".
- `scripts/record-demo.ts` has the selectors for the rest of the flow: Source Review, publish, the agent Checkpoint and the Live Call Sim.

## Loop goal (repeat until time runs out)
1. Run `npm run typecheck`, `npm run lint` and `npm run test:unit` in `upgrade-fork`. All must stay green.
2. Run the live checks on MLX:
   - Track build
   - Source Review approvals
   - Publish
   - Agent Checkpoint drills
   - Live Call Sim start, turns and evaluate
   - Team Progress
3. For each failure, find the root cause and fix it in the code. When a build fails, the server log (the dev server's output) shows the stage, the cause and the raw output length.
4. Prefer fixes that make generation reliable on a small local model without weakening the source-of-truth rule: every published claim maps to exact source evidence that a Trainer approves.
5. Add unit tests for each fix. Keep the changes minimal and backward compatible.
6. Append a dated entry to `11_REVIEW_AND_FIX_STATUS_2026-11-04.md` saying what was fixed, what was verified live, and what is still open.

## Known open items
- `sim-builder.ts` has `SIM_SOURCE_CHAR_BUDGET` = 30000 characters. That is too big for a 16k-token local Ollama context. Use `localSourceCharBudget` when the provider is local.
- There are no tests yet for:
  - the fuzzy evidence matcher (`findExactSourceSpan` in `prompts/evidence.ts`)
  - the stage timeouts
  - the split Unit stage
  - the regenerate-item transaction
- After a build, re-approving a transcription changes the `revisionHash`, and the draft can then never be published. The fix:
  - hash the normalized text
  - add a "rebind draft" action that re-verifies the excerpts
- These need a browser check. They have only been unit-tested.
  - Sim UI changes: resume, the AI_UNAVAILABLE retry, and the "a Trainer will score it" 202 state
  - The ScorecardView "Not eligible to pass" notice

## Decisions that belong to Connor (don't decide them; list them in the status doc)
- Whether Sims scored by Gemini (`hosted_ai`) may certify. Today they can't, on purpose.
- Ollama chat model vs MLX as the standard local runtime.
- Daily Sim limit: today a session counts once `turnCount > 0` or once it is evaluated.

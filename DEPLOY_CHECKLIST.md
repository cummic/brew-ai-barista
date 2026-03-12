Here's a reusable pre-deployment checklist prompt you can save and reuse every time:

---

> I'm preparing to push changes to GitHub and redeploy to production on Render. Before doing anything, work through this checklist in order and confirm each step is complete. Do not push to GitHub until all steps are done and I have approved.
>
> **Step 1 — Code review**
> Show me a summary of every file that was changed in this session. For each file tell me what changed and why. Flag anything that looks unintentional or outside the scope of what we were working on.
>
> **Step 2 — TypeScript check**
> Run the TypeScript compiler and confirm there are no errors:
> ```bash
> npx tsc --noEmit
> ```
>
> **Step 3 — Eval suite**
> Run the full eval suite and show me the results for every test case:
> ```bash
> EVAL_MODE=true npx tsx server/evaluate.ts
> ```
> All existing cases must pass before we proceed. If any cases fail, stop here and fix them. Do not push with failing evals.
>
> **Step 4 — README check**
> Review the changes made in this session and tell me if any of the following need to be updated in the README:
> - Tool count or tool names
> - Eval suite case count or category count
> - Guardrails section
> - Architecture or system design decisions
> - Environment variables
> - Any section that describes behavior that has changed
>
> If updates are needed, make them and show me the diff before committing.
>
> **Step 5 — Environment variable check**
> Confirm that no API keys, tokens, or credentials were accidentally added to any file that will be committed. Check all changed files and confirm `.env` is in `.gitignore`.
>
> **Step 6 — Commit message**
> Propose a commit message that accurately describes what changed in this session. It should be specific enough that a hiring manager reading the commit history understands what was built or fixed and why.
>
> **Step 7 — Final confirmation**
> Show me:
> 1. The list of files being committed
> 2. The proposed commit message
> 3. Eval results summary (pass/fail count)
> 4. Any README sections that were updated
>
> Wait for my explicit approval before running `git push`.

---

Save this in your project as `DEPLOY_CHECKLIST.md` in the root of your repo — that way it's always in Replit and you can copy/paste it whenever you're ready to ship.
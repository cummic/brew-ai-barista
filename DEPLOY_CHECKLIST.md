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
> **Step 3 — Eval suite coverage check**
> Review the changes made in this session and ask: do any of the following require a new test case?
> - A new guardrail or rule was added
> - A bug was fixed that exposed a gap in the existing test cases
> - A new tool was added or an existing tool's behavior changed
> - A new edge case was discovered during beta testing or the GIF recording session
>
> If a new test case is needed:
> 1. Propose the test case — the input message sequence, the expected tool calls, and the expected constraints
> 2. Wait for my approval before adding it to `golden_dataset.json`
> 3. Tell me the case has been added and ask me to run the eval suite in Step 5 with the new case included
>
> If no new test case is needed, explain why and move on to Step 4.
>
> **Step 4 — Observability & logging check**
> Review the changes made in this session and ask: does anything need to be added or updated in the logging or analytics layer?
> - Does a bug fix change what data gets written to Supabase? If so, are the existing conversation_logs, orders, or order_items fields still capturing the right values?
> - Does a new guardrail or behavior change mean a new event should be logged so it's visible in the analytics dashboard?
> - Are any of the 13 saved Supabase queries now returning incomplete or misleading results because of what changed?
> - Should a new Supabase query be added to track the new behavior?
>
> If logging or analytics updates are needed, propose exactly what should change and wait for my approval before touching anything. If nothing needs to change, explain why and move on to Step 5.
>
> **Step 5 — Eval suite**
> Do not run the eval suite yourself. I will run it manually in the Replit shell:
> ```bash
> EVAL_MODE=true npx tsx server/evaluate.ts
> ```
> Wait for me to confirm the results before proceeding. I will tell you the pass/fail count and flag any failures. If I report failures, stop here and fix them before we continue. Do not proceed to Step 6 or beyond until I explicitly confirm the eval results.
>
> **Step 6 — README check**
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
> **Step 7 — Environment variable check**
> Confirm that no API keys, tokens, or credentials were accidentally added to any file that will be committed. Check all changed files and confirm `.env` is in `.gitignore`.
>
> **Step 8 — Commit message**
> Propose a commit message that accurately describes what changed in this session. It should be specific enough that a hiring manager reading the commit history understands what was built or fixed and why.
>
> **Step 9 — Final confirmation**
> Show me:
> 1. The list of files being committed
> 2. The proposed commit message
> 3. Eval results as confirmed by me in Step 5
> 4. Any README sections that were updated
> 5. Any logging or analytics changes made in Step 4
>
> Wait for my explicit "push to GitHub" instruction before running `git push`. Do not push based on any other phrasing.
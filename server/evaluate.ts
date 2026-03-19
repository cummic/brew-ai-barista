import { runBaristaChat, initMenu } from "./barista.js";
import type { OrderState } from "../shared/schema.js";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

interface TestCaseSetup {
  location_inventory?: {
    location_id: string;
    product_id: string;
    is_available: boolean;
  };
}

interface TestCase {
  id: string;
  description: string;
  category: string;
  messages: string[];
  expectedTools: string[];
  expectNoSubmitOrder?: boolean;
  expectNoStoreInfo?: boolean;
  setup?: TestCaseSetup;
}

function getEvalSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("[eval] Supabase credentials not set");
  return createClient(url, key);
}

async function applySetup(
  setup: TestCaseSetup | undefined,
): Promise<(() => Promise<void>) | null> {
  if (!setup?.location_inventory) return null;
  const { location_id, product_id, is_available } = setup.location_inventory;
  const sb = getEvalSupabase();

  const { data, error } = await sb
    .from("location_inventory")
    .select("is_available")
    .eq("location_id", location_id)
    .eq("product_id", product_id)
    .single();

  if (error) {
    throw new Error(
      `[eval] applySetup: failed to read ${location_id}/${product_id}: ${error.message}`,
    );
  }

  const original_is_available = (data as { is_available: boolean }).is_available;

  const { error: updateError } = await sb
    .from("location_inventory")
    .update({ is_available })
    .eq("location_id", location_id)
    .eq("product_id", product_id);

  if (updateError) {
    throw new Error(
      `[eval] applySetup: failed to set is_available=${is_available} for ${location_id}/${product_id}: ${updateError.message}`,
    );
  }

  console.log(
    `[eval] setup: set ${location_id}/${product_id} is_available=${is_available} (was ${original_is_available})`,
  );

  return async function revert() {
    const { error: revertError } = await getEvalSupabase()
      .from("location_inventory")
      .update({ is_available: original_is_available })
      .eq("location_id", location_id)
      .eq("product_id", product_id);

    if (revertError) {
      console.error(
        `[eval] teardown: FAILED to restore ${location_id}/${product_id} is_available=${original_is_available}: ${revertError.message}`,
      );
    } else {
      console.log(
        `[eval] teardown: restored ${location_id}/${product_id} is_available=${original_is_available}`,
      );
    }
  };
}

function createOrderState(): OrderState {
  const sessionId = randomUUID();
  return {
    sessionId,
    stage: "greeting",
    userName: null,
    location: null,
    locationInventory: null,
    drink: null,
    milkType: null,
    pastry: null,
    tip: null,
    total: null,
    submittedAt: null,
  };
}

async function runTestCase(
  tc: TestCase,
): Promise<{ pass: boolean; reason: string; toolsUsed: string[] }> {
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  let orderState = createOrderState();
  const allToolsUsed: string[] = [];
  let priceValidationFailed = false;

  // Bootstrap: mirror exactly what the web app does.
  // Step 1 — Send "Hello" to get Claude's opening greeting (asking for the customer's name).
  // Step 2 — Send the customer's name to trigger capture_user_name.
  // Without this two-step init the conversation context is wrong and Claude won't call tools.
  try {
    history.push({ role: "user", content: "Hello" });
    const greet = await runBaristaChat(history, orderState);
    history.push({ role: "assistant", content: greet.message });
    orderState = { ...orderState, ...greet.stateUpdates };

    history.push({ role: "user", content: "Eval" });
    const nameStep = await runBaristaChat(history, orderState);
    history.push({ role: "assistant", content: nameStep.message });
    orderState = { ...orderState, ...nameStep.stateUpdates };
    // capture_user_name is an internal bootstrap tool — don't count it in test assertions
  } catch (err) {
    return {
      pass: false,
      reason: `Bootstrap threw: ${err}`,
      toolsUsed: allToolsUsed,
    };
  }

  for (const userMsg of tc.messages) {
    history.push({ role: "user", content: userMsg });

    try {
      const result = await runBaristaChat(history, orderState);
      history.push({ role: "assistant", content: result.message });
      allToolsUsed.push(...result.toolsUsed);
      orderState = { ...orderState, ...result.stateUpdates };

      if (
        result.toolsUsed.includes("calculate_total") &&
        !result.validationPassed
      ) {
        priceValidationFailed = true;
      }
    } catch (err) {
      return {
        pass: false,
        reason: `Exception thrown: ${err}`,
        toolsUsed: allToolsUsed,
      };
    }
  }

  for (const tool of tc.expectedTools) {
    if (!allToolsUsed.includes(tool)) {
      return {
        pass: false,
        reason: `Expected tool "${tool}" was not called. Tools used: [${allToolsUsed.join(", ") || "none"}]`,
        toolsUsed: allToolsUsed,
      };
    }
  }

  if (tc.expectNoSubmitOrder && allToolsUsed.includes("submit_order")) {
    return {
      pass: false,
      reason:
        "submit_order was called but should NOT have been (inventory restriction expected)",
      toolsUsed: allToolsUsed,
    };
  }

  if (tc.expectNoStoreInfo && allToolsUsed.includes("get_store_info")) {
    return {
      pass: false,
      reason:
        "get_store_info was called but location was ambiguous — should have asked for clarification first",
      toolsUsed: allToolsUsed,
    };
  }

  if (priceValidationFailed) {
    return {
      pass: false,
      reason:
        "Price validation failed: AI quoted an amount that doesn't match the calculate_total result",
      toolsUsed: allToolsUsed,
    };
  }

  return { pass: true, reason: "All checks passed", toolsUsed: allToolsUsed };
}

// Runs up to `limit` promises concurrently, resolving in original order.
async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      results[index] = await tasks[index]();
    }
  }

  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

async function main() {
  await initMenu();

  const raw = readFileSync(join(process.cwd(), "golden_dataset.json"), "utf-8");
  const testCases: TestCase[] = JSON.parse(raw);

  // Concurrency=1 + 2s inter-call delay in barista.ts keeps us well under
  // Tier 1's 50 req/min hard cap with zero 429s. Raise to 2 and remove the
  // delay in barista.ts when you upgrade to a higher-tier API plan.
  const CONCURRENCY = 1;

  const RESET = "\x1b[0m";
  const GREEN = "\x1b[32m";
  const RED = "\x1b[31m";
  const BOLD = "\x1b[1m";
  const DIM = "\x1b[2m";

  console.log(`\n${BOLD}AI Barista — Evaluation Suite${RESET}`);
  console.log(
    `Running ${testCases.length} test cases against Claude... (concurrency=${CONCURRENCY})\n`,
  );
  console.log("─".repeat(70));

  // Each task captures its index so we can print results in order as they finish.
  // A shared mutex-free counter tracks completed cases for the live progress line.
  let completed = 0;

  const tasks = testCases.map((tc, i) => async () => {
    const start = Date.now();
    const revert = await applySetup(tc.setup);
    let result: Awaited<ReturnType<typeof runTestCase>>;
    try {
      result = await runTestCase(tc);
    } finally {
      if (revert) await revert();
    }
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    completed++;
    return { tc, result: result!, elapsed, index: i };
  });

  // Run all tasks with bounded concurrency, collecting ordered results.
  const outcomes = await runWithConcurrency(tasks, CONCURRENCY);

  // Print results in original test-case order (not completion order) for
  // a stable, diff-friendly output — easier to spot regressions across runs.
  let passed = 0;
  let failed = 0;

  for (const { tc, result, elapsed } of outcomes) {
    const { pass, reason, toolsUsed } = result;
    const toolsSummary =
      toolsUsed.length > 0 ? `tools=[${toolsUsed.join(", ")}]` : "no tools";

    process.stdout.write(
      `${DIM}[${tc.id}]${RESET} ${tc.description}\n         `,
    );

    if (pass) {
      console.log(
        `${GREEN}PASS${RESET}  ${DIM}${toolsSummary} (${elapsed}s)${RESET}`,
      );
      passed++;
    } else {
      console.log(
        `${RED}FAIL${RESET}  ${DIM}${toolsSummary} (${elapsed}s)${RESET}`,
      );
      console.log(`         ${RED}↳ ${reason}${RESET}`);
      failed++;
    }
  }

  console.log("\n" + "─".repeat(70));

  if (failed === 0) {
    console.log(
      `${GREEN}${BOLD}All ${passed}/${testCases.length} tests passed.${RESET}\n`,
    );
  } else {
    console.log(
      `${BOLD}Results: ${GREEN}${passed} passed${RESET}${BOLD}, ${RED}${failed} failed${RESET}${BOLD} (${testCases.length} total)${RESET}\n`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

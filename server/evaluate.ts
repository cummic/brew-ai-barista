import { runBaristaChat, initMenu } from "./barista.js";
import type { OrderState } from "../shared/schema.js";
import { readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

interface TestCase {
  id: string;
  description: string;
  category: string;
  messages: string[];
  expectedTools: string[];
  expectNoSubmitOrder?: boolean;
  expectNoStoreInfo?: boolean;
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
  tc: TestCase
): Promise<{ pass: boolean; reason: string; toolsUsed: string[] }> {
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  let orderState = createOrderState();
  const allToolsUsed: string[] = [];
  let priceValidationFailed = false;

  for (const userMsg of tc.messages) {
    history.push({ role: "user", content: userMsg });

    try {
      const result = await runBaristaChat(history, orderState);
      history.push({ role: "assistant", content: result.message });
      allToolsUsed.push(...result.toolsUsed);
      orderState = { ...orderState, ...result.stateUpdates };

      if (result.toolsUsed.includes("calculate_total") && !result.validationPassed) {
        priceValidationFailed = true;
      }
    } catch (err) {
      return { pass: false, reason: `Exception thrown: ${err}`, toolsUsed: allToolsUsed };
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
      reason: "submit_order was called but should NOT have been (inventory restriction expected)",
      toolsUsed: allToolsUsed,
    };
  }

  if (tc.expectNoStoreInfo && allToolsUsed.includes("get_store_info")) {
    return {
      pass: false,
      reason: "get_store_info was called but location was ambiguous — should have asked for clarification first",
      toolsUsed: allToolsUsed,
    };
  }

  if (priceValidationFailed) {
    return {
      pass: false,
      reason: "Price validation failed: AI quoted an amount that doesn't match the calculate_total result",
      toolsUsed: allToolsUsed,
    };
  }

  return { pass: true, reason: "All checks passed", toolsUsed: allToolsUsed };
}

async function main() {
  await initMenu();

  const raw = readFileSync(join(process.cwd(), "golden_dataset.json"), "utf-8");
  const testCases: TestCase[] = JSON.parse(raw);

  const RESET = "\x1b[0m";
  const GREEN = "\x1b[32m";
  const RED = "\x1b[31m";
  const BOLD = "\x1b[1m";
  const DIM = "\x1b[2m";

  console.log(`\n${BOLD}AI Barista — Evaluation Suite${RESET}`);
  console.log(`Running ${testCases.length} test cases against Claude...\n`);
  console.log("─".repeat(70));

  let passed = 0;
  let failed = 0;

  for (const tc of testCases) {
    process.stdout.write(`${DIM}[${tc.id}]${RESET} ${tc.description}\n         `);

    const start = Date.now();
    const { pass, reason, toolsUsed } = await runTestCase(tc);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    const toolsSummary = toolsUsed.length > 0 ? `tools=[${toolsUsed.join(", ")}]` : "no tools";

    if (pass) {
      console.log(`${GREEN}PASS${RESET}  ${DIM}${toolsSummary} (${elapsed}s)${RESET}`);
      passed++;
    } else {
      console.log(`${RED}FAIL${RESET}  ${DIM}${toolsSummary} (${elapsed}s)${RESET}`);
      console.log(`         ${RED}↳ ${reason}${RESET}`);
      failed++;
    }
  }

  console.log("\n" + "─".repeat(70));

  if (failed === 0) {
    console.log(`${GREEN}${BOLD}All ${passed}/${testCases.length} tests passed.${RESET}\n`);
  } else {
    console.log(
      `${BOLD}Results: ${GREEN}${passed} passed${RESET}${BOLD}, ${RED}${failed} failed${RESET}${BOLD} (${testCases.length} total)${RESET}\n`
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

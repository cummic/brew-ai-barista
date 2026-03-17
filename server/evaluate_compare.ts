import { runBaristaChat, initMenu } from "./barista.js";
import type { OrderState } from "../shared/schema.js";
import { readFileSync, writeFileSync } from "fs";
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

interface Turn {
  role: "bootstrap" | "test";
  userMessage: string;
  assistantResponse: string;
  toolsUsed: string[];
  latencyMs: number;
}

interface TCResult {
  model: string;
  id: string;
  category: string;
  description: string;
  pass: boolean;
  reason: string;
  toolsUsed: string[];
  turns: Turn[];
  totalLatencyMs: number;
}

function createOrderState(): OrderState {
  return {
    sessionId: randomUUID(),
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

async function runTestCase(tc: TestCase, modelName: string): Promise<TCResult> {
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  let orderState = createOrderState();
  const testToolsUsed: string[] = [];
  const turns: Turn[] = [];
  let priceValidationFailed = false;
  const totalStart = Date.now();

  try {
    history.push({ role: "user", content: "Hello" });
    let t0 = Date.now();
    const greet = await runBaristaChat(history, orderState);
    turns.push({ role: "bootstrap", userMessage: "Hello", assistantResponse: greet.message, toolsUsed: greet.toolsUsed, latencyMs: Date.now() - t0 });
    history.push({ role: "assistant", content: greet.message });
    orderState = { ...orderState, ...greet.stateUpdates };

    history.push({ role: "user", content: "Eval" });
    t0 = Date.now();
    const nameStep = await runBaristaChat(history, orderState);
    turns.push({ role: "bootstrap", userMessage: "Eval", assistantResponse: nameStep.message, toolsUsed: nameStep.toolsUsed, latencyMs: Date.now() - t0 });
    history.push({ role: "assistant", content: nameStep.message });
    orderState = { ...orderState, ...nameStep.stateUpdates };
  } catch (err) {
    return {
      model: modelName, id: tc.id, category: tc.category, description: tc.description,
      pass: false, reason: `Bootstrap threw: ${err}`,
      toolsUsed: testToolsUsed, turns, totalLatencyMs: Date.now() - totalStart,
    };
  }

  for (const userMsg of tc.messages) {
    history.push({ role: "user", content: userMsg });
    const t0 = Date.now();
    try {
      const result = await runBaristaChat(history, orderState);
      turns.push({
        role: "test",
        userMessage: userMsg,
        assistantResponse: result.message,
        toolsUsed: result.toolsUsed,
        latencyMs: Date.now() - t0,
      });
      history.push({ role: "assistant", content: result.message });
      testToolsUsed.push(...result.toolsUsed);
      orderState = { ...orderState, ...result.stateUpdates };

      if (result.toolsUsed.includes("calculate_total") && !result.validationPassed) {
        priceValidationFailed = true;
      }
    } catch (err) {
      return {
        model: modelName, id: tc.id, category: tc.category, description: tc.description,
        pass: false, reason: `Exception thrown: ${err}`,
        toolsUsed: testToolsUsed, turns, totalLatencyMs: Date.now() - totalStart,
      };
    }
  }

  for (const tool of tc.expectedTools) {
    if (!testToolsUsed.includes(tool)) {
      return {
        model: modelName, id: tc.id, category: tc.category, description: tc.description,
        pass: false,
        reason: `Expected tool "${tool}" not called. Used: [${testToolsUsed.join(", ") || "none"}]`,
        toolsUsed: testToolsUsed, turns, totalLatencyMs: Date.now() - totalStart,
      };
    }
  }

  if (tc.expectNoSubmitOrder && testToolsUsed.includes("submit_order")) {
    return {
      model: modelName, id: tc.id, category: tc.category, description: tc.description,
      pass: false, reason: "submit_order was called but should NOT have been",
      toolsUsed: testToolsUsed, turns, totalLatencyMs: Date.now() - totalStart,
    };
  }

  if (tc.expectNoStoreInfo && testToolsUsed.includes("get_store_info")) {
    return {
      model: modelName, id: tc.id, category: tc.category, description: tc.description,
      pass: false, reason: "get_store_info was called but location was ambiguous",
      toolsUsed: testToolsUsed, turns, totalLatencyMs: Date.now() - totalStart,
    };
  }

  if (priceValidationFailed) {
    return {
      model: modelName, id: tc.id, category: tc.category, description: tc.description,
      pass: false, reason: "Price validation failed: AI quoted wrong amount",
      toolsUsed: testToolsUsed, turns, totalLatencyMs: Date.now() - totalStart,
    };
  }

  return {
    model: modelName, id: tc.id, category: tc.category, description: tc.description,
    pass: true, reason: "All checks passed",
    toolsUsed: testToolsUsed, turns, totalLatencyMs: Date.now() - totalStart,
  };
}

async function runModel(testCases: TestCase[], modelName: string): Promise<TCResult[]> {
  const RESET = "\x1b[0m";
  const GREEN = "\x1b[32m";
  const RED = "\x1b[31m";
  const DIM = "\x1b[2m";
  const BOLD = "\x1b[1m";

  const results: TCResult[] = [];
  let passed = 0;

  for (const tc of testCases) {
    const shortDesc = tc.description.length > 55 ? tc.description.slice(0, 52) + "..." : tc.description.padEnd(55);
    process.stdout.write(`  ${DIM}[${tc.id}]${RESET} ${shortDesc}  `);
    const result = await runTestCase(tc, modelName);
    const elapsed = (result.totalLatencyMs / 1000).toFixed(1);

    if (result.pass) {
      console.log(`${GREEN}${BOLD}PASS${RESET} ${DIM}(${elapsed}s)${RESET}`);
      passed++;
    } else {
      console.log(`${RED}${BOLD}FAIL${RESET} ${DIM}(${elapsed}s)${RESET}`);
      console.log(`         ${RED}↳ ${result.reason}${RESET}`);
    }

    results.push(result);
  }

  return results;
}

function categoryTable(
  categories: string[],
  haiku: TCResult[],
  sonnet: TCResult[],
): void {
  const RESET = "\x1b[0m";
  const GREEN = "\x1b[32m";
  const RED = "\x1b[31m";
  const BOLD = "\x1b[1m";
  const CYAN = "\x1b[36m";
  const DIM = "\x1b[2m";

  const haikuMap = new Map(haiku.map((r) => [r.id, r]));
  const sonnetMap = new Map(sonnet.map((r) => [r.id, r]));

  const catW = 26;
  const colW = 18;

  const header =
    `${BOLD}${"Category".padEnd(catW)}${"Haiku 4.5".padEnd(colW)}${"Sonnet 4.5".padEnd(colW)}${RESET}`;
  console.log(header);
  console.log("─".repeat(catW + colW * 2));

  let haikuTotal = 0, haikuPass = 0, sonnetTotal = 0, sonnetPass = 0;

  for (const cat of categories) {
    const haikuCat = haiku.filter((r) => r.category === cat);
    const sonnetCat = sonnet.filter((r) => r.category === cat);
    const hp = haikuCat.filter((r) => r.pass).length;
    const sp = sonnetCat.filter((r) => r.pass).length;
    const ht = haikuCat.length;
    const st = sonnetCat.length;
    haikuPass += hp; haikuTotal += ht;
    sonnetPass += sp; sonnetTotal += st;

    const hLabel = `${hp === ht ? GREEN : RED}${hp}/${ht} (${Math.round((hp / ht) * 100)}%)${RESET}`;
    const sLabel = `${sp === st ? GREEN : RED}${sp}/${st} (${Math.round((sp / st) * 100)}%)${RESET}`;
    const catDisplay = cat.replace(/_/g, " ").padEnd(catW);
    console.log(`${CYAN}${catDisplay}${RESET}${hLabel.padEnd(colW + 9)}${sLabel}`);
  }

  console.log("─".repeat(catW + colW * 2));
  const hOverall = `${haikuPass === haikuTotal ? GREEN : RED}${haikuPass}/${haikuTotal} (${Math.round((haikuPass / haikuTotal) * 100)}%)${RESET}`;
  const sOverall = `${sonnetPass === sonnetTotal ? GREEN : RED}${sonnetPass}/${sonnetTotal} (${Math.round((sonnetPass / sonnetTotal) * 100)}%)${RESET}`;
  console.log(`${BOLD}${"OVERALL".padEnd(catW)}${RESET}${hOverall.padEnd(colW + 9)}${sOverall}`);
  console.log();
}

function divergenceReport(haiku: TCResult[], sonnet: TCResult[]): void {
  const RESET = "\x1b[0m";
  const GREEN = "\x1b[32m";
  const RED = "\x1b[31m";
  const YELLOW = "\x1b[33m";
  const BOLD = "\x1b[1m";
  const DIM = "\x1b[2m";

  const passDivergences: Array<{ id: string; desc: string; hPass: boolean; sPass: boolean; hReason: string; sReason: string }> = [];
  const toolDivergences: Array<{ id: string; desc: string; hTools: string[]; sTools: string[] }> = [];

  const sonnetMap = new Map(sonnet.map((r) => [r.id, r]));

  for (const h of haiku) {
    const s = sonnetMap.get(h.id);
    if (!s) continue;

    if (h.pass !== s.pass) {
      passDivergences.push({ id: h.id, desc: h.description, hPass: h.pass, sPass: s.pass, hReason: h.reason, sReason: s.reason });
    }

    const hStr = h.toolsUsed.join(",");
    const sStr = s.toolsUsed.join(",");
    if (hStr !== sStr) {
      toolDivergences.push({ id: h.id, desc: h.description, hTools: h.toolsUsed, sTools: s.toolsUsed });
    }
  }

  if (passDivergences.length === 0 && toolDivergences.length === 0) {
    console.log(`${GREEN}${BOLD}No divergences — both models agree on all 18 test cases.${RESET}\n`);
    return;
  }

  if (passDivergences.length > 0) {
    console.log(`${RED}${BOLD}PASS/FAIL DIVERGENCES (${passDivergences.length})${RESET}`);
    console.log("─".repeat(70));
    for (const d of passDivergences) {
      console.log(`${BOLD}${d.id}${RESET} ${DIM}${d.desc}${RESET}`);
      console.log(`  Haiku:  ${d.hPass ? GREEN + "PASS" : RED + "FAIL"}${RESET}${d.hPass ? "" : " — " + d.hReason}`);
      console.log(`  Sonnet: ${d.sPass ? GREEN + "PASS" : RED + "FAIL"}${RESET}${d.sPass ? "" : " — " + d.sReason}`);
      console.log();
    }
  }

  if (toolDivergences.length > 0) {
    console.log(`${YELLOW}${BOLD}TOOL SEQUENCE DIFFERENCES (${toolDivergences.length})${RESET}`);
    console.log("─".repeat(70));
    for (const d of toolDivergences) {
      console.log(`${BOLD}${d.id}${RESET} ${DIM}${d.desc}${RESET}`);
      console.log(`  Haiku:  [${d.hTools.join(", ") || "none"}]`);
      console.log(`  Sonnet: [${d.sTools.join(", ") || "none"}]`);
      console.log();
    }
  }
}

async function main() {
  const RESET = "\x1b[0m";
  const BOLD = "\x1b[1m";
  const CYAN = "\x1b[36m";

  await initMenu();

  const raw = readFileSync(join(process.cwd(), "golden_dataset.json"), "utf-8");
  const testCases: TestCase[] = JSON.parse(raw);

  const MODELS: Array<{ name: string; envValue: string }> = [
    { name: "claude-haiku-4-5", envValue: "claude-haiku-4-5" },
    { name: "claude-sonnet-4-5", envValue: "claude-sonnet-4-5" },
  ];

  const allResults: Record<string, TCResult[]> = {};

  console.log(`\n${BOLD}Brew AI Barista — Cross-Model Comparison Eval${RESET}`);
  console.log(`${testCases.length} test cases × ${MODELS.length} models  (concurrency=1)\n`);

  for (const model of MODELS) {
    process.env.BREW_MODEL = model.envValue;
    console.log(`${CYAN}${BOLD}━━━ ${model.name} ━━━${RESET}`);
    const runStart = Date.now();
    const results = await runModel(testCases, model.name);
    const runElapsed = ((Date.now() - runStart) / 1000).toFixed(0);
    const passed = results.filter((r) => r.pass).length;
    console.log(`  → ${passed}/${results.length} passed in ${runElapsed}s\n`);
    allResults[model.name] = results;
  }

  const outPath = join(process.cwd(), "eval_comparison_results.json");
  writeFileSync(outPath, JSON.stringify(allResults, null, 2));
  console.log(`${BOLD}Raw results written to:${RESET} eval_comparison_results.json\n`);

  const seen = new Set<string>();
  const categories = testCases.map((tc) => tc.category).filter((c) => { if (seen.has(c)) return false; seen.add(c); return true; });

  console.log(`${BOLD}━━━ Category Summary ━━━${RESET}\n`);
  categoryTable(categories, allResults["claude-haiku-4-5"], allResults["claude-sonnet-4-5"]);

  console.log(`${BOLD}━━━ Divergence Analysis ━━━${RESET}\n`);
  divergenceReport(allResults["claude-haiku-4-5"], allResults["claude-sonnet-4-5"]);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { runBaristaChat, initMenu } from "./barista.js";
import type { OrderState } from "../shared/schema.js";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

const CREATE_TABLE_SQL = `
-- Run this once in your Supabase SQL editor before using judge or import-human modes:
CREATE TABLE IF NOT EXISTS eval_scores (
  id                    SERIAL PRIMARY KEY,
  test_case_id          TEXT NOT NULL,
  run_date              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  score_type            TEXT NOT NULL CHECK (score_type IN ('human', 'llm_judge')),
  stays_on_topic        TEXT,
  gets_order_right      TEXT,
  quality_of_suggestions TEXT,
  notes                 TEXT
);

-- If the table already exists, run this instead:
-- ALTER TABLE eval_scores
--   DROP COLUMN IF EXISTS warmth_friendliness,
--   DROP COLUMN IF EXISTS natural_tone,
--   DROP COLUMN IF EXISTS quality_of_alternatives,
--   ADD COLUMN IF NOT EXISTS gets_order_right TEXT,
--   ADD COLUMN IF NOT EXISTS quality_of_suggestions TEXT;
`.trim();

interface TestCase {
  id: string;
  description: string;
  category: string;
  messages: string[];
  expectedTools: string[];
  expectNoSubmitOrder?: boolean;
  expectNoStoreInfo?: boolean;
}

interface TestCaseResult {
  tc: TestCase;
  lastResponse: string;
  fullConversation: string;
}

interface JudgeScores {
  stays_on_topic: { score: number; reason: string };
  gets_order_right: { score: number; reason: string };
  quality_of_suggestions: { score: number | "N/A"; reason: string };
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("[quality] Supabase credentials not set");
  return createClient(url, key);
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

async function runTestCaseWithResponse(tc: TestCase): Promise<TestCaseResult> {
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  let orderState = createOrderState();

  history.push({ role: "user", content: "Hello" });
  const greet = await runBaristaChat(history, orderState);
  history.push({ role: "assistant", content: greet.message });
  orderState = { ...orderState, ...greet.stateUpdates };

  history.push({ role: "user", content: "Eval" });
  const nameStep = await runBaristaChat(history, orderState);
  history.push({ role: "assistant", content: nameStep.message });
  orderState = { ...orderState, ...nameStep.stateUpdates };

  let lastResponse = "";
  const turns: string[] = [];
  for (const userMsg of tc.messages) {
    history.push({ role: "user", content: userMsg });
    const result = await runBaristaChat(history, orderState);
    history.push({ role: "assistant", content: result.message });
    orderState = { ...orderState, ...result.stateUpdates };
    lastResponse = result.message;
    turns.push(`User: ${userMsg}\nAssistant: ${result.message}`);
  }

  return { tc, lastResponse, fullConversation: turns.join("\n\n") };
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function parseCsv(raw: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuote = false;

  const flushRow = () => {
    row.push(field);
    field = "";
    if (row.some((f) => f.trim() !== "")) {
      rows.push(row);
    }
    row = [];
  };

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inQuote) {
      if (ch === '"' && raw[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuote = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuote = true;
    } else if (ch === ',') {
      row.push(field);
      field = "";
    } else if (ch === '\r' && raw[i + 1] === '\n') {
      i++;
      flushRow();
    } else if (ch === '\n' || ch === '\r') {
      flushRow();
    } else {
      field += ch;
    }
  }

  if (field !== "" || row.length > 0) {
    flushRow();
  }

  return rows;
}

const judgeClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const JUDGE_MODEL = process.env.BREW_MODEL ?? "claude-haiku-4-5";

const JUDGE_SYSTEM = `You are an expert evaluator for a coffee shop ordering chatbot called Brew. Assess the quality of the assistant response on three dimensions.

IMPORTANT SCOPE CONSTRAINT: You are evaluating RESPONSE TEXT ONLY. You cannot see, and must not attempt to infer, whether any backend tools, API calls, or price calculations were executed correctly underneath the response. Those are covered by separate automated pass/fail checks. Your sole input is the text the assistant sent to the user — judge only that.

Return ONLY a valid JSON object with no other text:
{
  "stays_on_topic":          {"score": <1-5>,        "reason": "<one sentence>"},
  "gets_order_right":        {"score": <1-5>,        "reason": "<one sentence>"},
  "quality_of_suggestions":  {"score": <1-5|"N/A">, "reason": "<one sentence>"}
}

Rubrics:
- stays_on_topic (1-5): Is the response focused on coffee ordering? 5=fully on-topic; 1=wanders off-script.
- gets_order_right (1-5): Based solely on the visible response text — did the AI communicate clearly, handle the user's request appropriately, and avoid saying something wrong or harmful? Do NOT penalize a response for potentially missing backend behavior you cannot observe (e.g. whether a price was calculated correctly, whether a tool was called). Score only what the response text itself says or fails to say. Note: confirmation messages such as "You're all set!", "Your order is in!", or "Look for your name at the pickup area" are valid, correct order completions and should be scored 5 unless the response text itself contains a factual error or problem.
- quality_of_suggestions (1-5 or "N/A"): When an item or ingredient is unavailable, did the AI proactively offer the right alternative? 5=excellent suggestion; 1=just said no with no help. Use "N/A" if no substitution situation exists in this response.`;

async function judgeResponse(
  tcDescription: string,
  actualResponse: string,
): Promise<JudgeScores> {
  const response = await judgeClient.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 512,
    system: JUDGE_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Test case: ${tcDescription}\n\nAssistant response:\n${actualResponse}`,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Judge returned non-JSON: ${text}`);
  return JSON.parse(jsonMatch[0]) as JudgeScores;
}

function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length < 2) return null;
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  const num = xs.reduce((s, x, i) => s + (x - meanX) * (ys[i] - meanY), 0);
  const dX = Math.sqrt(xs.reduce((s, x) => s + (x - meanX) ** 2, 0));
  const dY = Math.sqrt(ys.reduce((s, y) => s + (y - meanY) ** 2, 0));
  if (dX === 0 || dY === 0) return null;
  return num / (dX * dY);
}

async function checkTableExists(): Promise<boolean> {
  const supabase = getSupabase();
  const { error } = await supabase.from("eval_scores").select("id").limit(1);
  if (
    error &&
    (error.message?.includes("relation") ||
      error.message?.includes("schema cache") ||
      error.message?.includes("does not exist") ||
      error.code === "PGRST116")
  ) {
    return false;
  }
  return true;
}

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";

function pad(s: string | number, n: number) {
  return String(s).padEnd(n).slice(0, n);
}

async function modeExport(testCases: TestCase[]) {
  console.log(`\n${BOLD}AI Barista — Quality Eval Export${RESET}`);
  console.log(`Running ${testCases.length} test cases to collect responses...\n`);
  console.log("─".repeat(70));

  const results: TestCaseResult[] = [];
  for (const tc of testCases) {
    process.stdout.write(`${DIM}[${tc.id}]${RESET} ${tc.description.slice(0, 50)}...`);
    try {
      const r = await runTestCaseWithResponse(tc);
      results.push(r);
      process.stdout.write(` ${GREEN}done${RESET}\n`);
    } catch (err) {
      process.stdout.write(` ${RED}ERROR: ${err}${RESET}\n`);
    }
  }

  const headers = [
    "test_case_id",
    "test_case_description",
    "actual_response",
    "full_conversation",
    "stays_on_topic",
    "gets_order_right",
    "quality_of_suggestions",
    "notes",
  ];

  const csvLines = [
    headers.map(csvEscape).join(","),
    ...results.map((r) =>
      [r.tc.id, r.tc.description, r.lastResponse, r.fullConversation, "", "", "", ""]
        .map(csvEscape)
        .join(","),
    ),
  ];

  const outPath = join(process.cwd(), "eval_quality_responses.csv");
  writeFileSync(outPath, csvLines.join("\n"), "utf-8");

  console.log("\n" + "─".repeat(70));
  console.log(
    `\n${BOLD}Exported ${results.length} responses → eval_quality_responses.csv${RESET}`,
  );
  console.log("Fill in the three rating columns (1-5 or N/A), then run:");
  console.log(
    "  npx tsx server/evaluate_quality.ts import-human eval_quality_responses.csv\n",
  );
}

async function modeJudge(testCases: TestCase[]) {
  const tableExists = await checkTableExists();
  if (!tableExists) {
    console.error(
      `\n${RED}eval_scores table not found. Run this SQL in your Supabase SQL editor first:\n\n${CREATE_TABLE_SQL}${RESET}\n`,
    );
    process.exit(1);
  }

  const supabase = getSupabase();
  console.log(`\n${BOLD}AI Barista — LLM Judge Mode${RESET}`);
  console.log(
    `Running ${testCases.length} test cases + judging with ${JUDGE_MODEL}...\n`,
  );
  console.log("─".repeat(70));

  const runDate = new Date().toISOString();
  let successCount = 0;

  for (const tc of testCases) {
    process.stdout.write(`${DIM}[${tc.id}]${RESET} Getting response...`);

    let result: TestCaseResult;
    try {
      result = await runTestCaseWithResponse(tc);
    } catch (err) {
      console.log(` ${RED}ERROR (conversation): ${err}${RESET}`);
      continue;
    }

    process.stdout.write(` judging...`);

    let scores: JudgeScores;
    try {
      scores = await judgeResponse(tc.description, result.lastResponse);
    } catch (err) {
      console.log(` ${RED}ERROR (judge): ${err}${RESET}`);
      continue;
    }

    const st = scores.stays_on_topic;
    const gor = scores.gets_order_right;
    const qs = scores.quality_of_suggestions;

    const { error } = await supabase.from("eval_scores").insert({
      test_case_id: tc.id,
      run_date: runDate,
      score_type: "llm_judge",
      stays_on_topic: String(st.score),
      gets_order_right: String(gor.score),
      quality_of_suggestions: String(qs.score),
      notes: [st.reason, gor.reason, qs.reason].join(" | "),
    });

    if (error) {
      console.log(` ${RED}DB ERROR: ${error.message}${RESET}`);
    } else {
      successCount++;
      const numericScores = [st.score, gor.score, qs.score].filter(
        (s): s is number => typeof s === "number",
      );
      const avg = numericScores.reduce((a, b) => a + b, 0) / numericScores.length;
      console.log(
        ` ${GREEN}done${RESET} ${DIM}st=${st.score} gor=${gor.score} qs=${qs.score} avg=${avg.toFixed(1)}${RESET}`,
      );
    }
  }

  console.log("\n" + "─".repeat(70));
  console.log(
    `\n${BOLD}LLM judge complete: ${successCount}/${testCases.length} scored and stored.${RESET}\n`,
  );
}

async function modeImportHuman(csvPath: string) {
  const tableExists = await checkTableExists();
  if (!tableExists) {
    console.error(
      `\n${RED}eval_scores table not found. Run this SQL in your Supabase SQL editor first:\n\n${CREATE_TABLE_SQL}${RESET}\n`,
    );
    process.exit(1);
  }

  const supabase = getSupabase();
  console.log(`\n${BOLD}AI Barista — Import Human Scores${RESET}`);
  console.log(`Reading: ${csvPath}\n`);
  console.log("─".repeat(70));

  const raw = readFileSync(csvPath, "utf-8");
  const rows = parseCsv(raw);
  if (rows.length < 2) {
    console.error("CSV has no data rows.");
    process.exit(1);
  }

  const header = rows[0].map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const idxId = idx("test_case_id");
  const idxSt = idx("stays_on_topic");
  const idxGor = idx("gets_order_right");
  const idxQs = idx("quality_of_suggestions");
  const idxNotes = idx("notes");

  if (idxId === -1) {
    console.error("CSV missing required column: test_case_id");
    process.exit(1);
  }

  const VALID = new Set(["1", "2", "3", "4", "5", "N/A", "n/a", ""]);
  const runDate = new Date().toISOString();
  let inserted = 0;
  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const testCaseId = row[idxId]?.trim();
    if (!testCaseId) continue;

    const st = (idxSt >= 0 ? row[idxSt] : "")?.trim() ?? "";
    const gor = (idxGor >= 0 ? row[idxGor] : "")?.trim() ?? "";
    const qs = (idxQs >= 0 ? row[idxQs] : "")?.trim() ?? "";
    const notes = (idxNotes >= 0 ? row[idxNotes] : "")?.trim() ?? "";

    const invalid = [st, gor, qs].filter((v) => v !== "" && !VALID.has(v));
    if (invalid.length > 0) {
      console.log(
        `${YELLOW}[${testCaseId}] Skipped — invalid values: ${invalid.join(", ")} (use 1-5 or N/A)${RESET}`,
      );
      skipped++;
      continue;
    }

    if (!st && !gor && !qs && !notes) {
      console.log(`${DIM}[${testCaseId}] Skipped — no scores filled in${RESET}`);
      skipped++;
      continue;
    }

    const normalize = (v: string) =>
      v.toUpperCase() === "N/A" ? "N/A" : v || null;

    const { error } = await supabase.from("eval_scores").insert({
      test_case_id: testCaseId,
      run_date: runDate,
      score_type: "human",
      stays_on_topic: normalize(st),
      gets_order_right: normalize(gor),
      quality_of_suggestions: normalize(qs),
      notes: notes || null,
    });

    if (error) {
      console.log(`${RED}[${testCaseId}] DB error: ${error.message}${RESET}`);
      skipped++;
    } else {
      console.log(`${GREEN}[${testCaseId}] Imported${RESET}`);
      inserted++;
    }
  }

  console.log("\n" + "─".repeat(70));
  console.log(
    `\n${BOLD}Import complete: ${inserted} inserted, ${skipped} skipped.${RESET}\n`,
  );
}

async function modeCompare() {
  const supabase = getSupabase();
  console.log(`\n${BOLD}AI Barista — Human vs LLM Judge Comparison${RESET}\n`);
  console.log("─".repeat(70));

  const { data: rows, error } = await supabase
    .from("eval_scores")
    .select("*")
    .order("test_case_id", { ascending: true })
    .order("run_date", { ascending: false });

  if (error) {
    if (
      error.message?.includes("relation") &&
      error.message?.includes("does not exist")
    ) {
      console.error(
        `\n${RED}eval_scores table not found. Run this SQL in your Supabase SQL editor first:\n\n${CREATE_TABLE_SQL}${RESET}\n`,
      );
    } else {
      console.error("Failed to fetch eval_scores:", error.message);
    }
    process.exit(1);
  }

  if (!rows || rows.length === 0) {
    console.log("No scores found in eval_scores. Run judge and/or import-human first.");
    return;
  }

  type ScoreRow = Record<string, string | null>;
  const byId: Record<string, { human?: ScoreRow; llm_judge?: ScoreRow }> = {};
  for (const row of rows as ScoreRow[]) {
    const id = row.test_case_id!;
    const type = row.score_type as "human" | "llm_judge";
    if (!byId[id]) byId[id] = {};
    if (!byId[id][type]) byId[id][type] = row;
  }

  const dimensions = [
    "stays_on_topic",
    "gets_order_right",
    "quality_of_suggestions",
  ] as const;
  const dimLabel: Record<string, string> = {
    stays_on_topic: "On Topic",
    gets_order_right: "Order Right",
    quality_of_suggestions: "Suggestions",
  };

  const COL_ID = 8;
  const COL_DIM = 15;
  const COL_SCORE = 7;
  const tableHeader =
    BOLD +
    pad("TC", COL_ID) +
    pad("Dimension", COL_DIM) +
    pad("Human", COL_SCORE) +
    pad("LLM", COL_SCORE) +
    "Diff" +
    RESET;

  console.log(`\n${tableHeader}`);
  console.log("─".repeat(42));

  const corrData: Record<string, { human: number[]; llm: number[] }> = {};
  for (const dim of dimensions) corrData[dim] = { human: [], llm: [] };

  for (const id of Object.keys(byId).sort()) {
    const entry = byId[id];
    for (const dim of dimensions) {
      const h = entry.human?.[dim] ?? "";
      const l = entry.llm_judge?.[dim] ?? "";
      const hNum = h === "" || h === "N/A" || h === null ? null : Number(h);
      const lNum = l === "" || l === "N/A" || l === null ? null : Number(l);
      const rawDiff =
        hNum !== null && lNum !== null ? hNum - lNum : null;
      const diffStr = rawDiff === null ? "—" : rawDiff.toFixed(1);
      const diffColored =
        rawDiff === null
          ? DIM + diffStr + RESET
          : Math.abs(rawDiff) <= 1
            ? GREEN + diffStr + RESET
            : YELLOW + diffStr + RESET;

      console.log(
        pad(id, COL_ID) +
          pad(dimLabel[dim], COL_DIM) +
          pad(h || "—", COL_SCORE) +
          pad(l || "—", COL_SCORE) +
          diffColored,
      );

      if (hNum !== null && lNum !== null) {
        corrData[dim].human.push(hNum);
        corrData[dim].llm.push(lNum);
      }
    }
    console.log(DIM + "─".repeat(42) + RESET);
  }

  console.log(`\n${BOLD}Pearson Correlation (Human vs LLM Judge)${RESET}`);
  console.log("─".repeat(42));
  for (const dim of dimensions) {
    const { human, llm } = corrData[dim];
    const r = pearson(human, llm);
    const label = dimLabel[dim].padEnd(16);
    if (r === null) {
      console.log(
        `${label} n=${human.length}  ${DIM}(insufficient paired data)${RESET}`,
      );
    } else {
      const bar = "█".repeat(Math.max(1, Math.round(Math.abs(r) * 10)));
      console.log(`${label} r=${r.toFixed(3)}  n=${human.length}  ${bar}`);
    }
  }
  console.log("");
}

async function main() {
  const mode = process.argv[2];

  if (!mode) {
    console.error(
      `\nUsage: npx tsx server/evaluate_quality.ts <mode>\n\n` +
        `Modes:\n` +
        `  export                          Run all test cases, export responses to CSV\n` +
        `  judge                           Run all test cases, score with LLM judge, store in Supabase\n` +
        `  import-human <path/to/csv>      Import human-rated CSV into Supabase\n` +
        `  compare                         Show side-by-side scores and Pearson correlations\n\n` +
        `Supabase table required for judge/import-human/compare:\n${CREATE_TABLE_SQL}\n`,
    );
    process.exit(1);
  }

  if (mode === "export" || mode === "judge") {
    await initMenu();
  }

  if (mode === "export" || mode === "judge") {
    const raw = readFileSync(
      join(process.cwd(), "golden_dataset.json"),
      "utf-8",
    );
    const testCases: TestCase[] = JSON.parse(raw);

    if (mode === "export") {
      await modeExport(testCases);
    } else {
      await modeJudge(testCases);
    }
  } else if (mode === "import-human") {
    const csvPath = process.argv[3];
    if (!csvPath) {
      console.error(
        "Usage: npx tsx server/evaluate_quality.ts import-human <path/to/csv>",
      );
      process.exit(1);
    }
    await modeImportHuman(csvPath);
  } else if (mode === "compare") {
    await modeCompare();
  } else {
    console.error(
      `Unknown mode: "${mode}"\nRun without arguments to see usage.`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

import { runBaristaChat } from "./barista.js";
// Adjust the path below if your schema is located elsewhere
import { OrderState } from "@shared/schema"; 
import testCases from "./golden_dataset.json" assert { type: "json" };

async function runEvaluations() {
  console.log("🚀 Starting BrewBot Claude 4.5 Evaluation...");
  console.log("-------------------------------------------------");

  let passedCount = 0;

  for (const test of testCases as any[]) {
    console.log(`🧪 Testing ID: ${test.id} - ${test.description}`);

    // Initialize a fresh state for each test case
    let currentState: OrderState = {
      location: null,
      drink: null,
      milkType: null,
      pastry: "none",
      tip: 0,
      stage: "idle",
      total: 0
    };

    let history: Array<{ role: "user" | "assistant"; content: string }> = [];

    try {
      let lastResponse: any;

      // Execute each step in the test case sequentially
      for (const step of test.steps) {
        history.push({ role: "user", content: step.content });

        lastResponse = await runBaristaChat(history, currentState);

        // Update history and state
        history.push({ role: "assistant", content: lastResponse.message });
        if (lastResponse.stateUpdates) {
          currentState = { ...currentState, ...lastResponse.stateUpdates };
        }
      }

      const toolsUsed = lastResponse.toolsUsed || [];
      const validationPassed = lastResponse.validationPassed;

      console.log(`   🤖 Brew: "${lastResponse.message.substring(0, 60)}..."`);

      if (validationPassed) {
        console.log(`   ✅ PASS: Calculation & Inventory check valid.`);
        passedCount++;
      } else {
        console.log(`   ❌ FAIL: Logic or Calculation mismatch.`);
        console.log(`      Tools used: ${toolsUsed.join(", ")}`);
      }
    } catch (error: any) {
      console.log(`   💥 ERROR: ${error.message}`);
    }
    console.log("-------------------------------------------------");
  }

  console.log(`\nFinal Result: ${passedCount}/${testCases.length} Tests Passed.`);
}

runEvaluations().catch(console.error);
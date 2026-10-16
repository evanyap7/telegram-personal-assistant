import assert from "node:assert/strict";
import {
  SPOKEN_INPUT_NOTE,
  spokenInputNote,
} from "../lib/agent/input-mode";

const sections: Array<{ name: string; run: () => void | Promise<void> }> = [];
function section(name: string, run: () => void | Promise<void>) {
  sections.push({ name, run });
}

// ---- sections ----

section("spoken input note applies only to voice", () => {
  assert.equal(spokenInputNote("voice"), SPOKEN_INPUT_NOTE);
  assert.equal(spokenInputNote("text"), "");
  assert.equal(spokenInputNote(undefined), "");
  assert.match(SPOKEN_INPUT_NOTE, /voice note/i);
  assert.match(SPOKEN_INPUT_NOTE, /confirm/i);
});

// ---- runner ----
async function main() {
  console.log("\n  🧠 EGO Orchestrator Tests\n");
  for (const s of sections) {
    await s.run();
    console.log(`  ✅ ${s.name}`);
  }
  console.log("\n  🎉 All EGO tests passed!\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

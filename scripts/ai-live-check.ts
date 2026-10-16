/**
 * One real call per Claude tier through the router's own parameter handling (temperature
 * stripped, output floor, effort). Spends a few cents. Uses a no-op ledger, so nothing is
 * written to Google Sheets.
 *
 * Usage: npm run check:ai-live
 */
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { createRouter, buildHandle } from "../lib/ai/router";
import { loadEnvLocal } from "./bench/util";

// 1x1 transparent PNG
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// The Claude provider bundles a newer copy of @ai-sdk/provider; same v4 spec, different nominal types.
const claudeModel = (modelId: string) => anthropic(modelId) as never;

async function run() {
  loadEnvLocal();
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set in .env.local.");
    process.exit(1);
  }

  const router = createRouter({
    ledger: {
      recordUsage: async () => {},
      checkWarnings: async () => {},
      alertDepleted: async () => {},
    },
    available: () => ({ gemini: false, perplexity: false, anthropic: true }),
    makeModel: (c) => claudeModel(c.modelId),
    generate: generateText,
  });

  const cases = [
    { modelId: "claude-haiku-5-5", role: "classifier" as const },
    { modelId: "claude-sonnet-5-5", role: "agent" as const },
    { modelId: "claude-opus-5-5", role: "agent" as const },
  ];

  let failed = false;
  for (const c of cases) {
    const handle = buildHandle({ provider: "anthropic", modelId: c.modelId }, c.role, (cand) =>
      claudeModel(cand.modelId)
    );
    const started = Date.now();
    try {
      const result = await router.runText(handle, {
        system: "Reply with exactly the word OK and nothing else.",
        prompt: "ping",
        temperature: 0, // must be stripped for Claude or the API returns a 400
        maxOutputTokens: 20, // must be floored: thinking is always on
      });
      console.log(
        `  ✅ ${c.modelId} [${c.role}] -> "${result.text.trim().slice(0, 40)}" (${result.usage.inputTokens} in / ${result.usage.outputTokens} out, ${Date.now() - started}ms)`
      );
      if (!/ok/i.test(result.text)) throw new Error(`unexpected reply: ${result.text}`);
    } catch (error) {
      failed = true;
      console.error(`  ❌ ${c.modelId}:`, error instanceof Error ? error.message : error);
    }
  }

  // Vision: Sonnet reads an image part the way lib/image-intent sends it.
  try {
    const handle = buildHandle({ provider: "anthropic", modelId: "claude-sonnet-5-5" }, "vision", (cand) =>
      claudeModel(cand.modelId)
    );
    const result = await router.runText(handle, {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image in five words or fewer." },
            { type: "file", data: Buffer.from(PNG_BASE64, "base64"), mediaType: "image/png" },
          ],
        },
      ],
      temperature: 0,
      maxOutputTokens: 200,
    });
    console.log(`  ✅ claude-sonnet-5-5 [vision] -> "${result.text.trim().slice(0, 60)}"`);
  } catch (error) {
    failed = true;
    console.error("  ❌ vision:", error instanceof Error ? error.message : error);
  }

  if (failed) process.exit(1);
  console.log("\n  🎉 Claude tiers respond through the router.\n");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

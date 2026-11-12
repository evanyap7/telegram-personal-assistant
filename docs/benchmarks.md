# Benchmarks

Re-run on **2026-11-03** at commit `5352d1c`, against the live model APIs.
These are the only figures the README, CV and portfolio quote. Re-run before
quoting any of them again, because model latency and prices change.

| Script | What it measures | Fixture |
| --- | --- | --- |
| `npm run eval:ego` | Whether the EGO orchestrator picks the right tool(s) | 39 messages (text, voice-style, multi-action and no-tool cases) in `scripts/eval-ego.ts` |
| `npm run bench:intent` | Latency of the intent classifier (`parseAssistantIntent`) | 21 messages × 3 runs = 63 calls |
| `npm run bench:cost` | Latency and cost of one classification call on each model | 21 messages per model |
| `npm run bench:parallel` | Receipt sync: sequential `await` vs `Promise.allSettled` | 6 receipt emails, run 3 times |

Models: `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`, Perplexity
`sonar`. Gemini (`gemini-3.6-flash`) handles voice-note transcription only and is
not benchmarked here.

## Routing accuracy (eval:ego)

**38 / 39 correct (97%)**, mean 3,198 ms per message.

The one miss: "what's the capital of Australia?" called no tool. It should have
called `webSearch`, but the model answered from its own knowledge.

This is my own set of 39 messages, not an independent benchmark. It checks
which tool is chosen, not whether the tool then does the right thing.

## Classifier latency (bench:intent)

`parseAssistantIntent()`, n = 63: median **2,146 ms**, p95 5,087 ms,
mean 2,538 ms, min 1,940 ms, max 5,747 ms.

## Cost and latency per classification call (bench:cost)

| Model | Median latency | p95 | Avg input / output tokens | Avg cost per call |
| --- | --- | --- | --- | --- |
| claude-haiku-5-5 | 1,183 ms | 3,070 ms | 10,135 / 70 | $0.001049 |
| claude-sonnet-5-5 | 1,698 ms | 2,412 ms | 10,135 / 56 | $0.020827 |
| claude-opus-5-5 | 2,164 ms | 4,550 ms | 10,135 / 60 | $0.041736 |
| sonar | 2,110 ms | 2,531 ms | 6,725 / 27 | $0.006752 |

On these figures a Haiku call is 95.0% cheaper than a Sonnet call, 97.5%
cheaper than Opus and 84.5% cheaper than Sonar.

**Caveats:**
- This compares single calls, one model each. It is **not** the cost of the
  tiered chain in production: how often a message falls through from Haiku to
  Sonnet or Opus has not been measured. Do not quote it as "the chain costs
  95% less".
- Costs are tokens × prices hard-coded in `scripts/bench/util.ts`, last
  checked against the vendors' pricing pages on 2026-10-17.

## Parallel receipt parsing (bench:parallel)

| Run | Sequential | Parallel | Reduction |
| --- | --- | --- | --- |
| 1 | 10,660 ms | 2,917 ms | 72.6% |
| 2 | | | 70.6% |
| 3 | | | 80.0% |

Mean reduction **about 74%** (6 receipts, 3 runs). Only run 1's timings were
kept. With 6 receipts each run is noisy, so quote the mean, not one run.

## Spoken replies: Gemini text-to-speech (Task 11 spike)

Measured on **2026-11-13**, live `gemini-3.8-flash-tts` (voice Kore) via
`streamGenerateContent`, one generic 20-word sentence, 10 sequential calls.
"First audio" is the time from sending the request to the first stream chunk
that carries audio data. No personal data was sent.

| Call | First audio | Full response |
| --- | --- | --- |
| 1 | 1,607 ms | 3,320 ms |
| 2 | 1,074 ms | 2,907 ms |
| 3 | 1,128 ms | 2,759 ms |
| 4 | 951 ms | 2,989 ms |
| 5 | 1,099 ms | 2,675 ms |
| 6 | 1,039 ms | 2,837 ms |
| 7 | 764 ms | 2,604 ms |
| 8 | 1,043 ms | 2,793 ms |
| 9 | 1,000 ms | 2,675 ms |
| 10 | 1,107 ms | 3,039 ms |

Median time to first audio **1,059 ms** (min 764 ms, max 1,607 ms), under the
2.5 s go/no-go limit. Median full-response time is about 2.8 s for 20 words.
`POST /api/ego/speak` returns one complete WAV, so what the app waits for is the
full-response figure, which grows with the length of the reply (capped at 400
characters). The time to first audio only applies if the response is streamed.

**Follow-up (client sentence chunks).** The app now splits a reply into sentence
chunks (the first about 100 characters, the rest up to 220) and requests each as
its own `/api/ego/speak` call, so the first sound waits only for the first chunk.
Measured on 2026-11-13, one generic 76-character sentence, 5 calls, whole
response: `generateContent` 3,177 to 3,909 ms (median 3,673 ms);
`streamGenerateContent` read to the end 2,180 to 2,621 ms (median 2,337 ms). The
route therefore uses the streaming endpoint, and the expected wait for the first
sound is about 2.3 s plus network and the orchestrator turn, whatever the reply
length. Two caveats: the chunk requests run in parallel and may slow each other,
and this was not measured end to end on a phone. Prosody can shift a little
between chunks.

## Older figures this replaces

Older copies of the README, CV and portfolio quote figures that these re-runs
do not support. Do not use:
- 34/35 (an older eval set);
- ~77% sync time (7 receipts, one run);
- ~65% lower cost per call (the old Gemini tiers);
- 29 intents at 100%.

# Guest range picker — design (small change)

Amends `2026-11-19-friend-scheduling-design.md`, section "Slot computation" ("max ~8 slots per reply; each shown with a button").

## Intent

Friends found the fixed 30-minute-step buttons stiff. The owner wants the bot to offer **free ranges**, and the friend picks a time **within** a range, then **picks a length**.

## Approaches

- **Range → start → length, buttons, message edited in place (chosen by the owner).** Fully tap-driven, no extra model calls, reuses the existing request path.
- Range → start → end time. Rejected by the owner: they want a length.
- Range → "type a time". Rejected: typing already works ("can we do Thu 3pm?"); the point is tap-to-select.

## Behaviour

1. **Availability reply.** The text stays as-is (free ranges per day, "nothing free" otherwise). Buttons become one per free range, label `Thu 19 Nov, 2:00–6:00 PM`, callback `g:w:<startSec>:<endSec>`, at most 10 buttons. The same range buttons replace the slot buttons in the "Sorry, that time isn't free." reply.
2. **Tap a range.** The bot edits that message to `Thu 19 Nov, 2:00–6:00 PM` + `Pick a start time:` with buttons every 30 minutes (`2:00 PM` … last start that leaves 30 free minutes), 4 per row, callback `g:s:<startSec>:<rangeEndSec>`.
3. **Tap a start.** The bot edits the message to `Thu 19 Nov, from 2:30 PM` + `How long?` with length buttons from **30 min, 1 hr, 1.5 hr, 2 hr, 3 hr, 4 hr**, only those that end by the range end and are still free, 3 per row, callback `g:r:<startSec>:<durMin>` (the existing request callback, unchanged).
4. **Tap a length.** The picker message's buttons are removed (best effort), then the existing request flow runs: re-check free, create the booking, ping the owner, reply "Sent — I'll let you know".

## Rules

- Every step re-reads busy time and filters with `isSlotFree` (padding, working hours 10:00–21:00, 14-day horizon, not in the past). Callback-encoded bounds only ever narrow choices; a forged range shows nothing that a typed request couldn't already reveal.
- If a tapped range or start has nothing left, the message is edited to `That time just filled up, ask me again for fresh times.` with no buttons.
- `g:w` / `g:s` parse strictly (`^g:[ws]:(\d{1,12}):(\d{1,12})$`, end > start, span ≤ 11 h). Approved friends only; each tap counts against the existing 30 messages/hour limit; private chats only (unchanged).
- Edits use plain text (`parseMode: null`). Callback data stays ≤ 64 bytes.
- Friend-bound text still contains only times and dates, never event detail.
- Owner side: unchanged.

## Left to the builder

Button label helpers, the `edit` dependency name, and removing the now-unused `pickCandidateSlots`.

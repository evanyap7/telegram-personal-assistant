# Guest Range Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Friends get free-range buttons, then pick a start time and a length inside the range, instead of fixed 30-minute slot buttons.

**Architecture:** Two new guest callbacks (`g:w` range, `g:s` start) edit the friend's message in place; the final length tap reuses the existing `g:r:<startSec>:<durMin>` request path. Every step re-reads busy time and filters with `isSlotFree`.

**Tech Stack:** TypeScript (node strip-types), Telegram inline keyboards, offline suite `scripts/test-guest.ts`.

**Spec:** `docs/superpowers/specs/2026-11-19-guest-range-picker-design.md`

## Global Constraints

- Lengths offered: 30, 60, 90, 120, 180, 240 minutes, labelled `30 min`, `1 hr`, `1.5 hr`, `2 hr`, `3 hr`, `4 hr`.
- Start times every 30 minutes; 4 start buttons per row, 3 length buttons per row; at most 10 range buttons.
- Callback formats: `g:w:<startSec>:<endSec>`, `g:s:<startSec>:<rangeEndSec>`, `g:r:<startSec>:<durMin>` (unchanged). All ≤ 64 bytes. `g:w`/`g:s` regex `^g:[ws]:(\d{1,12}):(\d{1,12})$`, end > start, span ≤ 11 h.
- Copy: `Pick a start time:`, `How long?`, `That time just filled up, ask me again for fresh times.`; range label `Thu 19 Nov, 2:00–6:00 PM`; start header `Thu 19 Nov, from 2:30 PM`; start button `2:30 PM`.
- Friend-bound text: times and dates only. Edits use `parseMode: null`. Owner side unchanged.
- `npm run check` green before every commit; no `--no-verify`; commits authored by the owner with no co-author trailer.

## Review Focus

- A range that filled up between the reply and the tap: the friend sees the "filled up" text, not stale buttons.
- A start whose longer lengths now overlap a new event: only lengths that are still free appear.
- Forged `g:w`/`g:s` data (outside working hours, past, beyond 14 days, huge span): no buttons beyond what `isSlotFree` allows; malformed data is ignored.
- Repeated length taps on the same picker: the keyboard is cleared before the request, so a second tap from the same message is not offered.
- Pending/blocked friends tapping `g:w`/`g:s`: answered and ignored, as `g:r` is today.

---

### Task 1: Range buttons and the start/length picker

**Files:**
- Modify: `lib/guest/handler.ts` (GuestDeps, buttons, callback handling)
- Modify: `lib/guest/copy.ts` (labels and copy)
- Modify: `lib/guest/slots.ts` (remove `pickCandidateSlots`)
- Modify: `lib/guest/index.ts` (default `edit` dep)
- Test: `scripts/test-guest.ts` (update fakes and the `g:r` button assertions in (j) and (l); add section (n))

**Interfaces:**
- Produces: `GuestDeps.edit(chatId: number, messageId: number, text: string, markup?: InlineKeyboardMarkup): Promise<void>`; default `editTelegramMessage(chatId, messageId, text, markup, null)`.
- Produces in `copy.ts`: `formatClock(ms: number): string` → `"2:30 PM"`; `formatLength(min: number): string` → `"30 min" | "1 hr" | "1.5 hr" | …`; `COPY.pickStart`, `COPY.pickLength`, `COPY.rangeGone`.
- Consumes: `computeGuestWindows`, `isSlotFree`, `requestSlot` (existing).

- [ ] **Step 1: Write the failing tests (section (n) in `scripts/test-guest.ts`)**, with `mk()` gaining an `edited: Array<{chatId, messageId, text, markup?}>` capture:
  - availability reply buttons are all `g:w:` and ≤ 64 bytes; one per free window; ≤ 10 total.
  - tapping `g:w` for 14:00–18:00 with no busy edits the message to text containing `Thu 19 Nov` and `Pick a start time:`, with `g:s:` buttons whose labels run `2:00 PM` … `5:30 PM` (8 buttons), rows of ≤ 4.
  - busy 15:00–16:00 inside that range: no start between 14:45 and 16:15 is offered (padding), e.g. `3:00 PM` and `4:00 PM` absent.
  - tapping `g:s` at 14:00 with range end 18:00 offers exactly `30 min, 1 hr, 1.5 hr, 2 hr, 3 hr, 4 hr` minus those past 18:00 → `30 min … 3 hr` (no `4 hr`), all `g:r:<14:00 sec>:<min>`.
  - busy 15:30–16:00 → lengths for 14:00 are only `30 min, 1 hr` (padding 15 min).
  - range fully busy at tap time → edit text is `That time just filled up, ask me again for fresh times.` and no buttons.
  - forged `g:w` at 23:00–23:59 or 30 days out → "filled up" edit, no buttons; malformed (`g:w:1`, `g:w:5:3`, span 12 h, `g:s:abc:1`) → no edit, no send, callback answered.
  - pending friend tapping `g:w` → answered, no edit.
  - `g:r` tap clears the picker keyboard (clearKeyboard called with that chat and message) and creates one booking; a `clearKeyboard` throw still creates the booking.
  - leak walk (l) taps `g:w` → `g:s` → `g:r` and still finds no secrets in friend text.
- [ ] **Step 2: Run** `node --experimental-strip-types scripts/test-guest.ts` — expected: the new (n) assertions FAIL.
- [ ] **Step 3: Implement** in the files above: `rangeButtons(days)` replacing `slotButtons`; `handlePickRange` / `handlePickStart` for `g:w` / `g:s` (fresh `getBusy(date, date)`, candidates filtered by `isSlotFree`, edit in place, "filled up" when empty); in the `g:r` branch call `clearKeyboard` in its own try/catch before `requestSlot`. Remove `pickCandidateSlots` and its tests.
- [ ] **Step 4: Run** `npm run check` — expected: exit 0, all suites pass.
- [ ] **Step 5: Commit** `feat(guest): range buttons with start and length picker`.

# EGO avatar shot list (Dreamina)

Source of truth: the owner's front/back/left/right character sheet (`docs/avatar/reference-sheet.png`, man in a navy suit with a burgundy tie). Use the **front view** as the reference image for every shot.

## Framing rules (identical for all nine frames)

- Head and shoulders, front-facing, centred, eyes at roughly 40% of the frame height.
- Square 1:1 output, at least 1024 x 1024.
- Same flat or softly lit background, same lighting direction and colour, same crop and scale in every frame.
- The face, hair, suit and tie must not change between frames. Only the listed part changes.
- No text, no watermark, no hands, no props.

## Workflow

1. Generate **neutral** first. Approve it.
2. Use the approved neutral frame as the reference image for the other eight, so the face does not drift.
3. After each batch, check that the frames align when stacked at the same size (flip between them). Regenerate any that shift.

## Prompts

Base clause for every prompt: `Same person, same navy suit, same burgundy tie, same framing, lighting and background as the reference. Change only:`

| # | File (`public/avatar/`) | Change only |
|---|---|---|
| 1 | `neutral.png` | Calm, relaxed neutral expression, mouth closed, eyes open and looking at the viewer. |
| 2 | `warm.png` | Gentle warm smile, mouth closed, eyes open and soft, slightly raised cheeks. |
| 3 | `focused.png` | Attentive, focused look, eyebrows slightly lowered, mouth closed and level, eyes open. |
| 4 | `concerned.png` | Concerned, eyebrows slightly raised and drawn together, mouth closed, slight frown, eyes open. |
| 5 | `blink.png` | Neutral expression with both eyes fully closed (a blink), mouth closed. |
| 6 | `mouth-closed.png` | Neutral expression, eyes open, lips gently closed. |
| 7 | `mouth-small.png` | Neutral expression, eyes open, lips slightly parted, a small opening, no teeth visible. |
| 8 | `mouth-open.png` | Neutral expression, eyes open, mouth open as when saying "ah", upper teeth visible. |
| 9 | `mouth-wide.png` | Neutral expression, eyes open, mouth open wide, as when speaking loudly, teeth visible. |

Frames 6 and 1 may be the same image if the neutral mouth is already closed; keep both files so the code has nine names.

## Consistency check

Stack the nine frames at the same size. Eyes, nose, collar and tie knot must sit in the same place. If the face drifts, regenerate with the neutral frame as the reference. If drift persists, the app falls back to full-frame crossfades between the nine images, which needs no region measurement.

## Cost

Nine images, plus regenerations. Dreamina charges credits per image, so each batch needs the owner's go-ahead before it is generated.

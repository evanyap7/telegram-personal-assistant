export type InputMode = "text" | "voice";

export const SPOKEN_INPUT_NOTE =
  'This message was spoken by the user as a voice note and transcribed automatically. Treat it as typed instructions, but expect transcription noise: misheard names, merchants, numbers and units. Turn spoken forms into values ("twelve fifty" is 12.50, "a hundred kilos for five" is 100 kg x 5, "tee bar row" is T-bar row). If a destructive or ambiguous change depends on a single word or number you are not sure you heard correctly, confirm with the user before acting.';

export function spokenInputNote(mode?: InputMode): string {
  return mode === "voice" ? SPOKEN_INPUT_NOTE : "";
}

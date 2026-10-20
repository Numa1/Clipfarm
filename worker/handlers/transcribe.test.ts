import { describe, expect, it } from "vitest";
import { transcribeArgs } from "./transcribe";

describe("transcribeArgs", () => {
  it("passes the detected language to whisper-cli, not a hardcoded one", () => {
    // Échantillon dont la détection renvoie "en" comme langue principale (commentaire de foot en anglais).
    const detectedLang = "en";
    const args = transcribeArgs("model.bin", "audio.wav", "out/transcript", detectedLang);
    expect(args).toContain("en");
    expect(args).not.toContain("fr");
    expect(args[args.indexOf("-l") + 1]).toBe("en");
  });

  it("still works for a French source", () => {
    const args = transcribeArgs("model.bin", "audio.wav", "out/transcript", "fr");
    expect(args[args.indexOf("-l") + 1]).toBe("fr");
  });
});

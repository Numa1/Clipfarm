import { describe, expect, it } from "vitest";
import { extractJson, formatTranscript, isForeignLine } from "./moments";

describe("moments", () => {
  it("extracts JSON from fenced or prose answers", () => {
    expect(extractJson('Voici :\n```json\n{"moments":[]}\n```')).toEqual({ moments: [] });
    expect(extractJson('Résultat {"moments":[{"a":1}]} fin')).toEqual({ moments: [{ a: 1 }] });
    expect(() => extractJson("# Titre sans JSON")).toThrow();
  });

  it("groups words into timestamped sentences", () => {
    const words = ["Salut.", "Ça", "va", "?"].map((w, i) => ({ w, start: i, end: i + 0.5 }));
    expect(formatTranscript(words)).toBe("[0.0] Salut.\n[1.0] Ça va ?");
  });

  it("flags English lines (game or clip voices) inside a French video", () => {
    expect(isForeignLine("Why did you get so mad when Coach gave us the game plan?")).toBe(true);
    expect(isForeignLine("Yeah, and life.")).toBe(true);
    expect(isForeignLine("On va boycotter ce canard d'Axel.")).toBe(false);
    expect(isForeignLine("Right now.")).toBe(false);
    expect(isForeignLine("C'est the best, je te jure, c'est pas possible.")).toBe(false);
    const words = ["But", "my", "turn", "never", "came.", "Bon,", "on", "y", "va."].map((w, i) => ({ w, start: i, end: i + 0.5 }));
    expect(formatTranscript(words)).toBe("[0.0] [VO] But my turn never came.\n[5.0] Bon, on y va.");
  });
});

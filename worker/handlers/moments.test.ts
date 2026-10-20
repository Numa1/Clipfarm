import { describe, expect, it } from "vitest";
import { extractJson, formatTranscript } from "./moments";

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
});

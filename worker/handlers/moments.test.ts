import { describe, expect, it } from "vitest";
import { extractJson, formatTranscript, isForeignLine, momentProblems } from "./moments";

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

  it("rejects moments that are too long or whose proof is not said inside them", () => {
    const said = "Salut Kylian, tu vas bien ? Je suis actuellement en live sur Twitch".split(" ");
    const words = said.map((w, i) => ({ w, start: 100 + i, end: 100.8 + i }));
    expect(momentProblems({ start: 99, end: 125, proof: "Salut Kylian, tu vas bien ?" }, words)).toEqual([]);
    // Light wording drift (punctuation, a missing word) is still the same quote.
    expect(momentProblems({ start: 99, end: 125, proof: "je suis en live sur Twitch" }, words)).toEqual([]);
    expect(momentProblems({ start: 99, end: 125, proof: "Kylian Mbappé rejoint le live" }, words)[0]).toMatch(/citation/);
    // Said, but outside the moment.
    expect(momentProblems({ start: 104, end: 125, proof: "Salut Kylian, tu vas bien" }, words)[0]).toMatch(/citation/);
    expect(momentProblems({ start: 99, end: 160, proof: "Salut Kylian" }, words)).toEqual(["dure 61 s, le maximum est 45 s"]);
    expect(momentProblems({ start: 99, end: 108, proof: "Salut Kylian" }, words)).toEqual(["dure 9 s, le minimum est 20 s"]);
  });

  it("accepte une plage de durée personnalisée au lieu des constantes par défaut", () => {
    const said = "Salut Kylian, tu vas bien ? Je suis actuellement en live sur Twitch".split(" ");
    const words = said.map((w, i) => ({ w, start: 100 + i, end: 100.8 + i }));
    // 9 s : rejeté par défaut (minimum 15 s), accepté avec une plage personnalisée plus courte.
    expect(momentProblems({ start: 99, end: 108, proof: "Salut Kylian" }, words)).toEqual(["dure 9 s, le minimum est 20 s"]);
    expect(momentProblems({ start: 99, end: 108, proof: "Salut Kylian" }, words, { min: 5, max: 50 })).toEqual([]);
    // 26 s : accepté par défaut, rejeté avec une plage personnalisée plus stricte, avec le message
    // reflétant la plage fournie plutôt que les valeurs fixes de la version par défaut.
    expect(momentProblems({ start: 99, end: 125, proof: "Salut Kylian, tu vas bien ?" }, words)).toEqual([]);
    expect(momentProblems({ start: 99, end: 125, proof: "Salut Kylian, tu vas bien ?" }, words, { min: 15, max: 20 })).toEqual([
      "dure 26 s, le maximum est 20 s",
    ]);
  });
});

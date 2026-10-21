import { describe, expect, it } from "vitest";
import type { Word } from "@/server/db/schema";
import { captionItemSchema } from "@/timeline/schema";
import { buildCaptionItems } from "./build";

function words(): Word[] {
  return [
    { w: "Salut", start: 10.0, end: 10.3 },
    { w: "tout", start: 10.3, end: 10.5 },
    { w: "le", start: 10.5, end: 10.6 },
    { w: "monde", start: 10.6, end: 11.0 },
    { w: "comment", start: 11.1, end: 11.4 },
    { w: "ça", start: 11.4, end: 11.5 },
    { w: "va", start: 11.5, end: 11.7 },
    // Voix du jeu / du clip regardé : pas un sous-titre du créateur.
    { w: "boss", start: 11.7, end: 12.0, vo: true },
    { w: "incoming", start: 12.0, end: 12.4, vo: true },
    { w: "ok", start: 12.6, end: 12.8 },
    { w: "on", start: 12.8, end: 12.9 },
    { w: "y", start: 12.9, end: 13.0 },
    { w: "va", start: 13.0, end: 13.2 },
  ];
}

describe("buildCaptionItems", () => {
  it("groupe 2 à 4 mots par sous-titre et exclut les répliques vo par défaut", () => {
    const items = buildCaptionItems(words(), 10, 13.2);

    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.words.length).toBeGreaterThanOrEqual(2);
      expect(item.words.length).toBeLessThanOrEqual(4);
    }

    const allText = items.flatMap((i) => i.words.map((w) => w.w));
    expect(allText).not.toContain("boss");
    expect(allText).not.toContain("incoming");
    expect(allText).toEqual(["Salut", "tout", "le", "monde", "comment", "ça", "va", "ok", "on", "y", "va"]);
  });

  it("inclut les répliques vo quand l'option est activée", () => {
    const items = buildCaptionItems(words(), 10, 13.2, { includeVo: true });
    const allText = items.flatMap((i) => i.words.map((w) => w.w));
    expect(allText).toContain("boss");
    expect(allText).toContain("incoming");
  });

  it("produit des items valides contre captionItemSchema", () => {
    const items = buildCaptionItems(words(), 10, 13.2);
    for (const item of items) {
      expect(() => captionItemSchema.parse(item)).not.toThrow();
    }
    // Les instants sont relatifs à `from` : le premier mot démarre à 0.
    expect(items[0].start).toBe(0);
  });

  it("limite l'extrait à la plage [from, to] et ignore les mots hors plage", () => {
    const items = buildCaptionItems(words(), 10.5, 11.5);
    const allText = items.flatMap((i) => i.words.map((w) => w.w));
    expect(allText).not.toContain("Salut");
    expect(allText).not.toContain("va");
  });
});

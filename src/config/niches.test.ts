import { describe, expect, it } from "vitest";
import { isNicheId, NICHE_IDS, NICHE_LIST, NICHES, nicheConfig } from "./niches";

const EXPECTED_NICHE_IDS = [
  "gaming",
  "football",
  "podcast",
  "interview",
  "humour",
  "vlog",
  "education",
  "autre",
] as const;

const VALID_STYLES = new Set(["epique", "chill", "humour", "humour-condense"]);
const VALID_CROP_MODES = new Set(["auto", "follow"]);
const SIGNAL_KEYS = [
  "speechRate",
  "contentVoiceRatio",
  "facecamPresence",
  "greenScreenRatio",
  "multiSpeakerCount",
  "onScreenMotion",
] as const;

describe("NICHES", () => {
  it("couvre exactement les 8 niches attendues", () => {
    expect(new Set(NICHE_IDS)).toEqual(new Set(EXPECTED_NICHE_IDS));
    expect(NICHE_IDS).toHaveLength(EXPECTED_NICHE_IDS.length);
  });

  it("a des identifiants uniques", () => {
    const ids = NICHE_LIST.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("a une clé d'objet identique à l'id de chaque niche", () => {
    for (const [key, niche] of Object.entries(NICHES)) {
      expect(niche.id).toBe(key);
    }
  });

  it.each(NICHE_LIST.map((n) => [n.id, n] as const))("niche '%s' a tous les champs requis et valides", (_id, niche) => {
    expect(typeof niche.id).toBe("string");
    expect(niche.id.length).toBeGreaterThan(0);

    expect(typeof niche.label).toBe("string");
    expect(niche.label.length).toBeGreaterThan(0);

    expect(VALID_STYLES.has(niche.defaultStyle)).toBe(true);
    expect(VALID_CROP_MODES.has(niche.defaultCropMode)).toBe(true);

    expect(niche.signalWeights).toBeDefined();
    for (const key of SIGNAL_KEYS) {
      const weight = niche.signalWeights[key];
      expect(typeof weight).toBe("number");
      expect(weight).toBeGreaterThanOrEqual(0);
      expect(weight).toBeLessThanOrEqual(1);
    }

    expect(typeof niche.promptHint).toBe("string");
    expect(niche.promptHint.length).toBeGreaterThan(0);
  });

  it("football utilise le mode de recadrage 'follow', les autres niches 'auto'", () => {
    expect(NICHES.football.defaultCropMode).toBe("follow");
    for (const niche of NICHE_LIST) {
      if (niche.id === "football") continue;
      expect(niche.defaultCropMode).toBe("auto");
    }
  });

  it("isNicheId reconnaît les identifiants valides et rejette les autres", () => {
    for (const id of EXPECTED_NICHE_IDS) {
      expect(isNicheId(id)).toBe(true);
    }
    expect(isNicheId("inexistante")).toBe(false);
  });

  it("nicheConfig retourne la config pour un id connu et undefined sinon", () => {
    expect(nicheConfig("podcast")?.label).toBe("Podcast");
    expect(nicheConfig("inexistante")).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { isStyleId, STYLE_IDS, STYLE_PRESET_LIST, STYLE_PRESETS, stylePreset } from "./presets";

const EXPECTED_STYLE_IDS = ["epique", "chill", "humour", "humour-condense"] as const;

const HOOK_TONES = new Set(["percutant", "mysterieux", "direct", "humoristique"]);
const ZOOM_FREQUENCIES = new Set(["aucun", "occasionnel", "frequent"]);

describe("STYLE_PRESETS", () => {
  it("couvre exactement les 4 styles attendus", () => {
    expect(new Set(STYLE_IDS)).toEqual(new Set(EXPECTED_STYLE_IDS));
    expect(STYLE_IDS).toHaveLength(EXPECTED_STYLE_IDS.length);
  });

  it("a une clé d'objet identique à l'id de chaque preset", () => {
    for (const [key, preset] of Object.entries(STYLE_PRESETS)) {
      expect(preset.id).toBe(key);
    }
  });

  it.each(STYLE_PRESET_LIST.map((p) => [p.id, p] as const))(
    "preset '%s' a tous les champs requis avec des valeurs dans des bornes raisonnables",
    (_id, preset) => {
      expect(typeof preset.label).toBe("string");
      expect(preset.label.length).toBeGreaterThan(0);

      // Plage de durée des moments : bornée et cohérente (min < max), proche de MOMENT_MIN_SEC/MAX_SEC.
      expect(preset.momentDuration.minSec).toBeGreaterThan(0);
      expect(preset.momentDuration.maxSec).toBeGreaterThan(preset.momentDuration.minSec);
      expect(preset.momentDuration.maxSec).toBeLessThanOrEqual(60);

      expect(typeof preset.momentPromptHint).toBe("string");
      expect(preset.momentPromptHint.length).toBeGreaterThan(10);

      // Silences : mêmes unités que MAX_SILENCE/SPEECH_PAD (src/timeline/silence.ts), valeurs > 0.
      expect(preset.silence.maxSilence).toBeGreaterThan(0);
      expect(preset.silence.maxSilence).toBeLessThanOrEqual(3);
      expect(preset.silence.speechPad).toBeGreaterThan(0);
      expect(preset.silence.speechPad).toBeLessThan(preset.silence.maxSilence);

      expect(preset.hook.teaserDurationSec).toBeGreaterThan(0);
      expect(preset.hook.teaserDurationSec).toBeLessThanOrEqual(5);
      expect(HOOK_TONES.has(preset.hook.tone)).toBe(true);

      expect(typeof preset.teaser.enabledByDefault).toBe("boolean");
      expect(preset.teaser.minMomentDurationSec).toBeGreaterThan(0);

      expect(preset.crop.holdSec).toBeGreaterThan(0);
      // splitRatio doit rester dans les bornes de shotSchema (variante "split") : [0.2, 0.7].
      expect(preset.crop.splitRatio).toBeGreaterThanOrEqual(0.2);
      expect(preset.crop.splitRatio).toBeLessThanOrEqual(0.7);

      expect(preset.caption.fontSize).toBeGreaterThan(0);
      expect(preset.caption.fontWeight).toBeGreaterThanOrEqual(100);
      expect(preset.caption.fontWeight).toBeLessThanOrEqual(900);
      expect(typeof preset.caption.color).toBe("string");
      expect(preset.caption.y).toBeGreaterThanOrEqual(0);
      expect(preset.caption.y).toBeLessThanOrEqual(1);

      // Même borne que CropKeyframe.zoom (src/timeline/schema.ts) : [1, 4].
      expect(preset.impactZoom.intensity).toBeGreaterThanOrEqual(1);
      expect(preset.impactZoom.intensity).toBeLessThanOrEqual(4);
      expect(ZOOM_FREQUENCIES.has(preset.impactZoom.frequency)).toBe(true);

      expect(typeof preset.music.mood).toBe("string");
      expect(preset.music.mood.length).toBeGreaterThan(0);
      // Même borne que audioItemSchema.volume (src/timeline/schema.ts) : [0, 2].
      expect(preset.music.defaultVolume).toBeGreaterThanOrEqual(0);
      expect(preset.music.defaultVolume).toBeLessThanOrEqual(2);
    },
  );

  it("les 4 presets sont bien distincts les uns des autres (pas 4 copies identiques)", () => {
    const serialized = STYLE_PRESET_LIST.map((p) => JSON.stringify(p));
    expect(new Set(serialized).size).toBe(serialized.length);

    // Quelques champs clés qui doivent varier d'un style à l'autre.
    const durations = STYLE_PRESET_LIST.map((p) => `${p.momentDuration.minSec}-${p.momentDuration.maxSec}`);
    expect(new Set(durations).size).toBeGreaterThan(1);

    const teaserDefaults = new Set(STYLE_PRESET_LIST.map((p) => p.teaser.enabledByDefault));
    expect(teaserDefaults.size).toBeGreaterThan(1);

    const zoomIntensities = new Set(STYLE_PRESET_LIST.map((p) => p.impactZoom.intensity));
    expect(zoomIntensities.size).toBeGreaterThan(1);

    const captionSizes = new Set(STYLE_PRESET_LIST.map((p) => p.caption.fontSize));
    expect(captionSizes.size).toBeGreaterThan(1);
  });

  it("humour-condense vise des moments plus courts que epique", () => {
    expect(STYLE_PRESETS["humour-condense"].momentDuration.maxSec).toBeLessThan(
      STYLE_PRESETS.epique.momentDuration.maxSec,
    );
  });

  it("isStyleId reconnaît les identifiants valides et rejette les autres", () => {
    for (const id of EXPECTED_STYLE_IDS) {
      expect(isStyleId(id)).toBe(true);
    }
    expect(isStyleId("inexistant")).toBe(false);
  });

  it("stylePreset retourne le preset pour un id connu et undefined sinon", () => {
    expect(stylePreset("chill")?.label).toBe("Chill");
    expect(stylePreset("inexistant")).toBeUndefined();
  });
});

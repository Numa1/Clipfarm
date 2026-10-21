import { describe, expect, it } from "vitest";
import { momentsPrompt, momentsPrompt2 } from "./moments";

describe("momentsPrompt (version 1)", () => {
  it("est inchangé par l'ajout de la version 2", () => {
    expect(momentsPrompt.id).toBe("moments");
    expect(momentsPrompt.version).toBe("1");
    expect(typeof momentsPrompt.system).toBe("string");
    expect(momentsPrompt.system).toContain("20 à 45 secondes");
  });
});

describe("momentsPrompt2 (version 2)", () => {
  it("a l'id 'moments' et la version '2'", () => {
    expect(momentsPrompt2.id).toBe("moments");
    expect(momentsPrompt2.version).toBe("2");
  });

  it("sans argument, reproduit le texte de durée de la version 1 et aucune consigne de niche", () => {
    const system = momentsPrompt2.system();
    expect(system).toContain("20 à 45 secondes");
    expect(system).toContain("end − start ≤ 45");
    expect(system).not.toContain("Contexte sur le type de contenu");
  });

  it("insère la consigne de niche fournie", () => {
    const system = momentsPrompt2.system({ nicheHint: "Contenu sportif : privilégie les temps forts." });
    expect(system).toContain("Contenu sportif : privilégie les temps forts.");
  });

  it("remplace la plage de durée 20–45 par la plage fournie", () => {
    const system = momentsPrompt2.system({ durationRange: [15, 50] });
    expect(system).toContain("15 à 50 secondes");
    expect(system).toContain("end − start ≤ 50");
    expect(system).not.toContain("20 à 45 secondes");
  });

  it("le prompt utilisateur reste celui de la version 1 (titre, créateur, transcription)", () => {
    const args = { title: "Titre test", creator: "Créateur", transcript: "[0.0] Salut" };
    expect(momentsPrompt2.build(args)).toBe(momentsPrompt.build(args));
  });
});

"use client";

import { Keyboard } from "@gravity-ui/icons";
import { Kbd, Modal } from "@heroui/react";

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: "Général",
    items: [["⌘B", "Afficher / masquer le menu"]],
  },
  {
    title: "Éditeur",
    items: [
      ["Espace", "Lecture / pause"],
      ["S", "Couper à la tête de lecture"],
      ["Suppr", "Supprimer la sélection"],
      ["Échap", "Désélectionner"],
      ["⌘Z", "Annuler"],
      ["⇧⌘Z", "Rétablir"],
      ["⌘ molette", "Zoom de la timeline"],
    ],
  },
];

export function ShortcutsDialog({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-sm">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-default text-foreground">
              <Keyboard className="size-5" />
            </Modal.Icon>
            <Modal.Heading>Raccourcis clavier</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="flex flex-col gap-5">
            {GROUPS.map((group) => (
              <section key={group.title} className="flex flex-col gap-2.5">
                <h3 className="text-xs font-medium text-muted">{group.title}</h3>
                <dl className="flex flex-col gap-2">
                  {group.items.map(([key, action]) => (
                    <div key={key} className="flex items-center justify-between gap-3 text-sm">
                      <dt>{action}</dt>
                      <dd>
                        <Kbd>
                          <Kbd.Content>{key}</Kbd.Content>
                        </Kbd>
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

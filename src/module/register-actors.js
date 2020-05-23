import ActorSheetPF2eCharacter from './actor/sheet/character.js';
import ActorSheetPF2eCharacterReadOnly from './actor/sheet/characterReadOnly.js';
import ActorSheetPF2eNPC from './actor/sheet/npc.js';
import UpdatedNPCActorPF2ESheet from './actor/sheet/updatednpcsheet.js';
import CRBStyleCharacterActorSheetPF2E from './actor/sheet/crb-style/crb-style.js';

function registerActors() {
  Actors.unregisterSheet('core', ActorSheet);

  // Register Character Sheet
  Actors.registerSheet('pf2e', ActorSheetPF2eCharacter, {
    types: ['character'],
    makeDefault: true,
  });

  // Register Read-Only Character Sheet
  Actors.registerSheet('pf2e', ActorSheetPF2eCharacterReadOnly, {
    types: ['character'],
    makeDefault: true,
  });

  // Register Character Sheet with new UI
/*   Actors.registerSheet('pf2e', CRBStyleCharacterActorSheetPF2E, {
    types: ['character'],
    makeDefault: false,
  }); */

  // Register NPC Sheet
  Actors.registerSheet('pf2e', ActorSheetPF2eNPC, {
    types: ['npc'],
    makeDefault: false,
  });

  // Register NPC Sheet
  Actors.registerSheet('pf2e', UpdatedNPCActorPF2ESheet, {
    types: ['npc'],
    makeDefault: true,
  });
}

export default registerActors;

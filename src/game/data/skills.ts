// Skill list. Levels are derived from xp via the curve in config.ts.
export interface SkillDef {
  id: string;
  name: string;
  kind: 'gather' | 'craft' | 'combat';
}

export const SKILLS: SkillDef[] = [
  { id: 'woodcutting', name: 'Woodcutting', kind: 'gather' },
  { id: 'mining',      name: 'Mining',  kind: 'gather' },
  { id: 'foraging',    name: 'Foraging',   kind: 'gather' },
  { id: 'crafting',    name: 'Crafting', kind: 'craft' },
  { id: 'smithing',    name: 'Smithing',  kind: 'craft' },
  { id: 'alchemy',     name: 'Alchemy',    kind: 'craft' },
  { id: 'combat',      name: 'Combat', kind: 'combat' },
  { id: 'firemaking',  name: 'Firemaking', kind: 'gather' },
];

// Skill list. Levels are derived from xp via the curve in config.ts.
export interface SkillDef {
  id: string;
  name: string;
  kind: 'gather' | 'craft' | 'combat';
}

export const SKILLS: SkillDef[] = [
  { id: 'woodcutting', name: 'Packet Harvesting', kind: 'gather' },
  { id: 'mining',      name: 'Spectrum Mining',  kind: 'gather' },
  { id: 'foraging',    name: 'Signal Foraging',   kind: 'gather' },
  { id: 'crafting',    name: 'Signal Processing', kind: 'craft' },
  { id: 'smithing',    name: 'Protocol Forging',  kind: 'craft' },
  { id: 'alchemy',     name: 'Packet Alchemy',    kind: 'craft' },
  { id: 'combat',      name: 'Protocol Enforcement', kind: 'combat' },
  { id: 'firemaking',  name: 'Signal Amplification', kind: 'gather' },
];

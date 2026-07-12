// Building database. `territory` is each building's contribution to your
// territory score — which drives income AND how hard the night hits back.
import type { Stack } from '../types';

export interface BuildingDef {
  id: string;
  name: string;
  desc: string;
  hp: number;
  cost: Stack[];
  pop: number;        // population added
  territory: number;  // territory score added
  unique: boolean;
  tower?: { rangeTiles: number; dmg: number; cooldown: number };
  dragPaint?: boolean; // hold + drag paints a line of these (walls)
  art: 'hall' | 'hut' | 'wall' | 'tower' | 'campfire';
}

const s = (id: string, n: number): Stack => ({ id, n });

export const BUILDINGS: BuildingDef[] = [
  {
    id: 'hall', name: 'Racket Hall',
    desc: 'The heart of the operation. Lose it and the racket is finished.',
    hp: 600, cost: [s('log', 10), s('stone', 5)],
    pop: 0, territory: 12, unique: true, art: 'hall',
  },
  {
    id: 'hut', name: 'Hut',
    desc: '+2 population. More cronies, more tribute.',
    hp: 140, cost: [s('plank', 6), s('stone', 4)],
    pop: 2, territory: 4, unique: false, art: 'hut',
  },
  {
    id: 'wall', name: 'Palisade',
    desc: 'Blocks the hungry things. They will chew through it eventually.',
    hp: 260, cost: [s('log', 2), s('stone', 1)],
    pop: 0, territory: 0, unique: false, dragPaint: true, art: 'wall',
  },
  {
    id: 'tower', name: 'Watchtower',
    desc: 'Shoots the nearest horror. Your best friend at 3am.',
    hp: 180, cost: [s('plank', 6), s('stone', 6), s('copper_bar', 1)],
    pop: 0, territory: 2, unique: false,
    tower: { rangeTiles: 5.5, dmg: 7, cooldown: 0.8 }, art: 'tower',
  },
  {
    id: 'campfire', name: 'Campfire',
    desc: 'Warmth, light, and a ward against the dark. Feeds on whatever tinder catches beneath it.',
    hp: 60, cost: [s('log', 3), s('stone', 2)],
    pop: 0, territory: 0, unique: false, art: 'campfire',
  },
];

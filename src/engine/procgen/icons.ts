// 16×16 item icons, procgen like everything else. Icons render in the DOM UI
// as data URLs; generated once per item at boot and cached.
import { Pix } from './sprites';
import { type RGB, lighten, darken } from './palette';

export interface IconSpec { kind: string; color: RGB; accent?: RGB }

const OUT: RGB = [20, 18, 28];

export function makeIcon(spec: IconSpec): HTMLCanvasElement {
  const p = new Pix(16, 16);
  const c = spec.color;
  const a = spec.accent ?? lighten(c, 30);
  switch (spec.kind) {
    case 'log':
      p.rect(2, 6, 13, 10, c);
      p.rect(12, 6, 13, 10, lighten(c, 26));   // cut end
      p.set(12, 8, darken(c, 10));             // ring
      p.rect(4, 7, 9, 7, darken(c, 14));       // bark line
      break;
    case 'plank':
      p.rect(1, 4, 14, 6, c);
      p.rect(2, 9, 15, 11, darken(c, 16));
      p.set(3, 5, darken(c, 30)); p.set(12, 5, darken(c, 30)); // nails
      break;
    case 'stone':
      p.rect(4, 6, 11, 12, c);
      p.rect(5, 5, 10, 5, c);
      p.rect(5, 6, 8, 8, lighten(c, 22));
      p.rect(5, 12, 11, 12, darken(c, 18));
      break;
    case 'ore':
      p.rect(4, 6, 11, 12, c);
      p.rect(5, 5, 10, 5, c);
      p.set(6, 8, a); p.set(9, 10, a); p.set(8, 7, lighten(a, 25)); p.set(5, 11, a);
      break;
    case 'bar':
      p.rect(3, 7, 12, 11, c);
      p.rect(4, 5, 11, 6, lighten(c, 24));     // top face
      p.set(5, 6, lighten(c, 45));             // shine
      p.rect(3, 11, 12, 11, darken(c, 20));
      break;
    case 'herb':
      for (let y = 6; y <= 13; y++) p.set(8, y, darken(c, 12)); // stem
      p.set(6, 7, c); p.set(7, 6, c); p.set(10, 8, c); p.set(9, 9, lighten(c, 15));
      p.set(6, 10, c); p.set(10, 11, c);
      p.set(8, 3, a); p.set(7, 4, lighten(a, 20)); p.set(9, 4, a); // flower
      break;
    case 'berry':
      p.set(7, 4, a); p.set(8, 4, a);          // leaf
      p.rect(4, 7, 6, 9, c); p.rect(8, 6, 10, 8, c); p.rect(6, 10, 8, 12, c);
      p.set(5, 7, lighten(c, 35)); p.set(9, 6, lighten(c, 35)); p.set(7, 10, lighten(c, 35));
      break;
    case 'axe':
      for (let i = 0; i < 8; i++) p.set(4 + i, 13 - i, a);      // handle
      p.rect(9, 3, 13, 7, c);                   // head
      p.rect(13, 3, 13, 7, lighten(c, 30));     // edge
      break;
    case 'pick':
      for (let i = 0; i < 8; i++) p.set(4 + i, 13 - i, a);      // handle
      p.rect(7, 3, 14, 4, c);                   // crossbar
      p.set(6, 4, c); p.set(6, 5, darken(c, 12));
      p.set(14, 5, c); p.set(15, 6, darken(c, 12));
      break;
    case 'sword':
      for (let i = 0; i < 7; i++) {             // blade
        p.set(11 - i, 3 + i, lighten(c, 20));
        p.set(12 - i, 3 + i, c);
      }
      p.set(4, 11, a); p.set(6, 9, a); p.set(5, 10, a); p.set(7, 10, a); // guard
      p.set(3, 12, darken(a, 10)); p.set(2, 13, darken(a, 10));          // grip
      break;
    case 'armor':
      p.rect(3, 5, 12, 7, c);                   // shoulders / pauldrons
      p.rect(4, 6, 11, 13, c);                  // torso
      p.rect(6, 4, 9, 6, darken(c, 22));        // neckline
      p.set(4, 6, a); p.set(11, 6, a);          // shoulder studs
      p.rect(5, 7, 6, 12, lighten(c, 22));      // left highlight
      p.rect(10, 7, 11, 12, darken(c, 16));     // right shade
      p.rect(4, 11, 11, 12, darken(c, 26));     // belt
      break;
    case 'potion':
      p.rect(7, 2, 8, 3, a);                    // cork
      p.rect(6, 4, 9, 5, lighten(c, 40));       // neck glass
      p.rect(5, 6, 10, 12, c);                  // liquid
      p.rect(4, 8, 4, 11, lighten(c, 40));      // glass edge
      p.rect(11, 8, 11, 11, darken(c, 15));
      p.set(6, 7, lighten(c, 45));              // shine
      break;
    case 'ring':
      // band as a square donut + gem on top
      p.rect(5, 7, 10, 7, c); p.rect(5, 12, 10, 12, darken(c, 12));
      p.rect(5, 8, 5, 11, c); p.rect(10, 8, 10, 11, darken(c, 8));
      p.set(6, 8, lighten(c, 30));               // band shine
      p.rect(7, 4, 8, 5, a); p.set(7, 4, lighten(a, 30)); // gem
      break;
    case 'amulet':
      // cord down to a pendant
      p.set(5, 3, darken(c, 20)); p.set(4, 4, darken(c, 20)); p.set(4, 5, darken(c, 20));
      p.set(10, 3, darken(c, 20)); p.set(11, 4, darken(c, 20)); p.set(11, 5, darken(c, 20));
      p.set(7, 3, darken(c, 20)); p.set(8, 3, darken(c, 20));
      p.rect(6, 7, 9, 11, c);                    // pendant body
      p.set(7, 8, a); p.set(8, 9, lighten(a, 20)); // inset stone
      p.rect(6, 11, 9, 11, darken(c, 18));
      break;
    case 'charm':
      // little carved totem with a glowing eye
      p.rect(6, 4, 9, 12, c);
      p.rect(6, 4, 9, 4, lighten(c, 20));
      p.set(7, 6, a); p.set(8, 6, a);            // eye band
      p.rect(6, 9, 9, 9, darken(c, 20));         // carve line
      p.set(5, 8, darken(c, 10)); p.set(10, 8, darken(c, 10)); // side notches
      p.set(7, 11, lighten(a, 15));              // lower glint
      break;
    case 'torch':
      for (let i = 0; i < 9; i++) p.set(4 + i, 14 - i, c);       // handle, diagonal like axe/pick
      p.set(12, 4, a); p.set(13, 3, lighten(a, 20)); p.set(14, 5, a); // flame
      p.set(13, 5, lighten(a, 10)); p.set(12, 6, darken(a, 10));
      break;
    case 'charcoal':
      p.rect(3, 8, 8, 12, c); p.rect(7, 6, 12, 10, darken(c, 8)); p.rect(4, 5, 9, 8, c);
      p.set(5, 9, a); p.set(9, 7, a); p.set(6, 6, lighten(a, 12));
      break;
    default:
      p.rect(4, 4, 11, 11, c);
  }
  p.outline(OUT);
  return p.done();
}

const cache = new Map<string, string>();

export function iconUrl(id: string, spec: IconSpec): string {
  let u = cache.get(id);
  if (!u) {
    u = makeIcon(spec).toDataURL();
    cache.set(id, u);
  }
  return u;
}

// ============================================================================
// N4.7 — Derived truths.
//
// The payoff phase, and the one phase that sends nothing new. Every input below
// is a reading some earlier N4 milestone already paid for: the colo code from
// `cdn-cgi/trace`, min_rtt from the deep wire's kernel socket dump, the
// timezone and language set from the vessel, the resource timing entries the
// browser has been filling in since the page loaded. What is new is the
// INFERENCE — combining measurements that were sitting in the same object
// without ever being asked a question together.
//
// Three truths ship here:
//
//   1. **The Straight Path.** Speed-of-light efficiency. Compare the RTT you
//      measured against the RTT physics allows for that distance. A ratio near
//      1 means near-optimal routing; 3x means the packets are touring. This is
//      a real network-engineering metric that almost no consumer tool surfaces,
//      and it is the only reading in the game whose floor is a law of physics.
//
//   2. **The Masking.** VPN / proxy evidence, honestly hedged. Four independent
//      signals, each individually weak, presented as EVIDENCE WITH CONFIDENCE
//      and never as a verdict. This distinction is the whole design: three
//      agreeing signals is a strong case, and a strong case is still not proof.
//
//   3. **Protocol reality.** Which wire protocol each host actually negotiated,
//      from `nextHopProtocol` on the timing entries. Whether a connection is
//      QUIC changes everything about how it behaves under loss, and the game
//      has been treating h3 and http/1.1 as the same thing.
//
// ---------------------------------------------------------------------------
// What this file is careful about
// ---------------------------------------------------------------------------
//
// Every function here is PURE against a snapshot. No timers, no fetches, no
// observers, no state of its own. That is not tidiness — it is what makes these
// testable at all. An inference that can only be checked by having the right
// network is an inference nobody will ever check.
// ============================================================================
import {
  COLOS, COLO_COUNTRY, coordForZone, fibreFloorMs, greatCircleKm, horizonKm, reachErrorKm,
} from '../data/geodesy';

// ------------------------------------------------------- 1. THE STRAIGHT PATH

export interface StraightPath {
  /** The colo's IATA code, or '' when unknown. */
  colo: string;
  /** True when the colo code resolved to a coordinate in the table. */
  coloKnown: boolean;
  /** Measured round trip used for the arithmetic, ms. 0 = nothing to measure. */
  rttMs: number;
  /** Which reading `rttMs` came from — the Lens must say, because a kernel
   *  min_rtt and a browser-bucketed connection.rtt are not the same evidence. */
  rttSource: 'kernel min_rtt' | 'browser estimate' | 'none';
  /** THE HORIZON — the furthest the edge can possibly be, km. Needs no
   *  coordinate at all: physics, and nothing else. 0 when rtt is unknown. */
  horizonKm: number;
  /** THE REACH — great-circle distance to the colo, km, using a timezone-
   *  estimated client position. 0 when either coordinate is missing. */
  reachKm: number;
  /** Plus-or-minus on the above, km. Stated rather than hidden. */
  reachErrKm: number;
  /** The RTT physics allows for `reachKm` of straight fibre, ms. */
  floorMs: number;
  /** measured / floor. 1.0 = the packets went straight. 0 = no reading. */
  efficiency: number;
  /** A veil-legal reading of `efficiency` (pillar 7). */
  verdict: string;
}

/** No colo, no rtt, no reading — and every number neutral rather than zero-as-
 *  a-value. `efficiency: 0` is the sentinel for "unmeasured" and every consumer
 *  checks it before dividing. */
export function noPath(): StraightPath {
  return {
    colo: '', coloKnown: false, rttMs: 0, rttSource: 'none',
    horizonKm: 0, reachKm: 0, reachErrKm: 0, floorMs: 0, efficiency: 0,
    verdict: 'no path to measure yet',
  };
}

/** Compute the straight-path reading from a network snapshot.
 *
 *  `pulseMs` (the kernel's own min_rtt, from N4.1's deep wire) is strongly
 *  preferred over `rtt`. min_rtt is the LOWEST round trip that socket has ever
 *  seen, which is exactly the physical floor this metric wants; `connection.rtt`
 *  is a smoothed estimate quantised to 25 ms buckets, and at short distances
 *  the bucket is larger than the entire measurement. Using it would routinely
 *  produce efficiency ratios under 1 — a result that says the packets beat the
 *  speed of light, which would discredit the whole panel. */
export function straightPath(snap: any, timeZone: string): StraightPath {
  const out = noPath();
  const colo = String(snap?.colo ?? '').trim();
  if (colo && colo !== '...') out.colo = colo;

  const deep = snap?.deepLive && snap?.pulseMs > 0;
  if (deep) { out.rttMs = snap.pulseMs; out.rttSource = 'kernel min_rtt'; }
  else if (snap?.rtt > 0) { out.rttMs = snap.rtt; out.rttSource = 'browser estimate'; }
  if (out.rttMs > 0) out.horizonKm = Math.round(horizonKm(out.rttMs));

  const edge = out.colo ? COLOS[out.colo] : undefined;
  out.coloKnown = !!edge;
  const here = coordForZone(timeZone);
  if (!edge || !here || out.rttMs <= 0) {
    out.verdict = !out.colo ? 'the edge has not named itself'
      : !edge ? `${out.colo} is not in the colo table`
      : !here ? 'this timezone is not in the table'
      : 'no round trip measured yet';
    return out;
  }

  out.reachKm = Math.round(greatCircleKm(here, edge));
  out.reachErrKm = reachErrorKm(here);
  out.floorMs = fibreFloorMs(out.reachKm);

  // THE PHYSICS CHECKS THE GUESS.
  //
  // The horizon is a hard bound and the reach is an estimate, so when the
  // estimate exceeds the bound the estimate is REFUTED — not by a heuristic,
  // by the speed of light. Either the timezone does not match where the machine
  // physically is (a traveller, a VPN, a server in another country, a browser
  // pinned to UTC), or the colo code resolved to the wrong site.
  //
  // The first version of this printed an efficiency of 0.5 and a verdict of
  // "faster than the glass allows", which is a true sentence that reads as a
  // bug. Refusing outright is the better answer, and it is a genuinely stronger
  // inference: we now know something specific and provable about the estimate
  // rather than merely distrusting it. The `unmasked` half of THE MASKING is
  // interested in exactly this, which is why the reason says so.
  if (out.horizonKm > 0 && out.reachKm > out.horizonKm) {
    out.verdict = `the reach estimate is impossible — ${out.reachKm.toLocaleString()} km is past a `
      + `${out.horizonKm.toLocaleString()} km horizon, so this timezone is not where this machine is`;
    out.efficiency = 0;
    return out;
  }
  // A floor under a tenth of a millisecond means the estimate put the player
  // essentially on top of the colo, and dividing by it produces an efficiency
  // of several hundred that is entirely an artefact of the estimate. Refuse
  // rather than print it: this panel's whole value is that it does not lie.
  if (out.floorMs < 0.1) {
    out.verdict = 'the edge is too close to measure against';
    return out;
  }
  out.efficiency = out.rttMs / out.floorMs;
  out.verdict = pathVerdict(out.efficiency, out.rttSource);
  return out;
}

/** Pillar 7: the sense, not the instrument. Nobody reads "1.8x the fibre floor"
 *  as a feeling; everybody reads "the road bends, but it goes where it means to". */
function pathVerdict(eff: number, src: StraightPath['rttSource']): string {
  const hedge = src === 'browser estimate' ? ' (from a bucketed estimate — treat loosely)' : '';
  if (eff < 1) return 'faster than the glass allows — the estimate is off, not the physics' + hedge;
  if (eff < 1.6) return 'the road runs straight' + hedge;
  if (eff < 2.5) return 'the road bends, but it goes where it means to' + hedge;
  if (eff < 4) return 'the road wanders' + hedge;
  return 'your packets are seeing the country' + hedge;
}

// ------------------------------------------------------------ 2. THE MASKING

export interface MaskSignal {
  /** Short label for the evidence row. */
  name: string;
  /** True when this signal points at a proxy. */
  hit: boolean;
  /** What was actually compared — shown verbatim, so a player can disagree. */
  detail: string;
  /** How much this one signal is worth, 0..1. None of them is worth 1. */
  weight: number;
}

export interface MaskEvidence {
  signals: MaskSignal[];
  /** Summed weight of the signals that hit, 0..1. */
  confidence: number;
  /** none / weak / mixed / strong. Never 'yes'. */
  band: 'none' | 'weak' | 'mixed' | 'strong';
  verdict: string;
}

/** Country a language tag implies, roughly. Only the unambiguous ones: `en`
 *  implies nothing (it is spoken everywhere), `ja` implies Japan very strongly.
 *  A language that implies nothing must contribute NOTHING, not a small
 *  suspicion — half the false positives in commercial VPN detection come from
 *  treating a weak signal as a faint strong one. */
const LANG_COUNTRY: Record<string, string[]> = {
  ja: ['JP'], ko: ['KR'], th: ['TH'], vi: ['VN'], he: ['IL'], el: ['GR'],
  hu: ['HU'], cs: ['CZ'], sk: ['SK'], pl: ['PL'], ro: ['RO'], bg: ['BG'],
  hr: ['HR'], sr: ['RS'], sl: ['SI'], lt: ['LT'], lv: ['LV'], et: ['EE'],
  fi: ['FI'], da: ['DK'], nb: ['NO'], no: ['NO'], sv: ['SE'], is: ['IS'],
  tr: ['TR'], uk: ['UA'], fa: ['IR'], hi: ['IN'], bn: ['BD', 'IN'],
  ta: ['IN', 'LK'], te: ['IN'], mr: ['IN'], id: ['ID'], ms: ['MY'], tl: ['PH'],
};

/** Words that appear in the reverse-DNS name of a datacentre and effectively
 *  never in a residential one. Deliberately short: a long list catches more
 *  and is wrong more, and this signal is only worth 0.3 either way. */
const HOSTING_WORDS = [
  'hosting', 'host', 'server', 'datacenter', 'datacentre', 'colo', 'cloud',
  'vps', 'dedicated', 'ovh', 'hetzner', 'linode', 'digitalocean', 'vultr',
  'leaseweb', 'contabo', 'choopa', 'amazonaws', 'azure', 'googleusercontent',
];

/** Four independent signals, cross-checked. None is a verdict on its own.
 *
 *  `ptr` is the reverse-DNS name of the public IP, which N4.0 already resolves.
 *  `timeZone` and `languages` come from the vessel. Everything else is on the
 *  snapshot.
 *
 *  The design constraint that matters: a false positive here accuses a player
 *  of something. Somebody legitimately living abroad, or running a browser in a
 *  second language, or on a mobile carrier whose CGNAT reverse-DNS mentions
 *  "cloud", must never see the word "VPN" stated as fact. Hence bands rather
 *  than a boolean, and hence `verdict` reads as a description of the EVIDENCE
 *  rather than of the person. */
export function maskEvidence(
  snap: any, timeZone: string, languages: string[], ptr: string, path?: StraightPath,
): MaskEvidence {
  const signals: MaskSignal[] = [];
  const country = String(snap?.country ?? '').toUpperCase();
  const colo = String(snap?.colo ?? '').toUpperCase();

  // 1. WARP. Cloudflare telling us outright that this connection is theirs.
  //    The strongest signal available and still not conclusive — WARP is a
  //    privacy tool a lot of people simply leave on.
  signals.push({
    name: 'Cloudflare WARP',
    hit: !!snap?.warp,
    detail: snap?.warp ? 'the edge reports warp=on' : 'the edge reports warp=off',
    weight: 0.45,
  });

  // 2. Timezone vs the country the network claims. Strong when it fires: a
  //    machine set to Europe/Berlin whose packets emerge in Singapore is a real
  //    mismatch. Skipped entirely — not counted as a miss — when either half is
  //    unknown, because "we could not check" is not evidence of innocence any
  //    more than of guilt.
  //
  //    Checked against the country the network CLAIMS (`cdn-cgi/trace` loc)
  //    where that is known, and only against the colo's own country as a
  //    fallback. Those are different questions — "where does the network think
  //    I am" versus "where do my packets emerge" — and the first is the one the
  //    plan asks and the sharper of the two, because Cloudflare deliberately
  //    routes you to a nearby edge and the colo therefore agrees with the claim
  //    almost by construction.
  const zoneRegion = timeZone.split('/')[0] ?? '';
  const claimed = country && country !== '..' ? country : (COLO_COUNTRY[colo] ?? '');
  const against = country && country !== '..' ? 'the network says' : `a ${claimed} edge (${colo})`;
  if (claimed && zoneRegion) {
    signals.push({
      name: 'Timezone vs country',
      hit: !zoneMatchesCountry(zoneRegion, claimed),
      detail: `${timeZone} against ${against} ${country && country !== '..' ? country : ''}`.trim(),
      weight: 0.30,
    });
  }

  // 3. Language vs country. Only fires on languages that actually imply a
  //    country — `en` implies nothing and contributes nothing.
  const primary = (languages[0] ?? '').split('-')[0].toLowerCase();
  const implied = LANG_COUNTRY[primary];
  if (implied && country && country !== '..') {
    signals.push({
      name: 'Language vs country',
      hit: !implied.includes(country),
      detail: `${primary} usually means ${implied.join('/')}; the network says ${country}`,
      weight: 0.25,
    });
  }

  // 4. Reverse-DNS naming. A residential connection's PTR is an ISP's
  //    subscriber pattern; a datacentre's says so in words.
  const p = (ptr ?? '').toLowerCase();
  if (p) {
    const word = HOSTING_WORDS.find((w) => p.includes(w));
    signals.push({
      name: 'Address naming',
      hit: !!word,
      detail: word ? `the address is named "…${word}…"` : 'the address reads as a subscriber line',
      weight: 0.30,
    });
  }

  // 5. THE PHYSICS. Not in the plan's list of four, and the strongest of the
  //    five when it fires, because it is not a heuristic at all: if the
  //    great-circle distance from the timezone's position to the edge is
  //    further than light in fibre could have covered in the measured round
  //    trip, then the machine is provably not in that timezone's region. No
  //    weighting judgement, no cultural assumption, no list of suspicious
  //    words — a bound that cannot be argued with.
  //
  //    It is still worth 0.4 rather than 1.0, because "this machine is not
  //    where its clock says" has innocent explanations too: a traveller who
  //    never changed the setting, a VM with a UTC clock, a browser deliberately
  //    reporting UTC for privacy. It proves a displacement, not a proxy.
  if (path && path.reachKm > 0 && path.horizonKm > 0) {
    signals.push({
      name: 'Physics vs timezone',
      hit: path.reachKm > path.horizonKm,
      detail: path.reachKm > path.horizonKm
        ? `${path.reachKm.toLocaleString()} km to ${path.colo}, past a ${path.horizonKm.toLocaleString()} km horizon`
        : `${path.reachKm.toLocaleString()} km to ${path.colo}, inside a ${path.horizonKm.toLocaleString()} km horizon`,
      weight: 0.40,
    });
  }

  let confidence = 0;
  for (const s of signals) if (s.hit) confidence += s.weight;
  confidence = Math.min(1, confidence);

  const band: MaskEvidence['band'] =
    confidence >= 0.7 ? 'strong' : confidence >= 0.4 ? 'mixed' : confidence > 0 ? 'weak' : 'none';

  return {
    signals, confidence, band,
    verdict: {
      none: 'nothing here suggests you are wearing someone else’s face',
      weak: 'one thread points somewhere else — on its own, that is nothing',
      mixed: 'two readings disagree about where you are',
      strong: 'several independent readings agree you are not where you appear',
    }[band],
  };
}

/** Does an IANA zone's top-level region plausibly contain a country code?
 *
 *  Coarse on purpose. The check is "Europe/Berlin vs a SG edge", not
 *  "Europe/Berlin vs a FR edge" — a European player routed to a neighbouring
 *  country's colo is the NORMAL case and must never register as evidence.
 *  Continent-level is the only granularity at which this signal is honest. */
function zoneMatchesCountry(zoneRegion: string, country: string): boolean {
  const R: Record<string, string[]> = {
    Europe: ['GB', 'IE', 'FR', 'DE', 'NL', 'BE', 'LU', 'CH', 'AT', 'IT', 'ES', 'PT', 'DK',
      'SE', 'NO', 'FI', 'IS', 'PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'HR', 'RS', 'SI', 'GR',
      'EE', 'LV', 'LT', 'UA', 'TR', 'RU', 'MD', 'BA', 'MK', 'AL', 'ME', 'MT', 'CY'],
    America: ['US', 'CA', 'MX', 'BR', 'AR', 'CL', 'CO', 'PE', 'EC', 'PA', 'CR', 'VE', 'UY',
      'PY', 'BO', 'GT', 'CU', 'DO', 'PR', 'JM', 'HN', 'SV', 'NI'],
    Asia: ['IN', 'PK', 'BD', 'LK', 'NP', 'SG', 'MY', 'ID', 'TH', 'VN', 'PH', 'HK', 'TW',
      'CN', 'JP', 'KR', 'AE', 'QA', 'SA', 'KW', 'IL', 'IR', 'TR', 'KZ', 'UZ', 'MM', 'KH'],
    Africa: ['ZA', 'NG', 'KE', 'EG', 'GH', 'MA', 'TN', 'DZ', 'TZ', 'UG', 'ET', 'SN', 'CI',
      'CM', 'ZW', 'ZM', 'MZ', 'AO'],
    Australia: ['AU'],
    Pacific: ['NZ', 'AU', 'US', 'GU', 'FJ'],
    Atlantic: ['IS', 'PT', 'GB', 'ES'],
    Indian: ['IN', 'MU', 'MV'],
    // A machine on plain UTC has told us nothing, so nothing is a mismatch.
    UTC: [],
    Etc: [],
  };
  const list = R[zoneRegion];
  if (!list) return true;          // an unknown region cannot disagree
  if (!list.length) return true;   // and neither can a deliberately empty one
  return list.includes(country);
}

// ------------------------------------------------------- 3. PROTOCOL REALITY

export interface ProtocolReading {
  /** protocol id → how many resource timing entries negotiated it. */
  counts: Record<string, number>;
  /** The protocol the most hosts used. '' when nothing is readable. */
  dominant: string;
  /** Share of readable entries on HTTP/3. 0..1. */
  quicShare: number;
  /** How many entries actually reported a protocol. Cross-origin entries
   *  without Timing-Allow-Origin report '' — the same blank as an error, which
   *  is exactly the kind of ambiguity the Lens has to resolve out loud. */
  readable: number;
  /** Total entries examined, readable or not. */
  total: number;
  verdict: string;
}

const PROTO_NAMES: Record<string, string> = {
  h3: 'HTTP/3 (QUIC, over UDP)',
  'h3-29': 'HTTP/3 draft-29',
  h2: 'HTTP/2 (multiplexed, over TCP)',
  'http/1.1': 'HTTP/1.1 (one request at a time, six sockets)',
  'http/1.0': 'HTTP/1.0',
  spdy: 'SPDY',
};

export const protoName = (p: string) => PROTO_NAMES[p] ?? p;

/** Read the protocol mix off the Resource Timing buffer.
 *
 *  Free: the browser has been filling these entries in since the page loaded
 *  and we have never once looked at `nextHopProtocol`. It matters because QUIC
 *  and TCP behave completely differently under loss — h3 has no head-of-line
 *  blocking, so the same 2% packet loss that ruins an h1 page is nearly
 *  invisible on h3, and the game's `fray` reading has been treating those two
 *  situations as identical.
 *
 *  `entries` is injected rather than read from `performance` directly, so this
 *  stays pure and the suite can hand it a fixture. */
export function protocolReality(entries: { nextHopProtocol?: string }[]): ProtocolReading {
  const counts: Record<string, number> = {};
  let readable = 0;
  for (const e of entries) {
    const p = e?.nextHopProtocol;
    if (!p) continue;              // cross-origin without TAO, or a cached entry
    counts[p] = (counts[p] ?? 0) + 1;
    readable++;
  }
  let dominant = '', best = 0;
  for (const [p, n] of Object.entries(counts)) if (n > best) { best = n; dominant = p; }
  const quic = (counts['h3'] ?? 0) + (counts['h3-29'] ?? 0);
  const quicShare = readable ? quic / readable : 0;

  return {
    counts, dominant, quicShare, readable, total: entries.length,
    verdict: !readable
      ? 'nothing on this page will say what it spoke'
      : quicShare > 0.6 ? 'the world speaks over QUIC — loss barely slows it'
      : quicShare > 0.1 ? 'a mixed tongue: some QUIC, some TCP'
      : dominant === 'http/1.1' ? 'one request at a time — this path is old'
      : 'multiplexed over TCP, the ordinary modern shape',
  };
}

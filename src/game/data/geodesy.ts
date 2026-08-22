// ============================================================================
// N4.7 — the two coordinate tables, and the physics that uses them.
//
// Pure data and pure functions. No imports, no browser APIs, no requests — this
// is a leaf like data/network.ts, and it stays one.
//
// ---------------------------------------------------------------------------
// Why a table at all
// ---------------------------------------------------------------------------
//
// Speed-of-light efficiency is the best number in the whole N4 plan: compare
// the RTT you actually measured against the RTT physics allows, and you learn
// whether your packets went where they were going or toured the continent.
// Almost no consumer tool surfaces it and it is a genuinely beautiful game stat.
//
// It needs two coordinates. One is free — `cdn-cgi/trace` names the Cloudflare
// colo by IATA code, and IATA codes are airports, which are a fixed and public
// list. The other is the problem: we do not know where the PLAYER is, and we
// are never going to ask. Geolocation was dropped deliberately (it fires a
// permission prompt) and that decision is not being reopened for a stat.
//
// So there are two answers here, and the Lens shows both because they are
// honest about different things:
//
//   1. THE HORIZON — a hard physical bound that needs no client coordinate at
//      all. Light in fibre travels at ~2/3 c. Given a measured min_rtt, the
//      edge CANNOT be further away than (rtt/2) x 200 km/ms. That is not an
//      estimate, it is a limit, and it is tagged `measured`.
//
//   2. THE REACH — the actual great-circle distance, using a coordinate
//      estimated from the IANA timezone. Timezones are longitude-shaped, so
//      longitude comes out good to roughly a zone width; latitude is a guess
//      from the zone's own named city and is the weak axis. Tagged `derived`,
//      with the error stated in the panel rather than buried here.
//
// The efficiency ratio is REACH against the theoretical floor. A ratio near 1
// means near-optimal routing. Three means the packets are touring.
// ============================================================================

export interface Coord { lat: number; lon: number }

/** Cloudflare colos, by IATA code.
 *
 *  Not all ~330 of them — the largest ~110, which is where the overwhelming
 *  majority of sessions terminate. An unknown code returns null and the Lens
 *  says "not in the table" rather than inventing a position, because a made-up
 *  coordinate would produce a confident, wrong efficiency ratio and that is
 *  worse than no ratio at all. */
export const COLOS: Record<string, Coord> = {
  // North America
  ATL: { lat: 33.64, lon: -84.43 }, BOS: { lat: 42.36, lon: -71.01 }, ORD: { lat: 41.98, lon: -87.90 },
  DFW: { lat: 32.90, lon: -97.04 }, DEN: { lat: 39.86, lon: -104.67 }, IAH: { lat: 29.98, lon: -95.34 },
  LAX: { lat: 33.94, lon: -118.41 }, MIA: { lat: 25.79, lon: -80.29 }, MSP: { lat: 44.88, lon: -93.22 },
  EWR: { lat: 40.69, lon: -74.17 }, PHL: { lat: 39.87, lon: -75.24 }, PHX: { lat: 33.43, lon: -112.01 },
  PDX: { lat: 45.59, lon: -122.60 }, SJC: { lat: 37.36, lon: -121.93 }, SEA: { lat: 47.45, lon: -122.31 },
  IAD: { lat: 38.95, lon: -77.46 }, YYZ: { lat: 43.68, lon: -79.63 }, YVR: { lat: 49.19, lon: -123.18 },
  YUL: { lat: 45.47, lon: -73.74 }, YWG: { lat: 49.91, lon: -97.24 }, MEX: { lat: 19.44, lon: -99.07 },
  QRO: { lat: 20.62, lon: -100.19 }, SLC: { lat: 40.79, lon: -111.98 }, LAS: { lat: 36.08, lon: -115.15 },
  DTW: { lat: 42.21, lon: -83.35 }, CMH: { lat: 39.998, lon: -82.89 }, MCI: { lat: 39.30, lon: -94.71 },
  BNA: { lat: 36.13, lon: -86.68 }, CLT: { lat: 35.21, lon: -80.94 }, TPA: { lat: 27.98, lon: -82.53 },
  SAN: { lat: 32.73, lon: -117.19 }, HNL: { lat: 21.32, lon: -157.92 }, ANC: { lat: 61.17, lon: -150.00 },

  // South & Central America
  GRU: { lat: -23.43, lon: -46.47 }, GIG: { lat: -22.81, lon: -43.25 }, EZE: { lat: -34.82, lon: -58.54 },
  SCL: { lat: -33.39, lon: -70.79 }, BOG: { lat: 4.70, lon: -74.15 }, LIM: { lat: -12.02, lon: -77.11 },
  UIO: { lat: -0.13, lon: -78.36 }, PTY: { lat: 9.07, lon: -79.38 }, SJO: { lat: 9.99, lon: -84.20 },
  MDE: { lat: 6.16, lon: -75.42 }, CWB: { lat: -25.53, lon: -49.18 }, POA: { lat: -29.99, lon: -51.17 },
  FOR: { lat: -3.78, lon: -38.53 }, BSB: { lat: -15.87, lon: -47.92 },

  // Europe
  AMS: { lat: 52.31, lon: 4.76 }, ARN: { lat: 59.65, lon: 17.92 }, ATH: { lat: 37.94, lon: 23.95 },
  BCN: { lat: 41.30, lon: 2.08 }, BRU: { lat: 50.90, lon: 4.48 }, BUD: { lat: 47.44, lon: 19.26 },
  CDG: { lat: 49.01, lon: 2.55 }, CPH: { lat: 55.62, lon: 12.66 }, DUB: { lat: 53.43, lon: -6.25 },
  DUS: { lat: 51.29, lon: 6.77 }, FRA: { lat: 50.04, lon: 8.56 }, HAM: { lat: 53.63, lon: 9.99 },
  HEL: { lat: 60.32, lon: 24.96 }, IST: { lat: 41.28, lon: 28.75 }, KBP: { lat: 50.34, lon: 30.89 },
  LHR: { lat: 51.47, lon: -0.45 }, LIS: { lat: 38.77, lon: -9.13 }, LUX: { lat: 49.63, lon: 6.21 },
  MAD: { lat: 40.47, lon: -3.56 }, MAN: { lat: 53.35, lon: -2.27 }, MRS: { lat: 43.44, lon: 5.22 },
  MUC: { lat: 48.35, lon: 11.79 }, MXP: { lat: 45.63, lon: 8.72 }, OSL: { lat: 60.19, lon: 11.10 },
  OTP: { lat: 44.57, lon: 26.10 }, PRG: { lat: 50.10, lon: 14.26 }, RIX: { lat: 56.92, lon: 23.97 },
  SOF: { lat: 42.70, lon: 23.41 }, TLL: { lat: 59.41, lon: 24.83 }, VIE: { lat: 48.11, lon: 16.57 },
  WAW: { lat: 52.17, lon: 20.97 }, ZRH: { lat: 47.46, lon: 8.55 }, ZAG: { lat: 45.74, lon: 16.07 },
  BEG: { lat: 44.82, lon: 20.31 }, SKG: { lat: 40.52, lon: 22.97 }, KEF: { lat: 63.98, lon: -22.61 },
  EDI: { lat: 55.95, lon: -3.37 }, GVA: { lat: 46.24, lon: 6.11 }, FCO: { lat: 41.80, lon: 12.25 },

  // Middle East & Africa
  DXB: { lat: 25.25, lon: 55.36 }, DOH: { lat: 25.27, lon: 51.61 }, TLV: { lat: 32.01, lon: 34.89 },
  RUH: { lat: 24.96, lon: 46.70 }, JED: { lat: 21.68, lon: 39.16 }, KWI: { lat: 29.23, lon: 47.97 },
  CAI: { lat: 30.11, lon: 31.41 }, JNB: { lat: -26.13, lon: 28.24 }, CPT: { lat: -33.97, lon: 18.60 },
  DUR: { lat: -29.61, lon: 31.12 }, LOS: { lat: 6.58, lon: 3.32 }, NBO: { lat: -1.32, lon: 36.93 },
  ACC: { lat: 5.60, lon: -0.17 }, CMN: { lat: 33.37, lon: -7.59 }, TUN: { lat: 36.85, lon: 10.23 },
  MBA: { lat: -4.03, lon: 39.59 }, DAR: { lat: -6.87, lon: 39.20 },

  // Asia-Pacific
  BOM: { lat: 19.09, lon: 72.87 }, DEL: { lat: 28.56, lon: 77.10 }, MAA: { lat: 12.99, lon: 80.17 },
  BLR: { lat: 13.20, lon: 77.71 }, HYD: { lat: 17.24, lon: 78.43 }, CCU: { lat: 22.65, lon: 88.45 },
  SIN: { lat: 1.36, lon: 103.99 }, HKG: { lat: 22.31, lon: 113.91 }, NRT: { lat: 35.77, lon: 140.39 },
  KIX: { lat: 34.43, lon: 135.23 }, ICN: { lat: 37.46, lon: 126.44 }, TPE: { lat: 25.08, lon: 121.23 },
  BKK: { lat: 13.69, lon: 100.75 }, KUL: { lat: 2.75, lon: 101.71 }, CGK: { lat: -6.13, lon: 106.66 },
  MNL: { lat: 14.51, lon: 121.02 }, SGN: { lat: 10.82, lon: 106.66 }, HAN: { lat: 21.22, lon: 105.81 },
  SYD: { lat: -33.94, lon: 151.18 }, MEL: { lat: -37.67, lon: 144.84 }, BNE: { lat: -27.38, lon: 153.12 },
  PER: { lat: -31.94, lon: 115.97 }, ADL: { lat: -34.95, lon: 138.53 }, AKL: { lat: -37.01, lon: 174.79 },
  CHC: { lat: -43.49, lon: 172.53 }, GUM: { lat: 13.48, lon: 144.80 }, KHH: { lat: 22.58, lon: 120.35 },
  CMB: { lat: 7.18, lon: 79.88 }, KTM: { lat: 27.70, lon: 85.36 }, DAC: { lat: 23.84, lon: 90.40 },
  KHI: { lat: 24.91, lon: 67.16 }, LHE: { lat: 31.52, lon: 74.40 }, ISB: { lat: 33.61, lon: 73.10 },
};

/** IANA timezone → an approximate coordinate for its named city.
 *
 *  The client-side half, and the weak half. A timezone is longitude-shaped, so
 *  longitude is good to roughly a zone width (±7.5° ≈ ±600 km at the equator,
 *  less further north). Latitude is whatever the zone's named city happens to
 *  be, and for a country-wide zone like `Asia/Kolkata` or `Australia/Perth`
 *  that can be a long way out.
 *
 *  This is why the Lens tags THE REACH `derived` and prints its error, and why
 *  THE HORIZON — which needs none of this — is shown beside it. */
export const ZONE_COORDS: Record<string, Coord> = {
  'America/New_York': { lat: 40.71, lon: -74.01 }, 'America/Chicago': { lat: 41.88, lon: -87.63 },
  'America/Denver': { lat: 39.74, lon: -104.98 }, 'America/Phoenix': { lat: 33.45, lon: -112.07 },
  'America/Los_Angeles': { lat: 34.05, lon: -118.24 }, 'America/Anchorage': { lat: 61.22, lon: -149.90 },
  'Pacific/Honolulu': { lat: 21.31, lon: -157.86 }, 'America/Toronto': { lat: 43.65, lon: -79.38 },
  'America/Vancouver': { lat: 49.28, lon: -123.12 }, 'America/Edmonton': { lat: 53.55, lon: -113.49 },
  'America/Winnipeg': { lat: 49.90, lon: -97.14 }, 'America/Halifax': { lat: 44.65, lon: -63.58 },
  'America/Mexico_City': { lat: 19.43, lon: -99.13 }, 'America/Bogota': { lat: 4.71, lon: -74.07 },
  'America/Lima': { lat: -12.05, lon: -77.04 }, 'America/Santiago': { lat: -33.45, lon: -70.67 },
  'America/Sao_Paulo': { lat: -23.55, lon: -46.63 }, 'America/Argentina/Buenos_Aires': { lat: -34.60, lon: -58.38 },
  'America/Caracas': { lat: 10.48, lon: -66.90 }, 'America/Panama': { lat: 8.98, lon: -79.52 },
  'America/Guatemala': { lat: 14.63, lon: -90.51 }, 'America/Havana': { lat: 23.11, lon: -82.37 },
  'Europe/London': { lat: 51.51, lon: -0.13 }, 'Europe/Dublin': { lat: 53.35, lon: -6.26 },
  'Europe/Lisbon': { lat: 38.72, lon: -9.14 }, 'Europe/Madrid': { lat: 40.42, lon: -3.70 },
  'Europe/Paris': { lat: 48.86, lon: 2.35 }, 'Europe/Brussels': { lat: 50.85, lon: 4.35 },
  'Europe/Amsterdam': { lat: 52.37, lon: 4.90 }, 'Europe/Berlin': { lat: 52.52, lon: 13.40 },
  'Europe/Zurich': { lat: 47.38, lon: 8.54 }, 'Europe/Vienna': { lat: 48.21, lon: 16.37 },
  'Europe/Rome': { lat: 41.90, lon: 12.50 }, 'Europe/Prague': { lat: 50.08, lon: 14.44 },
  'Europe/Warsaw': { lat: 52.23, lon: 21.01 }, 'Europe/Budapest': { lat: 47.50, lon: 19.04 },
  'Europe/Bucharest': { lat: 44.43, lon: 26.11 }, 'Europe/Sofia': { lat: 42.70, lon: 23.32 },
  'Europe/Athens': { lat: 37.98, lon: 23.73 }, 'Europe/Helsinki': { lat: 60.17, lon: 24.94 },
  'Europe/Stockholm': { lat: 59.33, lon: 18.07 }, 'Europe/Oslo': { lat: 59.91, lon: 10.75 },
  'Europe/Copenhagen': { lat: 55.68, lon: 12.57 }, 'Europe/Moscow': { lat: 55.76, lon: 37.62 },
  'Europe/Kyiv': { lat: 50.45, lon: 30.52 }, 'Europe/Kiev': { lat: 50.45, lon: 30.52 },
  'Europe/Istanbul': { lat: 41.01, lon: 28.98 }, 'Europe/Belgrade': { lat: 44.79, lon: 20.45 },
  'Europe/Zagreb': { lat: 45.81, lon: 15.98 }, 'Europe/Riga': { lat: 56.95, lon: 24.11 },
  'Europe/Tallinn': { lat: 59.44, lon: 24.75 }, 'Europe/Vilnius': { lat: 54.69, lon: 25.28 },
  'Atlantic/Reykjavik': { lat: 64.15, lon: -21.94 },
  'Africa/Cairo': { lat: 30.04, lon: 31.24 }, 'Africa/Lagos': { lat: 6.52, lon: 3.38 },
  'Africa/Nairobi': { lat: -1.29, lon: 36.82 }, 'Africa/Johannesburg': { lat: -26.20, lon: 28.05 },
  'Africa/Casablanca': { lat: 33.57, lon: -7.59 }, 'Africa/Accra': { lat: 5.60, lon: -0.19 },
  'Africa/Tunis': { lat: 36.81, lon: 10.17 }, 'Africa/Algiers': { lat: 36.75, lon: 3.06 },
  'Asia/Dubai': { lat: 25.20, lon: 55.27 }, 'Asia/Qatar': { lat: 25.29, lon: 51.53 },
  'Asia/Riyadh': { lat: 24.71, lon: 46.68 }, 'Asia/Jerusalem': { lat: 31.77, lon: 35.21 },
  'Asia/Tehran': { lat: 35.69, lon: 51.39 }, 'Asia/Karachi': { lat: 24.86, lon: 67.01 },
  'Asia/Kolkata': { lat: 22.57, lon: 88.36 }, 'Asia/Calcutta': { lat: 22.57, lon: 88.36 },
  'Asia/Dhaka': { lat: 23.81, lon: 90.41 }, 'Asia/Kathmandu': { lat: 27.72, lon: 85.32 },
  'Asia/Colombo': { lat: 6.93, lon: 79.86 }, 'Asia/Bangkok': { lat: 13.76, lon: 100.50 },
  'Asia/Ho_Chi_Minh': { lat: 10.82, lon: 106.63 }, 'Asia/Jakarta': { lat: -6.21, lon: 106.85 },
  'Asia/Kuala_Lumpur': { lat: 3.14, lon: 101.69 }, 'Asia/Singapore': { lat: 1.35, lon: 103.82 },
  'Asia/Manila': { lat: 14.60, lon: 120.98 }, 'Asia/Hong_Kong': { lat: 22.32, lon: 114.17 },
  'Asia/Taipei': { lat: 25.03, lon: 121.57 }, 'Asia/Shanghai': { lat: 31.23, lon: 121.47 },
  'Asia/Seoul': { lat: 37.57, lon: 126.98 }, 'Asia/Tokyo': { lat: 35.68, lon: 139.69 },
  'Australia/Sydney': { lat: -33.87, lon: 151.21 }, 'Australia/Melbourne': { lat: -37.81, lon: 144.96 },
  'Australia/Brisbane': { lat: -27.47, lon: 153.03 }, 'Australia/Perth': { lat: -31.95, lon: 115.86 },
  'Australia/Adelaide': { lat: -34.93, lon: 138.60 }, 'Pacific/Auckland': { lat: -36.85, lon: 174.76 },
  'UTC': { lat: 51.48, lon: 0 },
};

/** Country a colo sits in, for the VPN cross-check. Derived from the IATA code
 *  rather than stored per-row: the point of the cross-check is comparing what
 *  the network SAYS your country is against where your packets actually land,
 *  and only a handful of codes need to be resolvable for that to work. */
export const COLO_COUNTRY: Record<string, string> = {
  ATL: 'US', BOS: 'US', ORD: 'US', DFW: 'US', DEN: 'US', IAH: 'US', LAX: 'US', MIA: 'US',
  MSP: 'US', EWR: 'US', PHL: 'US', PHX: 'US', PDX: 'US', SJC: 'US', SEA: 'US', IAD: 'US',
  SLC: 'US', LAS: 'US', DTW: 'US', CMH: 'US', MCI: 'US', BNA: 'US', CLT: 'US', TPA: 'US',
  SAN: 'US', HNL: 'US', ANC: 'US',
  YYZ: 'CA', YVR: 'CA', YUL: 'CA', YWG: 'CA',
  MEX: 'MX', QRO: 'MX', GRU: 'BR', GIG: 'BR', CWB: 'BR', POA: 'BR', FOR: 'BR', BSB: 'BR',
  EZE: 'AR', SCL: 'CL', BOG: 'CO', MDE: 'CO', LIM: 'PE', UIO: 'EC', PTY: 'PA', SJO: 'CR',
  AMS: 'NL', ARN: 'SE', ATH: 'GR', SKG: 'GR', BCN: 'ES', MAD: 'ES', BRU: 'BE', BUD: 'HU',
  CDG: 'FR', MRS: 'FR', CPH: 'DK', DUB: 'IE', DUS: 'DE', FRA: 'DE', HAM: 'DE', MUC: 'DE',
  HEL: 'FI', IST: 'TR', KBP: 'UA', LHR: 'GB', MAN: 'GB', EDI: 'GB', LIS: 'PT', LUX: 'LU',
  MXP: 'IT', FCO: 'IT', OSL: 'NO', OTP: 'RO', PRG: 'CZ', RIX: 'LV', SOF: 'BG', TLL: 'EE',
  VIE: 'AT', WAW: 'PL', ZRH: 'CH', GVA: 'CH', ZAG: 'HR', BEG: 'RS', KEF: 'IS',
  DXB: 'AE', DOH: 'QA', TLV: 'IL', RUH: 'SA', JED: 'SA', KWI: 'KW', CAI: 'EG',
  JNB: 'ZA', CPT: 'ZA', DUR: 'ZA', LOS: 'NG', NBO: 'KE', MBA: 'KE', ACC: 'GH',
  CMN: 'MA', TUN: 'TN', DAR: 'TZ',
  BOM: 'IN', DEL: 'IN', MAA: 'IN', BLR: 'IN', HYD: 'IN', CCU: 'IN',
  SIN: 'SG', HKG: 'HK', NRT: 'JP', KIX: 'JP', ICN: 'KR', TPE: 'TW', KHH: 'TW',
  BKK: 'TH', KUL: 'MY', CGK: 'ID', MNL: 'PH', SGN: 'VN', HAN: 'VN',
  SYD: 'AU', MEL: 'AU', BNE: 'AU', PER: 'AU', ADL: 'AU', AKL: 'NZ', CHC: 'NZ', GUM: 'GU',
  CMB: 'LK', KTM: 'NP', DAC: 'BD', KHI: 'PK', LHE: 'PK', ISB: 'PK',
};

/** Great-circle distance in km. Haversine — the standard formula, and accurate
 *  to well under a kilometre at these distances, which is four orders of
 *  magnitude better than the coordinate estimate feeding it. */
export function greatCircleKm(a: Coord, b: Coord): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Kilometres light covers in one millisecond inside single-mode fibre, one
 *  way. c is 299.79 km/ms in vacuum; the refractive index of fibre is ~1.468,
 *  so the group velocity is ~204 km/ms. This is the number the whole metric
 *  rests on and it is a physical constant of the glass, not a fudge factor. */
export const KM_PER_MS_FIBRE = 204.19;

/** The theoretical minimum round-trip, in ms, for a straight fibre run of
 *  `km`. Doubled because RTT is there and back. */
export function fibreFloorMs(km: number): number {
  return (km * 2) / KM_PER_MS_FIBRE;
}

/** THE HORIZON: the furthest the other end can POSSIBLY be, given a measured
 *  round trip. Needs no coordinate, no table and no estimate — it is the speed
 *  of light and nothing else, which is why the Lens can tag it `measured`
 *  while everything below it is `derived`. */
export function horizonKm(rttMs: number): number {
  return (rttMs / 2) * KM_PER_MS_FIBRE;
}

/** Best-effort client coordinate from an IANA timezone. Null when the zone is
 *  not in the table, which the caller must treat as "no reach reading" rather
 *  than substituting a default — a default coordinate would produce a
 *  confident, wrong efficiency ratio. */
export function coordForZone(tz: string): Coord | null {
  return ZONE_COORDS[tz] ?? null;
}

/** How far off the reach estimate could be, in km, stated rather than hidden.
 *
 *  A timezone is at most ~7.5° of longitude from its centre, and a degree of
 *  longitude is 111 km x cos(latitude). Latitude error is the bigger unknown
 *  and is taken as a flat 400 km, which is roughly the north-south extent of a
 *  typical single-zone country. Added in quadrature because the two errors are
 *  independent. */
export function reachErrorKm(c: Coord): number {
  const lonKm = 7.5 * 111 * Math.cos((c.lat * Math.PI) / 180);
  return Math.round(Math.hypot(lonKm, 400));
}

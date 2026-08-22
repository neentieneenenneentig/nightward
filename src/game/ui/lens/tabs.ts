// N4.2 — the five Lens tabs.
//
// One long scroll became PULSE / PATHS / IDENTITY / VESSEL / THREADS because
// the panel now has roughly three times the content it had, and because the
// player looking at "why is the horde faster tonight" and the player looking at
// "what does this network think I am" are asking different questions.
//
// Every row carries an honesty tag. Where a reading is unavailable, the row
// still renders and says WHY — a missing row teaches nothing, and "unavailable"
// with no reason is indistinguishable from a bug.
import { NET_GAME_MAP } from '../../data/network';
import { NET_LOG_LABELS, styleNetworkMsg } from '../ui';
import { escapeHtml, fmt, note, row, section, sparkline, type LensCtx, type LensTab } from './core';

const UNREVEALED = '<span style="color:#5a5a6e;">— explore to reveal</span>';

// ---------------------------------------------------------------- PULSE ----
const pulse: LensTab = {
  id: 'pulse',
  title: 'PULSE',
  render({ net }) {
    const s = net.snap;
    const d = net.deep;
    const live = !!s.deepLive;
    let out = '';

    // The measured half first, because it is the point of N4.1 — and when it is
    // silent, that silence is itself the reading.
    out += section('DEEP WIRE' + (live ? '' : ' <span style="color:#8a7a8a;font-size:8px;">silent</span>'),
      live
        ? row('Pulse (min RTT)', fmt(s.pulseMs, 2, 'ms'), { inspect: 'pulseMs', quality: 'measured', color: '#f96' })
        + row('Flux (RTT var)', fmt(s.fluxMs, 2, 'ms'), { inspect: 'fluxMs', quality: 'measured', color: '#fc6' })
        + row('Flow (delivery)', fmt(s.flowMbps, 2, 'Mbps'), { inspect: 'flowMbps', quality: 'measured', color: '#6cf' })
        + row('Fray (loss+retrans)', fmt(s.fray * 100, 1, '%'), { inspect: 'fray', quality: 'measured', color: s.fray > 0.02 ? '#f77' : '#7fd6a0' })
        + row('Silt (bufferbloat)', fmt(s.silt * 100, 1, '%'), { inspect: 'silt', quality: 'measured', color: s.silt > 0.3 ? '#f96' : '#7fd6a0' })
        + row('Aperture (cwnd)', fmt(s.aperture, 0, 'seg'), { inspect: 'aperture', quality: 'measured' })
        + (d?.l4 ? note(`kernel TCP_INFO from a Cloudflare edge · proto ${escapeHtml(d.l4.proto || '?')} · `
            + `sent ${d.l4.sent} recv ${d.l4.recv} lost ${d.l4.lost} retrans ${d.l4.retrans}`) : '')
        : row('kernel socket state', 'unavailable', { quality: 'unavailable', why: statusWhy(d?.status) })
          + note('The deep wire reads the edge kernel’s own TCP statistics — real min RTT, real jitter, '
            + 'real packet loss. Where it cannot reach, everything below is the browser’s estimate and '
            + 'the game runs on neutral modifiers rather than on guesses dressed as measurements.'));

    // The estimated half, kept visible even when the measured half is live —
    // side by side is how you can SEE the 25 ms bucket.
    out += section('BROWSER ESTIMATE',
      row('RTT', fmt(s.rtt, 0, 'ms'), { inspect: 'connection-rtt', quality: 'reported', color: '#f96' })
      + row('Downlink', fmt(s.downlink, 1, 'Mbps'), { inspect: 'connection-dl', quality: 'reported', color: '#6cf' })
      + row('Jitter', fmt(s.jitter, 1, 'ms'), { inspect: 'connection-jitter', quality: 'derived', color: '#fc6' })
      + row('Echo jitter', fmt(s.echoJitter, 1, 'ms'), { inspect: 'echoJitter', quality: 'derived' })
      + row('effectiveType', escapeHtml(s.effectiveType || '—'), { quality: 'reported' })
      + row('type', s.connectionType ? escapeHtml(s.connectionType) : '<span style="color:#5a5a6e;">hidden on desktop</span>', { quality: 'reported' })
      + row('online', s.online ? 'yes' : 'no', { quality: 'reported', color: s.online ? '#7fd6a0' : '#f77' })
      + note('navigator.connection.rtt is quantised to 25 ms buckets and downlink is capped at 10 Mbps, '
        + 'both deliberately, to resist fingerprinting. Neither exists in Firefox or Safari.'));

    const biome = net.getBiome();
    const stability = net.getStability();
    const profile = net.computeRealmProfile?.() ?? { median: s.rtt, variance: s.jitter * s.jitter };
    out += section('REALM',
      row('Realm', `<b style="color:${biome.hex}">${escapeHtml(biome.name)}</b>`, { inspect: 'realm-profile', quality: 'derived' })
      + row('Echo median', fmt(profile.median, 0, 'ms'), { quality: 'measured' })
      + row('Variance', fmt(profile.variance, 0), { quality: 'derived' })
      + `<div style="margin:3px 0 2px;height:3px;background:#1a1a26;border-radius:2px;overflow:hidden;">`
      + `<div style="height:100%;width:${Math.round(stability * 100)}%;background:${biome.hex};transition:width .5s;"></div></div>`
      + row('Stability', fmt(stability * 100, 0, '%'), { inspect: 'realm-stability', quality: 'derived' }));

    return out;
  },
};

function statusWhy(status?: string): string {
  if (status === 'blocked') return 'the probe was blocked or the endpoint is unreachable from this network';
  if (status === 'off') return 'outbound probing is disabled (?nonet)';
  return 'no reading yet — the probe runs every 45s';
}

// ---------------------------------------------------------------- PATHS ----
const paths: LensTab = {
  id: 'paths',
  title: 'PATHS',
  render({ net }) {
    const s = net.snap;
    let out = '';

    const base = net.baseline;
    out += section('THIS ORIGIN',
      row('Page load', `DNS ${fmt(s.pageDnsTime, 0)} · TLS ${fmt(s.pageTlsTime, 0)} · TTFB ${fmt(s.pageTtfb, 0)}`,
        { inspect: 'routes-origin', quality: 'measured' })
      + (base
        ? row('Baseline probe', `${fmt(base.ms, 0, 'ms')} · dns ${fmt(base.dns, 0)} · tcp ${fmt(base.tcp, 0)} · tls ${fmt(base.tls, 0)}`
            + (base.proto ? ` · ${escapeHtml(base.proto)}` : ''),
            { inspect: 'routes-baseline', quality: 'measured', color: '#8c8' })
        : row('Baseline probe', 'not yet run', { quality: 'unavailable', why: 'runs every 20s against our own origin' })));

    // The two-tier split is the whole lesson of N4.1 §2.4 and the panel has to
    // show it: without Timing-Allow-Origin the browser ZEROES every timing
    // field, so a shallow beacon can never be broken down no matter how it is
    // timed. Presenting both tiers identically would be a lie of omission.
    const deepTimings: any[] = net.deep ? [...net.deep.timings.values()] : [];
    out += section('DEEP ROUTES <span style="color:#7fd6a0;font-size:8px;">TAO</span>',
      deepTimings.length
        ? deepTimings.map((t: any) => row(escapeHtml(t.host),
            `dns ${fmt(t.dns, 0)} · tcp ${fmt(t.tcp, 0)} · tls ${fmt(t.tls, 0)} · ttfb ${fmt(t.ttfb, 0)}`
            + (t.proto ? ` · ${escapeHtml(t.proto)}` : ''),
            { quality: 'measured' })).join('')
        : row('none seen', '—', { quality: 'unavailable', why: 'no Timing-Allow-Origin host has been loaded yet' }));

    const wire = net.wireStats?.();
    if (wire) {
      out += section('GATE',
        row('Requests', `${wire.granted} sent · ${wire.denied} throttled${wire.off ? ' · PROBING OFF' : ''}`,
          { inspect: 'routes-gate', quality: 'measured' })
        + wire.resolvers.map((r: any) => row(`resolver ${escapeHtml(r.label)}`,
            `n=${r.n} · avg ${fmt(r.avg, 0, 'ms')} · best ${fmt(r.best, 0, 'ms')}`,
            { inspect: 'routes-resolver', quality: 'measured' })).join(''));
    }

    // N4.4: Scrying — the ROADMAP promise since N1. DNS resolution is the
    // radar's eye: the median DoH time is the number, the radar radius is the
    // effect, and IPv6 detection rides the same answers.
    const sight = net.getGameValue('scrying');
    out += section('SCRYING',
      row('DNS median', fmt(s.dnsMedianMs, 0, 'ms'), { inspect: 'scrying', quality: 'measured', color: '#f96' })
      + row('Radar sight', fmt(sight, 2, '×'), { inspect: 'scrying', quality: 'derived', color: sight >= 1 ? '#7fd6a0' : '#f96' })
      + (s.ipv6Live
        ? row('IPv6', 'seen', { inspect: 'identity-ipv6', quality: 'measured' })
        : row('IPv6', 'not yet seen', { inspect: 'identity-ipv6', quality: 'unavailable', why: 'no host with an AAAA record has been resolved yet' })));

    const probes = s.endpointProbes ?? [];
    const seen = new Set<string>();
    let shallow = '';
    for (const p of probes) {
      if (seen.has(p.label)) continue;
      seen.add(p.label);
      const samples: number[] | undefined = net.echoSamples?.get(p.host ?? p.label);
      const best = samples?.length ? Math.min(...samples).toFixed(0) : '—';
      const warm = net.warmedRoutes?.has(p.host ?? p.label) ? '🔥 ' : '';
      const ip = (p as any).ip ? escapeHtml((p as any).ip) : (p.detail ? escapeHtml(p.detail) : '—');
      const ttl = (p as any).ttl ? ` · ttl ${(p as any).ttl}` : '';
      const dnssec = (p as any).ad ? ' · 🔒' : '';
      shallow += row(`${warm}${escapeHtml(p.label)}`,
        `<span style="color:#9bd;">${ip}</span> · ${p.rtt > 0 ? fmt(p.rtt, 0, 'ms') : '—'} · best ${best} · n=${samples?.length ?? 0}${ttl}${dnssec}`,
        { inspect: p.label, quality: 'measured' });
    }
    out += section('RESOLVED ROUTES',
      (shallow || row('none yet', '—', { quality: 'unavailable', why: 'the scheduler resolves one every few seconds' }))
      + note('Route latency is timed end to end. These hosts do NOT send Timing-Allow-Origin, so the '
        + 'browser zeroes their DNS/TCP/TLS breakdown — the duration is real, the breakdown is not available at all.'));

    return out;
  },
};

// ------------------------------------------------------------- IDENTITY ----
const identity: LensTab = {
  id: 'identity',
  title: 'IDENTITY',
  render({ net }) {
    const s = net.snap;
    const revealed = net.identityFetched;
    const val = (v: string, empty: string) => (revealed && v && v !== '...' && v !== '..' ? escapeHtml(v) : UNREVEALED.replace('explore to reveal', empty));

    let out = section('WHO THE NETWORK THINKS WE ARE',
      row('Public IP', val(s.publicIp, 'explore to reveal'), { inspect: 'identity-ip', quality: 'measured' })
      + row('PTR / ISP', val(s.isp, 'explore to reveal'), { inspect: 'identity-isp', quality: 'measured' })
      + row('Country', val(s.country, 'explore to reveal'), { quality: 'reported' })
      + row('CF colo', s.colo && s.colo !== '...' ? escapeHtml(s.colo) : '—', { inspect: 'identity-colo', quality: 'reported' })
      + row('City', s.city && s.city !== '...' ? escapeHtml(s.city) : 'unavailable',
          s.city && s.city !== '...' ? { quality: 'reported' }
            : { quality: 'unavailable', why: 'needs a geo-IP vendor; none is contacted (ipapi.co was retired in N4.0 — a 1000/day trial that had already 429’d us)' })
      + row('ASN', s.asn && s.asn !== '...' ? escapeHtml(s.asn) : 'unavailable',
          s.asn && s.asn !== '...' ? { quality: 'reported' } : { quality: 'unavailable', why: 'same — no geo-IP vendor is contacted' })
      + row('WARP', s.warp ? 'yes' : 'no', { quality: 'reported' }));

    out += section('TRANSPORT',
      row('TLS', net.tlsVersion ? escapeHtml(net.tlsVersion) : '—', { inspect: 'identity-tls', quality: 'reported' })
      + row('Key exchange', net.kex ? escapeHtml(net.kex) : '—', { quality: 'reported' })
      + row('HTTP', net.httpProto ? escapeHtml(net.httpProto) : '—', { quality: 'reported' })
      + row('Clock drift', `${net.clockSkewMs > 0 ? '+' : ''}${(net.clockSkewMs / 1000).toFixed(2)}s`,
          { inspect: 'identity-skew', quality: 'derived' }));

    out += section('WHAT WE CANNOT SEE',
      row('LAN / gateway', 'unavailable', { quality: 'unavailable', why: 'a browser cannot enumerate the local network' })
      + row('ICMP / traceroute', 'unavailable', { quality: 'unavailable', why: 'raw sockets are not available to page JavaScript' })
      + row('WiFi signal (dBm)', 'unavailable', { quality: 'unavailable', why: 'no browser API exposes radio strength' })
      + note('This section exists so the panel is honest about its edges. Packet loss used to be on this '
        + 'list and no longer is — see PULSE.'));

    return out;
  },
};

// --------------------------------------------------------------- VESSEL ----
const vessel: LensTab = {
  id: 'vessel',
  title: 'VESSEL',
  render({ net }) {
    const s = net.snap;
    const ua = navigator.userAgent;
    const brand = /Edg|Chrome|Firefox|Safari/.exec(ua)?.[0] ?? '—';
    let gpu = '—';
    try {
      const c = document.createElement('canvas');
      const gl: any = c.getContext('webgl2') || c.getContext('webgl');
      if (gl) {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      }
    } catch { /* a hardened browser may refuse; that is a reading too */ }

    let out = section('MACHINE',
      row('Browser', escapeHtml(brand), { inspect: 'vessel-ua', quality: 'reported' })
      + row('CPU cores', fmt(s.cpuCores, 0), { quality: 'reported' })
      + row('Device memory', fmt(s.deviceMemory, 0, 'GB'), { quality: 'reported' })
      + row('GPU', escapeHtml(String(gpu).slice(0, 64)), { inspect: 'vessel-gpu', quality: 'reported' })
      + row('Screen', `${screen.width}×${screen.height} @${devicePixelRatio}x`, { inspect: 'vessel-screen', quality: 'reported' })
      + row('Locale', escapeHtml(s.locale || navigator.language), { quality: 'reported' })
      + row('Timezone', escapeHtml(s.timezone), { quality: 'reported' }));

    out += section('STATE',
      row('Battery', s.batteryLevel >= 0 ? `${(s.batteryLevel * 100).toFixed(0)}%${s.batteryCharging ? ' ⚡' : ''}` : 'unavailable',
          s.batteryLevel >= 0 ? { quality: 'reported' }
            : { quality: 'unavailable', why: 'the Battery Status API is Chromium-only and may be disabled' })
      + row('JS heap', s.jsHeapUsedMB > 0 ? `${fmt(s.jsHeapUsedMB, 0)} / ${fmt(s.jsHeapTotalMB, 0)} MB` : 'unavailable',
          s.jsHeapUsedMB > 0 ? { quality: 'reported' }
            : { quality: 'unavailable', why: 'performance.memory is Chromium-only' }));

    out += note('Geolocation is deliberately never requested. It fires a browser permission prompt, and '
      + 'the identity probes already show IP-level geography without asking the player for anything.');
    return out;
  },
};

// -------------------------------------------------------------- THREADS ----
const threads: LensTab = {
  id: 'threads',
  title: 'THREADS',
  render({ net, log, chronicle, omens }) {
    const ctx = { snap: net.snap, distinctRegionsProbed: net.distinctRegionsProbed ?? 0 };
    // N4.3: OMENS goes FIRST. The Decoder Ring below it is a 25-row reference
    // table of this connection's steady state — useful, static, and the thing a
    // player scrolls past. An omen is transient and is changing their yields
    // right now. The gate screenshot put OMENS under the Ring and it landed
    // below the fold, which for a status this short-lived is the same as absent.
    const active = omens?.active ?? [];
    const past = (omens?.history ?? []).filter((o: any) => o.endedAt !== undefined);
    let out = section('OMENS',
      (active.length
        ? active.map((o: any) => row(
            `${escapeHtml(o.def.name)} <span style="color:#5a5a6e;">${escapeHtml(o.def.blurb)}</span>`,
            (o.def.target ? `${escapeHtml(o.def.target)} ×${o.def.mul}` : 'realm tear')
            + ` <span style="color:#5a5a6e;">${o.from.toFixed(1)} → ${o.to.toFixed(1)}</span>`,
            { quality: 'derived', color: o.def.good ? '#8fd98f' : '#f08a6a' })).join('')
        : row('the world is steady', '—', { quality: 'derived', why: 'no reading has stepped far enough to raise one' }))
      + (past.length
        ? past.slice(-4).reverse().map((o: any) => row(
            `<span style="opacity:0.5;">${escapeHtml(o.def.name)}</span>`,
            `<span style="opacity:0.5;">${o.endedBy}</span>`, { dim: true })).join('')
        : '')
      + note('An omen is a STEP, not a level. The Decoder Ring below is the steady state of this '
        + 'connection; an omen is the moment it changed. Bad ones lift when the reading recovers — '
        + 'the countdown on the HUD chip is a safety valve, not a promise.'));

    let body = '';
    for (const gm of NET_GAME_MAP) {
      const raw = net.get(gm.netKey);
      let val = gm.min;
      try { val = Math.max(gm.min, Math.min(gm.max, gm.transform(raw, ctx as any))); } catch { /* neutral */ }
      body += row(
        escapeHtml(gm.label) + ((gm as any).dormant ? ' <span style="color:#557;">dormant</span>' : ''),
        `×${val.toFixed(2)} <span style="color:#5a5a6e;">← ${escapeHtml(gm.netKey)} ${raw.toFixed(1)}</span>`,
        { inspect: gm.target, quality: 'derived', dim: !!(gm as any).dormant });
    }
    out += section('THE DECODER RING', body
      + note('Each row is a live measurement being turned into a game number. The clamp bands are in '
        + 'data/network.ts and are editable at runtime through window.NW.'));

    // Read the PERMANENT record, not the drain queue: main() calls takeEvents()
    // once a second to turn steps into Feed lines and omens.
    const events = chronicle?.recentEvents?.(8) ?? chronicle?.events ?? [];
    out += section('CHANGES',
      events.length
        ? events.slice(-8).reverse().map((e: any) => row(
            `${e.dir === 'up' ? '▲' : '▼'} ${escapeHtml(e.label)}`,
            `${e.from.toFixed(1)} → ${e.to.toFixed(1)} <span style="color:#5a5a6e;">${Math.abs(e.sigma).toFixed(1)}σ</span>`,
            { quality: 'derived', color: e.dir === 'up' ? '#f96' : '#6cf' })).join('')
        : row('nothing has stepped yet', '—', { quality: 'derived', why: 'a baseline needs ~90s of samples' })
        + note('A short window is compared against a longer baseline that excludes it, in standard '
          + 'deviations rather than percent — so a link that always wobbles does not cry wolf, and a '
          + 'steady one reports a small step.'));

    const feed = log?.recentFeed?.(24) ?? [];
    out += section('FEED', feed.length
      ? feed.map((e: any) => {
          const t = Math.floor(e.t);
          const ts = `${String((t / 60) | 0).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
          return `<div data-inspect-key="feed-entry" style="font-size:8px;color:#7c7c8e;cursor:help;padding:1px 0;">`
            + `[${ts}] <span style="color:#f96;">${escapeHtml(NET_LOG_LABELS[e.kind] ?? e.kind)}</span> ${styleNetworkMsg(e.msg)}</div>`;
        }).join('')
      : `<div style="font-size:9px;color:#5a5a6e;">No truth events yet</div>`);

    return out;
  },
};

export const LENS_TABS: LensTab[] = [pulse, paths, identity, vessel, threads];

/** The Chronicle strip: three sparklines over the WHOLE session, pinned under
 *  the tab bar. The old panel had a drawSparkline() that was never once called
 *  and three 60-sample ring buffers behind it — a one-minute window cannot show
 *  a change, because whatever it changed from has already fallen off the front. */
export function chronicleStrip(ctx: LensCtx): string {
  const rows: [string, string, string][] = [
    ['pulse', '#f96', 'latency'],
    ['flow', '#6cf', 'throughput'],
    ['fray', '#f77', 'loss'],
  ];
  let out = '';
  for (const [key, color, label] of rows) {
    const data = ctx.chronicle?.plot?.(key) ?? [];
    const last = ctx.chronicle?.last?.(key);
    const meta = ctx.chronicle?.metaOf?.(key);
    out += `<div style="display:flex;align-items:center;gap:6px;">`
      + `<span style="font-size:8px;color:#6f6f88;width:52px;">${label}</span>`
      + sparkline(data, color)
      + `<span style="font-size:8px;color:${color};width:56px;text-align:right;">`
      + (last ? `${last.v.toFixed(last.v < 10 ? 2 : 0)}${meta?.unit ? ' ' + meta.unit : ''}` : '—')
      + `</span></div>`;
  }
  return `<div style="padding:5px 0 6px;border-bottom:1px solid #1e1e2c;margin-bottom:7px;">${out}</div>`;
}

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
import { pressureFiction } from '../../systems/vessel';
import { protoName } from '../../systems/truths';
import { gateFiction, gateName } from '../../systems/udp';
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

    // N4.7 — THE STRAIGHT PATH. Speed-of-light efficiency, and the hard
    // physical horizon beside it.
    //
    // Two rows, deliberately, because they are honest about different things.
    // THE HORIZON needs no coordinate at all — it is the speed of light in
    // fibre and a measured round trip, so it is `measured` and it cannot be
    // wrong. THE REACH needs a guess at where the player is, taken from the
    // timezone, so it is `derived` and its error bar is printed rather than
    // buried. Showing only the second would be presenting an estimate with the
    // authority of a measurement.
    const sp = net.straightPath?.();
    if (sp) {
      const effCol = sp.efficiency <= 0 ? undefined
        : sp.efficiency < 1.6 ? '#7fd6a0' : sp.efficiency < 2.5 ? '#d8c07a' : '#f08a6a';
      out += section('THE STRAIGHT PATH',
        row('Edge', sp.colo ? escapeHtml(sp.colo) + (sp.coloKnown ? '' : ' (not in the table)') : '\u2014',
            sp.coloKnown ? { inspect: 'identity-colo', quality: 'reported' }
              : { quality: 'unavailable', why: 'the colo table carries the largest ~110 codes; an unlisted one gets no position rather than a made-up one' })
        + row('Horizon', sp.horizonKm ? `\u2264 ${sp.horizonKm.toLocaleString()} km` : 'unavailable',
            sp.horizonKm
              ? { inspect: 'pathEff', quality: 'measured', why: `light in fibre covers 204 km/ms; at ${sp.rttMs.toFixed(1)} ms round trip the far end cannot be further than this` }
              : { quality: 'unavailable', why: 'no round trip has been measured yet' })
        + row('Reach', sp.reachKm ? `${sp.reachKm.toLocaleString()} \u00b1 ${sp.reachErrKm.toLocaleString()} km` : 'unavailable',
            sp.reachKm ? { quality: 'derived', why: 'great-circle from a TIMEZONE-estimated position \u2014 longitude is good to about a zone width, latitude is the weak axis' }
              : { quality: 'unavailable', why: escapeHtml(sp.verdict) })
        + row('Fibre floor', sp.floorMs ? fmt(sp.floorMs, 1, 'ms') : '\u2014', { quality: 'derived' })
        + row('Efficiency', sp.efficiency > 0 ? `\u00d7${sp.efficiency.toFixed(2)}` : 'unavailable',
            sp.efficiency > 0 ? { inspect: 'homeward', quality: 'derived', color: effCol }
              : { inspect: 'homeward', quality: 'unavailable', why: escapeHtml(sp.verdict) })
        + row('Measured from', escapeHtml(sp.rttSource), { quality: 'reported' })
        + (sp.efficiency > 0 ? note(escapeHtml(sp.verdict)) : '')
        + note('Measured round trip against the round trip physics allows for that distance. 1.0 means '
          + 'your packets went straight; 3.0 means they toured. The kernel min_rtt is used where the '
          + 'deep wire reaches, because connection.rtt is quantised to 25 ms buckets and at short '
          + 'distances the bucket is bigger than the whole measurement.'));
    }

    // N4.7 — PROTOCOL REALITY. Free: the browser has been filling these entries
    // in since the page loaded and nothing has ever read nextHopProtocol.
    const pr = net.protocolReality?.();
    if (pr) {
      const protoRows = Object.entries(pr.counts)
        .sort((a, b) => (b[1] as number) - (a[1] as number))
        .map(([p, n]) => row(escapeHtml(protoName(p)), `${n} of ${pr.readable}`,
          { quality: 'reported', color: p.startsWith('h3') ? '#7fd6a0' : p === 'http/1.1' ? '#f08a6a' : undefined }))
        .join('');
      out += section('PROTOCOL REALITY',
        (protoRows || row('nothing readable', '\u2014',
          { quality: 'unavailable', why: 'cross-origin entries without Timing-Allow-Origin report a blank protocol' }))
        + row('Unreadable', `${pr.total - pr.readable} of ${pr.total} entries`, { quality: 'derived' })
        + (pr.readable ? note(escapeHtml(pr.verdict)) : '')
        + note('QUIC and TCP behave completely differently under loss \u2014 h3 has no head-of-line '
          + 'blocking, so the same 2% loss that ruins an HTTP/1.1 page is nearly invisible on HTTP/3. '
          + 'The fray reading has been treating those two situations as identical.'));
    }

    // N4.7b — THE UDP PATH. The only reading in the game that did not come back
    // over TCP, and the one section that has to state what it CANNOT see as
    // prominently as what it can.
    const u = net.udp;
    if (u) {
      const gateCol = { open: '#f08a6a', cone: '#8fb6e8', symmetric: '#7fd6a0',
        blocked: '#d8c07a', unknown: undefined as any }[u.natClass];
      out += section('THE UDP PATH',
        // `inferred` is the honesty tag doing exactly the job it exists for. A
        // cone read from two matching ports is MEASURED; a cone deduced from the
        // browser pruning a duplicate candidate is DERIVED. Both are true, they
        // are not the same grade of fact, and collapsing them would be the
        // quietest possible lie on this panel.
        row('The gate', u.done ? escapeHtml(gateName(u.natClass)) : 'walking…',
            u.natClass !== 'unknown'
              ? { inspect: 'gate', quality: u.inferred ? 'derived' : 'measured', color: gateCol,
                  why: u.inferred
                    ? 'deduced, not compared: ICE prunes a reflexive candidate that duplicates another, so one surviving candidate from two servers means the two servers agreed'
                    : 'two public STUN servers, one local socket — same public port means one mapping serves every destination, different ports means a fresh mapping per destination' }
              : { inspect: 'gate', quality: 'unavailable', why: escapeHtml(u.note) })
        + row('Public ports seen', u.ports.length ? u.ports.join(' · ') : '—',
            u.ports.length ? { quality: 'measured' }
              : { quality: 'unavailable', why: 'no server-reflexive candidate came back' })
        + row('Servers answering', `${u.serversAnswered} of ${u.serversTried}`
              + (u.inferred ? ' <span style="color:#5a5a6e;">(one pruned as a duplicate)</span>' : ''),
            { quality: 'measured',
              why: u.inferred
                ? 'both servers answered; the browser surfaced one candidate because the two were identical'
                : 'distinct STUN servers whose reflexive candidate survived ICE pruning' })
        + row('Gathering', u.complete ? 'finished on its own' : (u.done ? 'cut off at the timeout' : '—'),
            { quality: 'reported',
              why: 'a gather that timed out cannot tell a pruned duplicate from a server that went quiet, so it never infers a gate' })
        + row('Address over UDP', u.srflxIp ? escapeHtml(u.srflxIp) : '—',
            u.srflxIp ? { quality: 'measured',
                          color: s.udpIpMismatch ? '#f08a6a' : undefined,
                          why: s.udpIpMismatch
                            ? 'this does NOT match the address the HTTP trace reported — something is rewriting one protocol family and not the other'
                            : 'a second, independent witness to the same public address the HTTP trace saw' }
              : { quality: 'unavailable', why: 'no v4 reflexive candidate' })
        + row('IPv6', u.done ? (u.hasV6 ? 'working · ' + escapeHtml(u.srflxIp6) : 'no v6 candidate came back') : '—',
            u.done ? { inspect: 'identity-ipv6', quality: 'measured',
                       color: u.hasV6 ? '#7fd6a0' : undefined,
                       why: 'a v6 packet left this machine and came back — which is a different and much better question than whether some remote HOST has an AAAA record' }
              : { quality: 'unavailable', why: 'the walk has not finished' })
        + row('The other road', u.stunMs ? fmt(u.stunMs, 0, 'ms') : '—',
            u.stunMs ? { inspect: 'stun', quality: 'derived',
                         why: 'offer to first reflexive candidate. Contains one real UDP round trip PLUS browser bookkeeping — this is a gathering time, not a ping' }
              : { quality: 'unavailable', why: 'no reflexive candidate was timed' })
        + row('Hidden by mDNS', `${u.mdnsHidden} of ${u.candidates} candidates`,
            { quality: 'reported',
              why: 'the browser replaced this machine’s LAN addresses with random *.local names. It does that unless a page has camera or microphone permission, and this game will never ask for either' })
        + (u.done ? note(escapeHtml(gateFiction(u.natClass)) + ' — ' + escapeHtml(u.note)) : '')
        + note('Two STUN binding requests, about 200 bytes, sent once per run. No media, no data '
          + 'channel that ever opens, no permission prompt, and nothing about you is transmitted — '
          + 'a binding request asks a server what address it sees and the server answers. This is '
          + 'the ONLY measurement in the game that did not ride TCP.'));
    }

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

    // N4.7 — THE MASKING. Evidence with confidence, never a verdict.
    //
    // A false positive here accuses a player of something. Somebody living
    // abroad, running a browser in a second language, or on a mobile carrier
    // whose CGNAT reverse-DNS happens to say "cloud" must never see the word
    // VPN stated as fact. So: every signal is shown with what it actually
    // compared, the weights are visible, and the summary describes the EVIDENCE
    // rather than the person.
    const mask = net.maskEvidence?.();
    if (mask) {
      const bandCol = { none: '#7fd6a0', weak: '#8fb6e8', mixed: '#d8c07a', strong: '#f08a6a' }[mask.band];
      out += section('THE MASKING',
        mask.signals.map((sig: any) => row(
          `${sig.hit ? '\u25cf' : '\u25cb'} ${escapeHtml(sig.name)}`,
          `${escapeHtml(sig.detail)} <span style="color:#5a5a6e;">w ${sig.weight.toFixed(2)}</span>`,
          { quality: 'derived', color: sig.hit ? '#f08a6a' : undefined })).join('')
        + row('Confidence', `${(mask.confidence * 100).toFixed(0)}% \u00b7 ${escapeHtml(mask.band)}`,
            { quality: 'derived', color: bandCol })
        + note(escapeHtml(mask.verdict))
        + note('Six independent signals, each individually weak. Any one of them has an innocent '
          + 'explanation; three agreeing is a strong case, and a strong case is still not proof. '
          + 'A signal whose inputs are unknown is SKIPPED rather than counted as a miss \u2014 "we could '
          + 'not check" is not evidence either way. Nothing here is transmitted anywhere.'));
    }

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
    const v = net.vessel?.reading;
    const ua = navigator.userAgent;
    const brand = /Edg|Chrome|Firefox|Safari/.exec(ua)?.[0] ?? '—';

    // N4.6: read from the Vessel system, NOT from a canvas built here.
    //
    // The previous version of this tab created a WebGL context on every render
    // to ask for the GPU string. This panel refreshes at 4 Hz while open, and
    // browsers cap live WebGL contexts (16 in Chrome) — so a Lens left open for
    // four seconds could evict the context the GAME is rendering with. The
    // Vessel reads it once at boot and calls WEBGL_lose_context immediately.
    const yes = (b: boolean) => b ? 'yes' : 'no';
    const bytes = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB`
      : n >= 1e6 ? `${(n / 1e6).toFixed(0)} MB` : `${(n / 1e3).toFixed(0)} kB`;

    let out = section('MACHINE',
      row('Browser', escapeHtml(brand), { inspect: 'vessel-ua', quality: 'reported' })
      + (v?.uaDeep
        ? row('System', escapeHtml([v.platform, v.platformVersion].filter(Boolean).join(' ')), { quality: 'reported' })
          + row('Architecture', escapeHtml([v.architecture, v.bitness && v.bitness + '-bit'].filter(Boolean).join(' / ') || '—'), { quality: 'reported' })
          + (v.model ? row('Model', escapeHtml(v.model), { quality: 'reported' }) : '')
        : row('System', 'unavailable',
            { quality: 'unavailable', why: 'getHighEntropyValues() is Chromium-only — Firefox and Safari give the UA string and nothing more' }))
      + row('CPU cores', fmt(s.cpuCores, 0), { quality: 'reported' })
      + row('Device memory', fmt(s.deviceMemory, 0, 'GB'), { quality: 'reported' })
      + row('GPU', escapeHtml(String(v?.gpuRenderer || '—').slice(0, 64)),
          v?.gpuUnmasked
            ? { inspect: 'vessel-gpu', quality: 'reported' }
            : { inspect: 'vessel-gpu', quality: 'unavailable', why: 'the unmasked-renderer extension was withheld — what is shown is the scrubbed marketing string, not the chip' })
      + (v?.gpuVendor ? row('GPU vendor', escapeHtml(v.gpuVendor.slice(0, 40)), { quality: 'reported' }) : ''));

    out += section('DISPLAY',
      row('Screen', `${screen.width}×${screen.height} @${devicePixelRatio}x`, { inspect: 'vessel-screen', quality: 'reported' })
      + row('Dynamic range', v?.hdr ? 'high (HDR)' : 'standard', { quality: 'reported' })
      + row('Colour gamut', escapeHtml(v?.gamut ?? 'srgb'), { quality: 'reported' }));

    // ---- N4.6: the four reads that actually move the game ----------------
    const pressLive = v && v.pressure !== 'unknown';
    out += section('STRAIN',
      row('Vessel strain', pressLive ? `${escapeHtml(v!.pressure)} · ${escapeHtml(pressureFiction(v!.pressure))}` : 'unavailable',
          pressLive
            ? { quality: 'measured', inspect: 'veilPressure', color: v!.pressureFrac > 0.5 ? '#f08a6a' : '#7fd6a0' }
            : { quality: 'unavailable', inspect: 'veilPressure', why: "PressureObserver('cpu') is Chromium 125+ — the JS-heap proxy is standing in" })
      + row('Stutter', v?.jankLive ? (v.jankMs > 0 ? `${fmt(v.jankMs, 0, 'ms')} worst of ${v.jankCount} in 20s` : 'none in 20s') : 'unavailable',
          v?.jankLive
            ? { quality: 'measured', inspect: 'mercy', color: v.jankMs > 100 ? '#f08a6a' : '#7fd6a0' }
            : { quality: 'unavailable', inspect: 'mercy', why: 'long-animation-frame is Chromium 123+' })
      + row('JS heap', s.jsHeapUsedMB > 0 ? `${fmt(s.jsHeapUsedMB, 0)} / ${fmt(s.jsHeapTotalMB, 0)} MB` : 'unavailable',
          s.jsHeapUsedMB > 0 ? { quality: 'reported' }
            : { quality: 'unavailable', why: 'performance.memory is Chromium-only' })
      + row('Battery', s.batteryLevel >= 0 ? `${(s.batteryLevel * 100).toFixed(0)}%${s.batteryCharging ? ' ⚡' : ''}` : 'unavailable',
          s.batteryLevel >= 0 ? { quality: 'reported' }
            : { quality: 'unavailable', why: 'the Battery Status API is Chromium-only and may be disabled' })
      + note('Strain is the OS telling the browser telling us — a FIRST-PARTY load signal. Where it '
        + 'reports it supersedes the JS-heap proxy entirely, because heap size measures what this tab '
        + 'allocated and says nothing about whether the machine is struggling. Stutter runs the other '
        + 'way from every other reading here: measured jank makes the game EASIER, widening your dodge '
        + 'window, because a frame you never saw is not a mistake you made.'));

    out += section('THE HOLD',
      row('Storage', v?.storageQuota
            ? `${bytes(v.storageUsage)} of ${bytes(v.storageQuota)} used`
            : 'unavailable',
          v?.storageQuota ? { quality: 'reported', inspect: 'dropMemory' }
            : { quality: 'unavailable', inspect: 'dropMemory', why: 'navigator.storage.estimate() is unavailable or refused here' })
      + row('Free', `${((v?.storageFreeFrac ?? 1) * 100).toFixed(0)}%`, { quality: 'derived', inspect: 'dropMemory' })
      + row('Sample rate', v?.sampleRate ? `${(v.sampleRate / 1000).toFixed(1)} kHz` : 'unavailable',
          v?.sampleRate ? { quality: 'reported' }
            : { quality: 'unavailable', why: 'the AudioContext has not been started — it needs a click or a keypress first' })
      + row('Audio latency', v?.outputLatency ? `${(v.outputLatency * 1000).toFixed(1)} ms out / ${(v.baseLatency * 1000).toFixed(1)} ms buffer`
            : v?.baseLatency ? `${(v.baseLatency * 1000).toFixed(1)} ms buffer` : 'unavailable',
          v?.baseLatency ? { quality: 'measured' }
            : { quality: 'unavailable', why: 'outputLatency is Chromium-only; baseLatency needs a running context' })
      + row('Devices', v?.devicesLive ? `${v.audioIn} in · ${v.audioOut} out · ${v.videoIn} camera${v.videoIn === 1 ? '' : 's'}` : 'unavailable',
          v?.devicesLive ? { quality: 'reported' }
            : { quality: 'unavailable', why: 'enumerateDevices() is blocked by a permissions policy here' }));

    out += section('POSTURE',
      row('Locale', escapeHtml(s.locale || navigator.language), { quality: 'reported' })
      + (v?.languages?.length ? row('Languages', escapeHtml(v.languages.join(', ')), { quality: 'reported' }) : '')
      + row('Timezone', escapeHtml(s.timezone), { quality: 'reported' })
      + row('Calendar', escapeHtml(`${v?.calendar ?? '—'} · ${v?.numberingSystem ?? '—'}`), { quality: 'reported' })
      + row('Reduced motion', yes(!!v?.reducedMotion),
          { quality: 'reported', color: v?.reducedMotion ? '#7fd6a0' : undefined })
      + row('Contrast', v?.forcedColors ? 'forced colours' : v?.highContrast ? 'more' : 'standard', { quality: 'reported' })
      + row('Privacy control', v?.gpc ? 'GPC on' : v?.doNotTrack ? 'DNT on' : 'neither set', { quality: 'reported' })
      + row('Cross-origin isolated', yes(!!v?.isolated), { quality: 'reported' })
      + note('Reduced motion is the one reading on this panel the game OBEYS rather than measures: '
        + 'with it on the camera does not shake at all. Everything else here stays in this tab, is '
        + 'never transmitted, and dies with the page — which is worth saying plainly, because this '
        + 'is the same list of APIs a fingerprinting script reads. The difference is entirely in what '
        + 'happens next.'));

    out += note('Geolocation is deliberately never requested. It fires a browser permission prompt, and '
      + 'the identity probes already show IP-level geography without asking the player for anything.');
    return out;
  },
};

// -------------------------------------------------------------- THREADS ----
const threads: LensTab = {
  id: 'threads',
  title: 'THREADS',
  render({ net, log, chronicle, omens, sounding }) {
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

    // N4.5/A7 — THE PACT. The covenant and the bytes it has spent, shown in the
    // one place that already renders readings being turned into game numbers.
    const pact = sounding?.pact?.();
    if (pact) {
      out += section('THE PACT',
        row('Pact', `${escapeHtml(pact.name)} · ${escapeHtml(pact.budgetLabel)}`, { quality: 'derived', color: pact.color })
        + row('Budget', `${((sounding.spent ?? 0) / 1e6).toFixed(1)} of ${pact.budgetMB} MB`, { quality: 'measured' })
        + row('Soundings', `${sounding.count ?? 0}`, { quality: 'measured' })
        + note('The pact is the difficulty tier: its multipliers are read into the night wave, the loot '
          + 'floor and the Legacy score. The budget is what you consented to spend on soundings.'));
    }

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

// ============================================================================
// N4.7b — The UDP path.
//
// Every measurement this project has ever taken rode TCP over HTTPS. `fetch`,
// the Performance API waterfalls, the Cloudflare trace, the DoH resolvers, the
// Sounding's download — all of it is one protocol family taking one kind of
// route. A STUN binding request is **UDP**, and it takes a different path
// through the same network.
//
// That difference is the entire point of this file. Two roads out of the same
// house, and until now the game had only ever walked down one of them.
//
// ---------------------------------------------------------------------------
// What a browser will actually tell you, without asking the user anything
// ---------------------------------------------------------------------------
//
// `RTCPeerConnection` gathers ICE candidates the moment it is given a local
// description. No media, no `getUserMedia`, no permission prompt, no data
// channel that ever opens, no peer on the other end. The browser sends a STUN
// binding request — about a hundred bytes — to each configured server, and each
// server replies with the public address and port it saw the packet arrive
// from. The browser hands that back as a `srflx` (server-reflexive) candidate.
//
// From that alone:
//
//   * **The public address, from a second and independent witness.** The HTTP
//     path already knows an IP from the Cloudflare trace. If UDP disagrees with
//     TCP about who you are, something is rewriting one of them — a split
//     tunnel, a proxy that only handles TCP, a corporate middlebox. That is
//     genuinely strong evidence and §2.8c of the plan wanted it from the start.
//   * **The NAT's behaviour.** Ask two different STUN servers at once. Your
//     machine sends from ONE local UDP socket, so a NAT that allocates its
//     mapping per-socket gives both servers the same public port, and a NAT
//     that allocates per-destination gives them different ones. Same port is a
//     cone NAT; different ports is a **symmetric** NAT. This is the classic
//     RFC 3489 discrimination and it is a real, classifiable property of the
//     network the player is sitting behind.
//   * **Whether IPv6 actually works.** N4.4's Scrying can already read an AAAA
//     record, but that answers "does that HOST have a v6 address" — a question
//     about somewhere else. An IPv6 srflx candidate answers "did a v6 packet
//     leave THIS machine and come back", which is the question that was
//     actually being asked.
//   * **A UDP round trip.** Time from the offer to the first reflexive
//     candidate. Not as clean as `getStats()` on a connected candidate pair —
//     see the honesty note below — but it is a real packet going to a real
//     server and coming back.
//
// ---------------------------------------------------------------------------
// Three honesty constraints, because this is the easiest file in the project
// to quietly lie in
// ---------------------------------------------------------------------------
//
// **1. mDNS.** Modern browsers replace local host candidates with randomised
// `<uuid>.local` names unless media permission has been granted. We do not ask
// for camera or microphone and never will, so LAN addresses stay hidden. That
// is correct browser behaviour protecting the user, and the plan says in bold
// not to design around it. So we COUNT the obfuscated candidates and say so in
// the panel, rather than pretending the reading is complete.
//
// **2. The RTT is a gathering time, not a ping.** A true UDP RTT needs
// `getStats()` on a `candidate-pair`, and a candidate pair requires a second
// peer to pair with. There is no second peer. What we measure is the interval
// from `setLocalDescription` to the first srflx candidate arriving, which
// contains one genuine UDP round trip plus some browser bookkeeping. It is
// labelled `stunMs` and described as "time to first reflexive candidate"
// everywhere it is shown. It is never called a ping.
//
// **3. One server answering proves nothing about the NAT.** The symmetric test
// is a COMPARISON. If only one of the two servers replies — blocked, rate
// limited, unreachable on this network — the honest answer is `unknown`, not a
// guess at `cone` because a guess would be right most of the time. `unknown`
// maps to the neutral game value, per pillar 5.
//
// ---------------------------------------------------------------------------
// The pruning, and why one candidate is not one answer
// ---------------------------------------------------------------------------
//
// The first version of this file read one srflx candidate from two configured
// servers and concluded `unknown` — a server had not answered, and a
// comparison needs two. That was wrong, and it was wrong on the most common
// home network there is. Measured, headless Chrome, both servers alone and
// then together:
//
//   google alone      -> 1 srflx, port 56672, answered in 35 ms, gathering complete
//   cloudflare alone  -> 1 srflx, port 51079, answered in 11 ms, gathering complete
//   both together     -> 1 srflx, gathering complete in 138 ms
//
// Both servers are alive, fast, and answering. What happens with both
// configured is that ICE **prunes redundant candidates**: two srflx entries
// with the same address and the same port are the same candidate, so the
// browser surfaces one. Which means the missing second candidate is not a
// silence — it is the two servers agreeing, and agreement is precisely the
// cone-NAT finding.
//
// So the rule is: gathering COMPLETED (a null candidate arrived, not a
// timeout), two or more servers were asked, and exactly one v4 reflexive
// candidate came back => both servers saw one mapping => cone. A symmetric NAT
// gives the two servers different ports, the candidates are not redundant,
// neither is pruned, and both arrive. A timeout is still `unknown`, because a
// gather that never finished cannot tell a pruned duplicate from a server that
// went quiet.
//
// That inference is marked `inferred` on the reading and the Lens says so. It
// is a deduction from browser behaviour rather than a direct comparison of two
// numbers, and the panel should not present the two as the same grade of fact.
//
// A second thing the same experiment settled: `relatedPort` on a srflx
// candidate is **0** in Chrome, not the local port. The grouping below still
// keys on it because Firefox does populate it and grouping by a constant is
// harmless, but nobody should read that code expecting it to do work here.
//
// ---------------------------------------------------------------------------
// Right of way (§6.2)
// ---------------------------------------------------------------------------
//
// The two servers below are the ones the plan names: Google's public STUN and
// Cloudflare's. Both are operated as free public infrastructure explicitly for
// this purpose, and a binding request is the single cheapest thing either of
// them serves. We send exactly two, once per run, and never retry on a
// failure — a server that did not answer has told us something, and asking it
// again would just be noise on somebody else's box.
// ============================================================================

/** The two public STUN servers §2.6 names. Two, because the NAT test is a
 *  comparison and one server cannot make one. */
export const STUN_SERVERS = [
  'stun:stun.l.google.com:19302',
  'stun:stun.cloudflare.com:3478',
];

/** How long to let gathering run before taking what we have.
 *
 *  Generous, because this fires once per run in the background and nothing
 *  waits on it — but bounded, because `icegatheringstatechange` reaching
 *  'complete' is not guaranteed on every network. A UDP-blocked corporate
 *  network is exactly the case where it hangs, and that case must resolve to a
 *  real reading (`blocked`) rather than to a promise nobody settles. */
export const GATHER_TIMEOUT_MS = 5000;

export type NatClass = 'unknown' | 'open' | 'cone' | 'symmetric' | 'blocked';

export interface UdpReading {
  /** Is there an RTCPeerConnection to use at all? False on a browser with
   *  WebRTC disabled, which some privacy builds and enterprise policies do. */
  supported: boolean;
  /** Has a gather actually finished? Until then every field below is neutral
   *  and the Lens says so rather than printing a confident zero. */
  done: boolean;
  /** Public IPv4 as UDP saw it. '' when no v4 reflexive candidate came back. */
  srflxIp: string;
  /** Public IPv6 as UDP saw it. '' when none — which is the common case and
   *  is not a failure. */
  srflxIp6: string;
  /** True when a v6 reflexive candidate came back: this machine has working,
   *  end-to-end IPv6. The strongest answer to that question available to a
   *  browser. */
  hasV6: boolean;
  /** The public ports the NAT allocated, one per answering server — taken
   *  from the ONE local socket the most servers answered on, never mixed
   *  across interfaces. Two identical values is the cone finding; two
   *  different values is the symmetric one. */
  ports: number[];
  natClass: NatClass;
  /** Did ICE gathering finish on its own (a null candidate arrived) rather than
   *  hit the timeout? The pruning inference below is only valid when it did. */
  complete: boolean;
  /** True when `natClass` was DEDUCED from candidate pruning rather than
   *  measured by comparing two ports. Shown as a different grade of fact. */
  inferred: boolean;
  /** Time from the offer to the FIRST reflexive candidate, ms. 0 = unmeasured.
   *  Contains one real UDP round trip. Not a ping — see the header. */
  stunMs: number;
  serversTried: number;
  serversAnswered: number;
  /** How many host candidates the browser handed us as `*.local` mDNS names
   *  instead of LAN addresses. Counted so the panel can say what it cannot
   *  see, which is the whole point of an honesty tag. */
  mdnsHidden: number;
  /** Total candidates of any type, for the Lens. */
  candidates: number;
  /** Why the reading is what it is, in one clause. Shown verbatim. */
  note: string;
}

export function neutralUdp(): UdpReading {
  return {
    supported: typeof RTCPeerConnection !== 'undefined',
    done: false,
    srflxIp: '', srflxIp6: '', hasV6: false,
    ports: [], natClass: 'unknown', complete: false, inferred: false, stunMs: 0,
    serversTried: 0, serversAnswered: 0,
    mdnsHidden: 0, candidates: 0,
    note: 'the UDP path has not been walked yet',
  };
}

/** Classify from what came back.
 *
 *  Split out from the gather so the decision is testable without a network,
 *  and so the branch order is readable in one screen. Every path that cannot
 *  distinguish returns `unknown` — the neutral answer — rather than the most
 *  likely one. */
export function classifyNat(input: {
  /** Public ports from the busiest local socket, one per surviving candidate. */
  ports: number[];
  /** Distinct STUN servers whose candidates survived. */
  answered: number;
  /** How many were asked. */
  tried: number;
  /** Did gathering finish on its own? The pruning inference needs this. */
  complete: boolean;
  srflxIp: string;
  localIps: string[];
}): { natClass: NatClass; inferred: boolean; note: string } {
  const { ports, answered, tried, complete, srflxIp, localIps } = input;

  // Nothing reflexive at all. Every STUN request went out and none came back,
  // which is what a network filtering UDP looks like — and also what a browser
  // extension suppressing WebRTC looks like. In this game's fiction those are
  // the same thing, and the note says both out loud.
  if (tried > 0 && !srflxIp && ports.length === 0) {
    return {
      natClass: 'blocked', inferred: false,
      note: complete
        ? 'gathering finished and no server answered — UDP is filtered here, or WebRTC is suppressed'
        : 'no server answered before the timeout — UDP is filtered here, or WebRTC is suppressed',
    };
  }

  // No NAT at all: the address UDP came back with is an address this machine
  // holds directly. Rare, and worth naming — it means there is no translation
  // layer between the player and the internet.
  if (srflxIp && localIps.includes(srflxIp)) {
    return {
      natClass: 'open', inferred: false,
      note: 'the address STUN saw is an address this machine holds — no translation in the way',
    };
  }

  // Two or more surviving candidates: the direct comparison, measured.
  if (ports.length >= 2) {
    const same = ports.every((p) => p === ports[0]);
    return same
      ? {
        natClass: 'cone', inferred: false,
        note: `both servers saw port ${ports[0]} — one mapping serves every destination`,
      }
      : {
        natClass: 'symmetric', inferred: false,
        note: `the servers saw ports ${ports.join(' and ')} — a fresh mapping per destination`,
      };
  }

  // One surviving candidate from two or more servers, and gathering finished
  // cleanly. ICE pruned a redundant candidate, and two candidates are only
  // redundant when they carry the SAME address and port — so the servers
  // agreed. See the header for the measurement this rests on.
  if (ports.length === 1 && tried >= 2 && complete) {
    return {
      natClass: 'cone', inferred: true,
      note: `one candidate survived from ${tried} servers on port ${ports[0]} — the browser pruned `
        + 'a duplicate, which means both servers saw the same mapping',
    };
  }

  return {
    natClass: 'unknown', inferred: false,
    note: !complete
      ? 'gathering timed out, and a gather that never finished cannot tell a pruned duplicate from a silent server'
      : answered === 1 && tried < 2
        ? 'only one server was asked, and the NAT test is a comparison between two'
        : 'not enough reflexive candidates came back to compare',
  };
}

/** Walk the UDP path once.
 *
 *  Resolves — always. Never rejects, never hangs past the timeout. A browser
 *  with WebRTC removed, a network that eats UDP, and a machine behind three
 *  layers of CGNAT all produce a `UdpReading`; they simply produce different
 *  ones, and the neutral parts stay neutral. */
export async function walkUdpPath(
  servers: string[] = STUN_SERVERS,
  timeoutMs = GATHER_TIMEOUT_MS,
): Promise<UdpReading> {
  const out = neutralUdp();
  if (!out.supported) {
    out.done = true;
    out.note = 'this browser has no RTCPeerConnection — WebRTC is disabled or removed';
    return out;
  }

  let pc: RTCPeerConnection | null = null;
  try {
    // One server per iceServers entry, deliberately. Chrome will happily take
    // `{ urls: [a, b] }` but then reports both candidates against the same
    // entry, and we need to know WHICH server saw which port for the
    // comparison to mean anything.
    pc = new RTCPeerConnection({
      iceServers: servers.map((u) => ({ urls: u })),
      // Nothing is going to connect, so gather one candidate per interface
      // rather than one per (interface x component). Halves the traffic and
      // removes duplicate ports that would otherwise look like a cone result.
      iceCandidatePoolSize: 0,
    });
    out.serversTried = servers.length;

    // Every v4 reflexive candidate, kept whole rather than reduced to a port.
    //
    // Reducing early is the trap here. A laptop with wifi AND ethernet up
    // gathers against both servers from BOTH interfaces — four candidates, four
    // different local sockets, four different public ports — and a naive
    // "were the ports the same" check calls that symmetric on a network that is
    // nothing of the kind. The real RFC 3489 test compares what two DIFFERENT
    // servers saw from ONE local socket, so the local port (`relatedPort`) has
    // to survive to the comparison.
    const srflx: Array<{ local: number; port: number; server: string }> = [];
    const localIps: string[] = [];
    // Reassigned to just before setLocalDescription below, which is the moment
    // ICE gathering actually starts. Creating the data channel and building the
    // offer is main-thread work — SDP munging, not packets — and in a running
    // game that main thread is also rendering. Timing from here would fold the
    // renderer's contention into a reading the panel calls a UDP round trip,
    // and the game already measures main-thread stalls properly (N4.6's LoAF
    // jank window). Two measurements of the same thing that disagree is worse
    // than one honest one.
    let t0 = performance.now();

    const gathered = new Promise<void>((resolve) => {
      const finish = () => resolve();
      const timer = setTimeout(finish, timeoutMs);

      pc!.onicecandidate = (ev) => {
        const c = ev.candidate;
        // A null candidate means the browser finished on its own rather than
        // being cut off by the timeout. That distinction carries the pruning
        // inference in classifyNat(), so it is recorded, not just acted on.
        if (!c) { out.complete = true; clearTimeout(timer); finish(); return; }
        out.candidates++;
        const addr = c.address ?? '';
        if (c.type === 'host') {
          // The mDNS caveat, counted rather than complained about.
          if (addr.endsWith('.local')) out.mdnsHidden++;
          else if (addr) localIps.push(addr);
        }
        if (c.type !== 'srflx' || !addr) return;

        if (!out.stunMs) out.stunMs = performance.now() - t0;
        const v6 = addr.includes(':');
        if (v6) {
          out.hasV6 = true;
          if (!out.srflxIp6) out.srflxIp6 = addr;
        } else if (!out.srflxIp) {
          out.srflxIp = addr;
        }
        // Only v4 mappings are compared. A dual-stack machine gathers against
        // both families and the v6 "mapping" is not a mapping at all — v6 has
        // no NAT to characterise, so folding it in would report `symmetric` on
        // every dual-stack home network in the world.
        if (!v6 && typeof c.port === 'number') {
          // `url` is which STUN server produced this candidate. Chromium-only
          // and non-standard, so a browser without it falls back to the
          // candidate's own foundation, which ICE guarantees differs between
          // candidates from different servers.
          const server = (c as any).url || c.foundation || String(srflx.length);
          srflx.push({ local: c.relatedPort ?? -1, port: c.port, server: String(server) });
        }
      };

      // A browser that never emits the null candidate still reaches 'complete'.
      pc!.onicegatheringstatechange = () => {
        if (pc!.iceGatheringState === 'complete') {
          out.complete = true; clearTimeout(timer); finish();
        }
      };
    });

    // A data channel is what gives ICE something to gather FOR. It is never
    // opened, never written to, and dies with the connection — but without it
    // the offer has no media section and the browser gathers nothing at all.
    pc.createDataChannel('nw');
    const offer = await pc.createOffer();
    t0 = performance.now();          // gathering begins at setLocalDescription
    await pc.setLocalDescription(offer);
    await gathered;

    // Pick the local socket that the most servers answered on, and compare
    // only within it. A tie goes to whichever appeared first, which is the
    // browser's own interface preference and therefore the path this machine
    // would actually have used.
    const byLocal = new Map<number, typeof srflx>();
    for (const c of srflx) {
      const g = byLocal.get(c.local) ?? [];
      g.push(c);
      byLocal.set(c.local, g);
    }
    let best: typeof srflx = [];
    for (const g of byLocal.values()) if (g.length > best.length) best = g;
    const answeredSet = new Set(best.map((c) => c.server));
    out.ports = best.map((c) => c.port);
    out.serversAnswered = answeredSet.size || (out.srflxIp || out.srflxIp6 ? 1 : 0);
    const verdict = classifyNat({
      ports: out.ports, answered: out.serversAnswered, tried: out.serversTried,
      complete: out.complete, srflxIp: out.srflxIp, localIps,
    });
    out.natClass = verdict.natClass;
    out.inferred = verdict.inferred;
    out.note = verdict.note;
    out.done = true;
  } catch (e: any) {
    out.done = true;
    out.natClass = 'unknown';
    out.note = `the UDP path could not be walked (${e?.name ?? 'error'})`;
  } finally {
    try { pc?.close(); } catch { /* already gone */ }
  }
  return out;
}

/** The Veil's word for a NAT class. Pillar 7: name the sense, never the
 *  instrument. The player is told about the gate they live behind; the Lens,
 *  one drawer away, says `symmetric` and shows the two ports. */
export function gateFiction(n: NatClass): string {
  return {
    unknown: 'the gate behind you keeps its own counsel',
    open: 'there is no gate — you stand in the open, and everything can reach you',
    cone: 'one gate, one key, and it opens the same way for everyone',
    symmetric: 'a different door for every caller, and the gate remembers none of them',
    blocked: 'the gate is shut and answers nothing',
  }[n];
}

/** The Veil's name for the gate, for a HUD chip or a panel heading. */
export function gateName(n: NatClass): string {
  return {
    unknown: 'The Unread Gate', open: 'The Open Way', cone: 'The Single Gate',
    symmetric: 'The Warded Gate', blocked: 'The Shut Gate',
  }[n];
}

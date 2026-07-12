// Build the Rust core to wasm. Thin wrapper around wasm-pack that pins the
// cargo target dir to node_modules/.cargo-target (the OneDrive dodge — see the
// R0 brief and rust/nightward-core/.cargo/config.toml).
//
// Why a wrapper and not just the config.toml: wasm-pack does NOT honour
// `build.target-dir` from .cargo/config.toml — it hardcodes `<crate>/target`
// when locating the compiled .wasm, so cargo (which DOES honour the config)
// and wasm-pack disagree and the build fails. wasm-pack DOES honour the
// CARGO_TARGET_DIR env var, and an ABSOLUTE value is resolved identically by
// both, so we compute it here and pass it through. Same behaviour on Windows
// (local) and Linux (CI). Recorded as the R0 deviation in ROADMAP.md.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const repoRoot = process.cwd(); // npm runs scripts from the package.json dir
const targetDir = path.join(repoRoot, 'node_modules', '.cargo-target');

const args = [
  'build', 'rust/nightward-core',
  '--target', 'web',
  '--release',
  '--out-dir', '../../src/wasm/pkg',
];

const res = spawnSync('wasm-pack', args, {
  stdio: 'inherit',
  shell: true, // resolve the wasm-pack shim from node_modules/.bin cross-platform
  env: { ...process.env, CARGO_TARGET_DIR: targetDir },
});

process.exit(res.status ?? 1);

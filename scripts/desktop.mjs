import { existsSync } from 'node:fs';
import { resolve, delimiter } from 'node:path';
import { spawn } from 'node:child_process';
const local = resolve('../work/toolchain');
const env = { ...process.env };
if (existsSync(resolve(local, 'cargo/bin/cargo'))) {
  env.CARGO_HOME = resolve(local, 'cargo');
  env.RUSTUP_HOME = resolve(local, 'rustup');
  env.PATH = resolve(local, 'cargo/bin') + delimiter + env.PATH;
}
const args = process.argv.slice(2);
const child = spawn(
  process.execPath,
  [resolve('node_modules/@tauri-apps/cli/tauri.js'), ...(args.length ? args : ['dev'])],
  {
    stdio: 'inherit',
    env,
  },
);
child.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 1));

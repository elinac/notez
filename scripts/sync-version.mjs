import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

export function isValidAppVersion(v) {
  return /^\d+\.\d+\.\d+$/.test(v);
}

export function applyVersionToCargoToml(content, version) {
  const lines = content.split('\n');
  let inPackage = false;
  return lines
    .map((line) => {
      if (line.trim() === '[package]') inPackage = true;
      else if (line.startsWith('[') && line.trim() !== '[package]') inPackage = false;
      if (inPackage && /^version\s*=/.test(line)) {
        return `version = "${version}"`;
      }
      return line;
    })
    .join('\n');
}

export function applyVersionToTauriConf(conf, version) {
  return { ...conf, version };
}

function readTargetVersion() {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const version = pkg.version;
  if (!isValidAppVersion(version)) {
    console.error(`Invalid version in package.json: ${version}`);
    process.exit(1);
  }
  return version;
}

function syncFiles(version) {
  const cargoPath = join(root, 'src-tauri/Cargo.toml');
  const tauriConfPath = join(root, 'src-tauri/tauri.conf.json');

  const cargoRaw = readFileSync(cargoPath, 'utf8');
  const cargoNew = applyVersionToCargoToml(cargoRaw, version);
  if (cargoNew !== cargoRaw) writeFileSync(cargoPath, cargoNew);

  const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf8'));
  const tauriNew = applyVersionToTauriConf(tauriConf, version);
  const tauriJson = JSON.stringify(tauriNew, null, 2) + '\n';
  const tauriRaw = readFileSync(tauriConfPath, 'utf8');
  if (tauriJson !== tauriRaw) writeFileSync(tauriConfPath, tauriJson);

  execSync('cargo check -q', { cwd: join(root, 'src-tauri'), stdio: 'inherit' });
}

function main() {
  const version = readTargetVersion();
  syncFiles(version);
  console.log(`Synced version to ${version}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();

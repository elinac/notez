// scripts/generate-changelog.mjs
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function parseArgs(argv) {
  const args = { from: null, to: 'HEAD', version: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--from') args.from = argv[++i];
    else if (argv[i] === '--to') args.to = argv[++i];
    else if (argv[i] === '--version') args.version = argv[++i];
  }
  return args;
}

function readPackageVersion() {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
}

function gitLogRange(from, to) {
  const range = from ? `${from}..${to}` : to;
  const result = spawnSync(
    'git',
    ['log', range, '--pretty=format:%s|%h|%ad', '--date=short'],
    { cwd: root, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    console.error(result.stderr || 'git log failed');
    process.exit(1);
  }
  const out = result.stdout.trim();
  if (!out) return [];
  return out.split('\n').map((line) => {
    const [subject, hash, date] = line.split('|');
    return { subject, hash, date };
  });
}

function groupSubject(subject) {
  const m = subject.match(/^(feat|fix|docs|test|refactor|chore|style)(\([^)]*\))?!?:\s*/);
  if (!m) return 'Other';
  const map = {
    feat: 'Features',
    fix: 'Bug Fixes',
    docs: 'Documentation',
    test: 'Tests',
    refactor: 'Other',
    chore: 'Other',
    style: 'Other',
  };
  return map[m[1]] ?? 'Other';
}

function buildSection(commits) {
  const groups = {};
  for (const c of commits) {
    if (c.subject.startsWith('Merge')) continue;
    const g = groupSubject(c.subject);
    (groups[g] ||= []).push(c);
  }
  const order = ['Features', 'Bug Fixes', 'Documentation', 'Tests', 'Other'];
  let md = '';
  for (const g of order) {
    if (!groups[g]?.length) continue;
    md += `### ${g}\n\n`;
    for (const c of groups[g]) {
      md += `- ${c.subject} (${c.hash})\n`;
    }
    md += '\n';
  }
  return md;
}

function main() {
  const args = parseArgs(process.argv);
  const version = args.version ?? readPackageVersion();
  const commits = gitLogRange(args.from, args.to);
  if (!commits.length) {
    console.error('No commits in range');
    process.exit(1);
  }
  const date = commits[0].date; // 最新 commit 日期
  const entry = `## [${version}] - ${date}\n\n${buildSection(commits)}`;
  const changelogPath = join(root, 'CHANGELOG.md');
  const existing = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : '';
  const header = existing.startsWith('# Changelog')
    ? ''
    : '# Changelog\n\nAll notable changes to NoteZ are documented here.\n\n';
  const body = existing.startsWith('# Changelog')
    ? existing.replace(/^# Changelog\n\n/, `# Changelog\n\n${entry}`)
    : `${header}${entry}`;
  writeFileSync(changelogPath, body);
  console.log(`Wrote CHANGELOG.md section [${version}]`);
}

main();

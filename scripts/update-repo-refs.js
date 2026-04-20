#!/usr/bin/env node

/**
 * Bulk-update repository URLs across all package.json files to match
 * the values in project.json. Run this after renaming the GitHub repo
 * or changing the URL in project.json.
 *
 * Usage:
 *   node scripts/update-repo-refs.js            # dry-run (default)
 *   node scripts/update-repo-refs.js --apply     # write changes
 */

const fs = require('fs');
const path = require('path');

const dryRun = !process.argv.includes('--apply');
const root = path.resolve(__dirname, '..');
const proj = JSON.parse(fs.readFileSync(path.join(root, 'project.json'), 'utf-8'));
const repoUrl = proj.githubUrl + '.git';
let updated = 0;

function update(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const pkg = JSON.parse(raw);
  if (!pkg.repository?.url || pkg.repository.url === repoUrl) return;
  const old = pkg.repository.url;
  pkg.repository.url = repoUrl;
  if (dryRun) {
    console.log(`  [dry-run] ${path.relative(root, filePath)}: ${old} → ${repoUrl}`);
  } else {
    fs.writeFileSync(filePath, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`  ${path.relative(root, filePath)}: ${old} → ${repoUrl}`);
  }
  updated++;
}

const pkgsDir = path.join(root, 'packages');
for (const dir of fs.readdirSync(pkgsDir).sort()) {
  const p = path.join(pkgsDir, dir, 'package.json');
  if (fs.existsSync(p)) update(p);
}

const demoPath = path.join(root, 'demo', 'package.json');
if (fs.existsSync(demoPath)) update(demoPath);

if (updated === 0) {
  console.log('All repository URLs already match project.json — nothing to do.');
} else if (dryRun) {
  console.log(`\n${updated} file(s) would be updated. Run with --apply to write.`);
} else {
  console.log(`\n${updated} file(s) updated.`);
}

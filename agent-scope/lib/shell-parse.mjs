// Pure shell-command parser used by the beforeShellExecution hook.
// Extracted for unit-testability. No IO, no dependencies on scope.mjs.

// Split on &&, ||, ;, | — treat each sub-command independently.
export function splitCommands(cmd) {
  const parts = [];
  let buf = '';
  let inSingle = false, inDouble = false;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    if (!inSingle && !inDouble) {
      if ((c === '&' && cmd[i + 1] === '&') || (c === '|' && cmd[i + 1] === '|')) {
        parts.push(buf); buf = ''; i++; continue;
      }
      if (c === ';' || c === '|' || c === '\n') {
        parts.push(buf); buf = ''; continue;
      }
    }
    buf += c;
  }
  if (buf.trim()) parts.push(buf);
  return parts.map(s => s.trim()).filter(Boolean);
}

// Tokenize a single sub-command into argv, stripping quotes.
export function tokenize(cmd) {
  const out = [];
  let buf = '';
  let inSingle = false, inDouble = false;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (c === '\\' && !inSingle) { buf += cmd[++i] || ''; continue; }
    if (c === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (c === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (!inSingle && !inDouble && /\s/.test(c)) {
      if (buf) { out.push(buf); buf = ''; }
      continue;
    }
    buf += c;
  }
  if (buf) out.push(buf);
  return out;
}

// File-descriptor duplication (e.g. `2>&1`, `1>&2`, `>&1`, `1>&-`) is NOT a
// write to a file — the target starting with `&` references another fd, not
// a path. Without this guard, a harmless `cmd 2>&1` gets blocked because the
// parser thinks it redirects to a file called `&1`.
function isFdDupTarget(s) {
  return typeof s === 'string' && s.startsWith('&');
}

export function extractRedirections(tokens) {
  const targets = [];
  const push = (v) => { if (v && !isFdDupTarget(v)) targets.push(v); };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '>' || t === '>>' || t === '&>' || t === '>|') {
      push(tokens[i + 1]);
    } else if (/^[0-9]*>>?$/.test(t)) {
      push(tokens[i + 1]);
    } else if (/^([0-9]*>>?|&>)[^\s]+/.test(t)) {
      push(t.replace(/^([0-9]*>>?|&>)/, ''));
    } else if (t === 'tee' || t === '/usr/bin/tee') {
      for (let j = i + 1; j < tokens.length; j++) {
        const a = tokens[j];
        if (a === '-a' || a === '--append' || a === '-i' || a === '--ignore-interrupts') continue;
        if (a.startsWith('-')) continue;
        targets.push(a);
        break;
      }
    }
  }
  return targets;
}

export function extractDestructiveTargets(tokens) {
  if (!tokens.length) return { cmd: null, targets: [] };
  const head = tokens[0].split('/').pop();
  const DESTRUCTIVE = new Set(['rm', 'mv', 'cp', 'chmod', 'chown', 'truncate', 'install', 'ln', 'sed', 'unlink', 'rmdir']);
  if (!DESTRUCTIVE.has(head)) return { cmd: null, targets: [] };

  const targets = [];
  const rest = tokens.slice(1);
  if (head === 'sed') {
    const inPlace = rest.some(t => t === '-i' || t.startsWith('-i') || t === '--in-place');
    if (!inPlace) return { cmd: head, targets: [] };
  }

  for (const t of rest) {
    if (t.startsWith('-')) continue;
    if (t.includes('=')) continue;
    if (/^[0-9]+$/.test(t)) continue;
    if (head === 'chmod' && /^[0-7]{3,4}$/.test(t)) continue;
    if (head === 'chown' && !t.includes('/') && !t.startsWith('.')) {
      if (targets.length === 0) continue;
    }
    targets.push(t);
  }
  return { cmd: head, targets };
}

export function extractFindTargets(tokens) {
  if (!tokens.length || tokens[0].split('/').pop() !== 'find') return null;
  const isDestructive = tokens.some((t, i) =>
    t === '-delete' ||
    (t === '-exec' && /^(rm|unlink|truncate|mv|sed|chmod|chown)$/.test((tokens[i + 1] || '').split('/').pop()))
  );
  if (!isDestructive) return null;
  const paths = [];
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith('-')) break;
    paths.push(t);
  }
  return { cmd: 'find', targets: paths.length ? paths : ['.'] };
}

export function extractXargsTarget(tokens) {
  if (!tokens.length || tokens[0].split('/').pop() !== 'xargs') return null;
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith('-')) continue;
    const head = t.split('/').pop();
    if (/^(rm|unlink|truncate|mv|sed|chmod|chown|cp|install|ln)$/.test(head)) {
      return { cmd: `xargs ${head}`, targets: [] };
    }
    return null;
  }
  return null;
}

const NESTED_SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);

const OPAQUE_EVALUATORS = {
  node: ['-e', '--eval', '-p', '--print'],
  deno: ['eval'],
  python: ['-c'],
  python2: ['-c'],
  python3: ['-c'],
  perl: ['-e', '-E'],
  ruby: ['-e'],
  php: ['-r'],
  lua: ['-e'],
};

export function extractNestedShellBody(tokens) {
  const head = tokens[0] && tokens[0].split('/').pop();
  if (!head || !NESTED_SHELLS.has(head)) return null;
  const dashC = tokens.indexOf('-c');
  if (dashC >= 1 && tokens[dashC + 1]) return { shell: head, body: tokens[dashC + 1] };
  return null;
}

export function extractOpaqueBody(tokens) {
  const head = tokens[0] && tokens[0].split('/').pop();
  if (!head) return null;
  const flags = OPAQUE_EVALUATORS[head];
  if (!flags) return null;
  for (let i = 1; i < tokens.length; i++) {
    if (flags.includes(tokens[i]) && tokens[i + 1] != null) {
      return { evaluator: head, flag: tokens[i], body: tokens[i + 1] };
    }
  }
  return null;
}

const WRITE_HINTS = [
  /\bwriteFileSync\b/, /\bappendFileSync\b/, /\bunlinkSync\b/, /\brmSync\b/,
  /\brmdirSync\b/, /\brenameSync\b/, /\bcpSync\b/, /\bcopyFileSync\b/,
  /\bchmodSync\b/, /\bchownSync\b/, /\bsymlinkSync\b/, /\btruncateSync\b/,
  /\bcreateWriteStream\b/, /\bmkdirSync\b/,
  /\bos\.remove\b/, /\bos\.unlink\b/, /\bos\.rename\b/, /\bshutil\.\w+/,
  /\bopen\s*\([^)]*,[^)]*['"](w|a|x)/,
  /\bunlink\b/, /\brename\b/, /\brmdir\b/,
  /\bFile::(open|write|unlink|rename)/,
  /\bFile\.write\b/, /\bFile\.delete\b/,
  />\s*[A-Za-z._/-]/,
];

export function bodyHasWriteIntent(body) {
  return WRITE_HINTS.some(re => re.test(body));
}

export function literalsFromProtected(patterns) {
  return patterns.map(p => p.replace(/\*\*?$/, '').replace(/\/\*\*$/, '/'));
}

export function bodyTouchesProtected(body, protectedPatterns) {
  const literals = literalsFromProtected(protectedPatterns);
  return literals.some(lit => lit && body.includes(lit));
}

#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const XSD_INTEGER = 'http://www.w3.org/2001/XMLSchema#integer';
const XSD_DATETIME = 'http://www.w3.org/2001/XMLSchema#dateTime';

const SCHEMA = {
  Collection: 'https://schema.org/Collection',
  DigitalDocument: 'https://schema.org/DigitalDocument',
  CreativeWork: 'https://schema.org/CreativeWork',
  name: 'https://schema.org/name',
  description: 'https://schema.org/description',
  text: 'https://schema.org/text',
  isPartOf: 'https://schema.org/isPartOf',
  position: 'https://schema.org/position',
  dateModified: 'https://schema.org/dateModified',
  dateCreated: 'https://schema.org/dateCreated',
  url: 'https://schema.org/url',
  encodingFormat: 'https://schema.org/encodingFormat',
  wordCount: 'https://schema.org/wordCount',
  numberOfItems: 'https://schema.org/numberOfItems',
};

const DCTERMS_IDENTIFIER = 'http://purl.org/dc/terms/identifier';

function parseArgs(argv) {
  const args = {
    input: 'docs',
    output: 'data/docs-rdf',
    chunkSize: 4000,
    baseUrl: 'https://github.com/OriginTrail/dkg-v9/blob/main/',
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--input') {
      args.input = argv[++i];
    } else if (token === '--output') {
      args.output = argv[++i];
    } else if (token === '--chunk-size') {
      args.chunkSize = Number.parseInt(argv[++i], 10);
    } else if (token === '--base-url') {
      args.baseUrl = argv[++i];
    } else if (token === '--help' || token === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!Number.isFinite(args.chunkSize) || args.chunkSize < 200) {
    throw new Error('--chunk-size must be an integer >= 200');
  }

  return args;
}

function printHelp() {
  console.log('Convert markdown docs into publishable N-Quads.');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/docs-to-rdf.mjs [options]');
  console.log('');
  console.log('Options:');
  console.log('  --input <dir>       Input docs directory (default: docs)');
  console.log('  --output <dir>      Output directory (default: data/docs-rdf)');
  console.log('  --chunk-size <n>    Max chars per text chunk (default: 4000)');
  console.log('  --base-url <url>    Source URL prefix for schema:url');
  console.log('  -h, --help          Show this help');
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function hashHex(input) {
  return createHash('sha256').update(input).digest('hex');
}

function iri(value) {
  return `<${value}>`;
}

function lit(value) {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

function typedLiteral(value, datatypeIri) {
  return `${lit(String(value))}^^${iri(datatypeIri)}`;
}

function triple(subjectIri, predicateIri, objectTerm) {
  return `${iri(subjectIri)} ${iri(predicateIri)} ${objectTerm} .`;
}

function splitIntoChunks(text, maxChars) {
  if (!text) return [];

  const lines = text.split('\n');
  const chunks = [];
  let current = '';

  const flush = () => {
    if (current.length > 0) {
      chunks.push(current);
      current = '';
    }
  };

  for (const line of lines) {
    const candidate = current.length === 0 ? line : `${current}\n${line}`;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    flush();

    if (line.length <= maxChars) {
      current = line;
      continue;
    }

    for (let i = 0; i < line.length; i += maxChars) {
      chunks.push(line.slice(i, i + maxChars));
    }
  }

  flush();
  return chunks;
}

async function walkMarkdownFiles(rootDir) {
  const files = [];

  async function visit(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        files.push(full);
      }
    }
  }

  await visit(rootDir);
  return files;
}

function makeSourceUrl(baseUrl, relPath) {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const encodedPath = relPath.split('/').map((part) => encodeURIComponent(part)).join('/');
  return `${normalizedBase}${encodedPath}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  const inputDir = path.resolve(repoRoot, args.input);
  const outputDir = path.resolve(repoRoot, args.output);

  const docs = await walkMarkdownFiles(inputDir);
  if (docs.length === 0) {
    throw new Error(`No markdown files found in ${inputDir}`);
  }

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  const collectionIri = `urn:dkg:docs:${hashHex(toPosix(path.relative(repoRoot, inputDir)))}`;
  const generatedAt = new Date().toISOString();

  const allLines = [];
  const manifest = {
    generatedAt,
    inputDir: toPosix(path.relative(repoRoot, inputDir)),
    outputDir: toPosix(path.relative(repoRoot, outputDir)),
    collectionIri,
    totalFiles: docs.length,
    totalTriples: 0,
    files: [],
  };

  allLines.push(triple(collectionIri, RDF_TYPE, iri(SCHEMA.Collection)));
  allLines.push(triple(collectionIri, SCHEMA.name, lit('DKG V9 docs collection')));
  allLines.push(triple(collectionIri, SCHEMA.description, lit('RDF export generated from the repository docs folder')));
  allLines.push(triple(collectionIri, SCHEMA.dateCreated, typedLiteral(generatedAt, XSD_DATETIME)));
  allLines.push(triple(collectionIri, SCHEMA.numberOfItems, typedLiteral(docs.length, XSD_INTEGER)));

  for (const filePath of docs) {
    const relPath = toPosix(path.relative(repoRoot, filePath));
    const relFromInput = toPosix(path.relative(inputDir, filePath));
    const docHash = hashHex(relPath);
    const docIri = `urn:dkg:doc:${docHash}`;
    const sourceUrl = makeSourceUrl(args.baseUrl, relPath);
    const stat = await fs.stat(filePath);
    const raw = await fs.readFile(filePath, 'utf8');
    const chunkTexts = splitIntoChunks(raw, args.chunkSize);
    const words = raw.trim().length === 0 ? 0 : raw.trim().split(/\s+/u).length;

    const docLines = [];
    docLines.push(triple(docIri, RDF_TYPE, iri(SCHEMA.DigitalDocument)));
    docLines.push(triple(docIri, SCHEMA.name, lit(path.basename(filePath))));
    docLines.push(triple(docIri, DCTERMS_IDENTIFIER, lit(relPath)));
    docLines.push(triple(docIri, SCHEMA.encodingFormat, lit('text/markdown')));
    docLines.push(triple(docIri, SCHEMA.url, iri(sourceUrl)));
    docLines.push(triple(docIri, SCHEMA.dateModified, typedLiteral(new Date(stat.mtimeMs).toISOString(), XSD_DATETIME)));
    docLines.push(triple(docIri, SCHEMA.wordCount, typedLiteral(words, XSD_INTEGER)));
    docLines.push(triple(docIri, SCHEMA.numberOfItems, typedLiteral(chunkTexts.length, XSD_INTEGER)));
    docLines.push(triple(docIri, SCHEMA.isPartOf, iri(collectionIri)));
    docLines.push(triple(collectionIri, 'https://schema.org/hasPart', iri(docIri)));

    for (let idx = 0; idx < chunkTexts.length; idx++) {
      const chunkNo = idx + 1;
      const chunkIri = `urn:dkg:doc-chunk:${docHash}:${chunkNo}`;
      docLines.push(triple(chunkIri, RDF_TYPE, iri(SCHEMA.CreativeWork)));
      docLines.push(triple(chunkIri, SCHEMA.isPartOf, iri(docIri)));
      docLines.push(triple(chunkIri, SCHEMA.position, typedLiteral(chunkNo, XSD_INTEGER)));
      docLines.push(triple(chunkIri, SCHEMA.text, lit(chunkTexts[idx])));
    }

    const outputFile = path.join(outputDir, relFromInput.replace(/\.md$/i, '.nq'));
    await fs.mkdir(path.dirname(outputFile), { recursive: true });
    await fs.writeFile(outputFile, `${docLines.join('\n')}\n`, 'utf8');

    allLines.push(...docLines);
    manifest.files.push({
      input: relPath,
      output: toPosix(path.relative(repoRoot, outputFile)),
      documentIri: docIri,
      sourceUrl,
      chunks: chunkTexts.length,
      triples: docLines.length,
      bytes: Buffer.byteLength(raw, 'utf8'),
    });
  }

  manifest.totalTriples = allLines.length;

  const bundlePath = path.join(outputDir, 'all-docs.nq');
  const manifestPath = path.join(outputDir, 'manifest.json');
  const readmePath = path.join(outputDir, 'README.md');

  await fs.writeFile(bundlePath, `${allLines.join('\n')}\n`, 'utf8');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  const readme = [
    '# Docs RDF Export',
    '',
    `Generated from: ${manifest.inputDir}`,
    `Files exported: ${manifest.totalFiles}`,
    `Total triples: ${manifest.totalTriples}`,
    '',
    '## Publish to a paranet',
    '',
    'Publish everything in one go:',
    '',
    '```bash',
    'pnpm dkg publish <paranet-id> --file data/docs-rdf/all-docs.nq',
    '```',
    '',
    'Publish one document RDF file:',
    '',
    '```bash',
    'pnpm dkg publish <paranet-id> --file data/docs-rdf/docs/setup/JOIN_TESTNET.nq',
    '```',
    '',
    'See `manifest.json` for the full file map.',
    '',
  ].join('\n');

  await fs.writeFile(readmePath, readme, 'utf8');

  console.log(`Exported ${manifest.totalFiles} markdown files to ${toPosix(path.relative(repoRoot, outputDir))}`);
  console.log(`Total triples: ${manifest.totalTriples}`);
  console.log(`Bundle: ${toPosix(path.relative(repoRoot, bundlePath))}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

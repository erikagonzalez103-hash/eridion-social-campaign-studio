// Read-only deployment preparation. Never uploads a worker.
//
// WHY: a revise sends the previously generated image as `baseUrl`, and the
// worker hands OpenAI that URL to FETCH. OpenAI then fails with "Unable to
// download content from the provided URL before the timeout" -- the first
// generation works, every revision after it does not.
//
// The URL is on pub-<id>.r2.dev, Cloudflare's managed public bucket domain,
// which their own docs describe as for development and not production: it is
// rate limited and throttles with 429. We cannot fix someone else's fetch.
//
// So stop making them fetch. This worker already has the CATALOG binding for
// the very bucket those URLs point at, so for anything on our own bucket it
// reads the bytes DIRECTLY -- no network hop at all -- and inlines them as a
// data URL. Images on other allowlisted hosts are still passed as URLs.
//
// Size is bounded: a 1024x1280 PNG is roughly 900KB, about 1.2MB as base64.
// INLINE_BUDGET caps the total so a base plus five references cannot build a
// request large enough to cause the timeout this is meant to remove. Past the
// budget it falls back to the URL, which is exactly today's behaviour.
const fs = require('node:fs');
const crypto = require('node:crypto');

const source = fs.readFileSync('.image-work/deployed-worker.js', 'utf8');

for (const name of ['handleUpload', 'handleCatalog', 'handleWix', 'handleStudioImageChat', 'studioImagePayload']) {
  if (!source.includes('function ' + name + '(')) throw Error('Expected deployed route missing: ' + name);
}
if (source.includes('studioInlineImage')) throw Error('Inlining is already deployed; reconcile before patching.');

const EDITS = [];

// 1. the helper, inserted just before the payload builder
EDITS.push({
  what: 'add studioInlineImage() + chunked base64',
  from: 'function studioImagePayload(body, env) {',
  to:
`// Bytes read straight from our own R2 binding, so OpenAI never has to fetch
// pub-*.r2.dev -- which is Cloudflare's development domain and rate limited.
const STUDIO_INLINE_BUDGET = 14 * 1024 * 1024;
function studioB64(buf) {
  const bytes = new Uint8Array(buf);
  let out = '';
  // Chunked: String.fromCharCode.apply over ~1MB of arguments blows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(out);
}
async function studioInlineImage(rawUrl, env, budget) {
  const href = studioImageUrl(rawUrl);
  const base = STUDIO_ASSET_BASE + '/';
  if (!href.startsWith(base)) return { part: { type:'input_image', image_url: href }, used: 0 };
  let key;
  try { key = decodeURIComponent(new URL(href).pathname.replace(/^\\//, '')); } catch (e) { key = null; }
  if (!key) return { part: { type:'input_image', image_url: href }, used: 0 };
  let obj = null;
  try { obj = await env.CATALOG.get(key); } catch (e) { obj = null; }
  if (!obj) return { part: { type:'input_image', image_url: href }, used: 0 };
  const size = obj.size || 0;
  const encoded = Math.ceil(size / 3) * 4;
  if (encoded > budget) return { part: { type:'input_image', image_url: href }, used: 0 };
  let buf;
  try { buf = await obj.arrayBuffer(); } catch (e) { return { part: { type:'input_image', image_url: href }, used: 0 }; }
  const ct = (obj.httpMetadata && obj.httpMetadata.contentType) || 'image/png';
  return { part: { type:'input_image', image_url: 'data:' + ct + ';base64,' + studioB64(buf) }, used: encoded };
}

function studioImagePayload(body, env) {`
});

// 2. the builder becomes async and inlines
EDITS.push({
  what: 'make studioImagePayload async and inline our own images',
  from: `  const content = [{ type:'input_text', text:'POST CONTEXT\\n'+context+'\\nBRAND: '+body.voice }];
  if (body.baseUrl && body.action !== 'create') {
    content.push({type:'input_text',text:'BASE IMAGE — this is the selected image to discuss or revise:'},
      {type:'input_image',image_url:studioImageUrl(body.baseUrl)});
  }
  for (const ref of refs) {
    content.push({type:'input_text',text:'STYLE REFERENCE (not the base image): '+String(ref.note || '').slice(0,1000)},
      {type:'input_image',image_url:studioImageUrl(ref.url)});
  }`,
  to: `  const content = [{ type:'input_text', text:'POST CONTEXT\\n'+context+'\\nBRAND: '+body.voice }];
  let budget = STUDIO_INLINE_BUDGET;
  if (body.baseUrl && body.action !== 'create') {
    // The base goes first and gets the budget it needs: a revise is exactly the
    // case that was failing, so this is the one that must not fall back.
    const b = await studioInlineImage(body.baseUrl, env, budget);
    budget -= b.used;
    content.push({type:'input_text',text:'BASE IMAGE — this is the selected image to discuss or revise:'}, b.part);
  }
  for (const ref of refs) {
    const r = await studioInlineImage(ref.url, env, budget);
    budget -= r.used;
    content.push({type:'input_text',text:'STYLE REFERENCE (not the base image): '+String(ref.note || '').slice(0,1000)}, r.part);
  }`
});

EDITS.push({
  what: 'declare studioImagePayload async',
  from: 'function studioImagePayload(body, env) {\n  if (!body || typeof body !== \'object\')',
  to: 'async function studioImagePayload(body, env) {\n  if (!body || typeof body !== \'object\')'
});

EDITS.push({
  what: 'await the payload at its one call site',
  from: '    payload = studioImagePayload(body,env);',
  to: '    payload = await studioImagePayload(body,env);'
});

EDITS.push({
  what: 'bump the revision stamp so the deploy is verifiable',
  from: "const STUDIO_IMAGE_REVISION = '2026-11-13.1';",
  to: "const STUDIO_IMAGE_REVISION = '2026-11-17.1';"
});

let candidate = source;
for (const e of EDITS) {
  const n = candidate.split(e.from).length - 1;
  if (n !== 1) throw Error('Edit "' + e.what + '": found ' + n + ' occurrences, expected exactly 1.');
  candidate = candidate.replace(e.from, e.to);
  console.log('  ok  ' + e.what);
}

// Everything outside the stated edits must be byte-identical.
let check = candidate;
for (let i = EDITS.length - 1; i >= 0; i--) check = check.replace(EDITS[i].to, EDITS[i].from);
if (check !== source) throw Error('Candidate differs from production outside the stated edits. Refusing.');
console.log('  ok  no other byte of the worker changed');

const delta = candidate.length - source.length;
if (Math.abs(delta) > 4000) throw Error('Unexpected size change: ' + delta);

fs.writeFileSync('.image-work/worker-candidate.mjs', candidate);
fs.writeFileSync('.image-work/source-sha256.txt', crypto.createHash('sha256').update(source).digest('hex') + '\n');
console.log('\nPrepared candidate: ' + source.length + ' -> ' + candidate.length + ' bytes (' + (delta >= 0 ? '+' : '') + delta + ').');
console.log('No deployment performed.');

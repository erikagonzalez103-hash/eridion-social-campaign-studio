// Read-only deployment preparation. Never uploads a worker.
const fs = require('node:fs');
const crypto = require('node:crypto');
const source = fs.readFileSync('.image-work/deployed-worker.js','utf8');
for (const name of ['handleUpload','handleCatalog','handleWix']) {
  if (!source.includes('function '+name+'(')) throw Error('Expected deployed route missing: '+name);
}
if (source.includes('handleStudioImageChat')) throw Error('Image chat is already present; reconcile before patching.');
const anchor = "  var apiPath = url.pathname.replace('/api/', '');";
if (source.split(anchor).length !== 2) throw Error('Route anchor is not unique.');
const candidate = source.replace(anchor,anchor+"\n  if (apiPath === 'image-chat') return await handleStudioImageChat(request, env);")+'\n'+fs.readFileSync('backend/image-chat.js','utf8');
fs.writeFileSync('.image-work/worker-candidate.mjs',candidate);
fs.writeFileSync('.image-work/source-sha256.txt',crypto.createHash('sha256').update(source).digest('hex')+'\n');
console.log('Prepared worker candidate from deployed source. No deployment performed.');

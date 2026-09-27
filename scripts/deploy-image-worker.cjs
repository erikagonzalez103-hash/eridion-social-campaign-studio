// Production deployment. Run only after explicit user approval and current tests.
const fs=require('node:fs'),crypto=require('node:crypto');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
async function main(){
  if(!process.argv.includes('--approved'))throw Error('Explicit deployment approval required.');
  const headers={Authorization:'Bearer '+(process.env.CLOUDFLARE_API_TOKEN||fs.readFileSync('../.cf-token','utf8')).trim()};
  const accounts=await(await fetch('https://api.cloudflare.com/client/v4/accounts',{headers})).json();
  const account=process.env.CLOUDFLARE_ACCOUNT_ID||(accounts.result?.length===1?accounts.result[0].id:null);
  if(!account)throw Error('Cloudflare account is ambiguous.');
  const base='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/frosty-base-f01e';
  const sourceResponse=await fetch(base,{headers});if(!sourceResponse.ok)throw Error('Cannot read current production source.');
  const parts=await sourceResponse.formData(),part=parts.get('worker.js');
  const source=typeof part==='string'?part:await part.text();
  if(hash(source)!==fs.readFileSync('.image-work/source-sha256.txt','utf8').trim())throw Error('Production changed after preparation. Reconcile before deploying.');
  const settingsResponse=await(await fetch(base+'/settings',{headers})).json();
  if(!settingsResponse.success)throw Error('Cannot read settings.');
  const settings=settingsResponse.result;
  const metadata={main_module:'worker.js',bindings:settings.bindings.filter(b=>b.type!=='secret_text'),keep_bindings:['secret_text']};
  for(const key of ['compatibility_date','compatibility_flags','usage_model','tags','tail_consumers','logpush','observability'])if(settings[key]!==undefined)metadata[key]=settings[key];
  if(settings.placement?.mode)metadata.placement=settings.placement;
  fs.writeFileSync('.image-work/rollback-worker.js',source);
  fs.writeFileSync('.image-work/rollback-settings.json',JSON.stringify(settings));
  const form=new FormData();form.set('metadata',JSON.stringify(metadata));
  const candidate=fs.readFileSync('.image-work/worker-candidate.mjs','utf8');
  form.set('worker.js',new Blob([candidate],{type:'application/javascript+module'}),'worker.js');
  const response=await fetch(base,{method:'PUT',headers,body:form});const result=await response.json();
  if(!result.success)throw Error('Deployment failed: '+JSON.stringify(result.errors));
  const after=await(await fetch(base+'/settings',{headers})).json();
  const signature=bs=>JSON.stringify(bs.map(b=>[b.name,b.type]).sort());
  if(signature(after.result.bindings)!==signature(settings.bindings))throw Error('Worker deployed, but binding verification needs attention.');
  fs.writeFileSync('.image-work/deployment-result.json',JSON.stringify({at:new Date().toISOString(),candidateHash:hash(candidate),version:result.result?.deployment_id||result.result?.etag,bindingNamesPreserved:true}));
  console.log('Image service deployed; existing binding names and types preserved.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});

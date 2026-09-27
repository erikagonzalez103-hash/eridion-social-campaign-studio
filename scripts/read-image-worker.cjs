// Read-only Cloudflare snapshot. Never deploys or prints credential values.
const fs=require('node:fs');
async function main(){
  const token=(process.env.CLOUDFLARE_API_TOKEN||fs.readFileSync('../.cf-token','utf8')).trim();
  const headers={Authorization:'Bearer '+token};
  const accountsResponse=await fetch('https://api.cloudflare.com/client/v4/accounts',{headers});
  const accounts=await accountsResponse.json();
  if(!accounts.success)throw Error('Could not list Cloudflare accounts (HTTP '+accountsResponse.status+').');
  const account=process.env.CLOUDFLARE_ACCOUNT_ID||(accounts.result.length===1?accounts.result[0].id:null);
  if(!account)throw Error('Set CLOUDFLARE_ACCOUNT_ID to the account containing frosty-base-f01e.');
  const base='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/frosty-base-f01e';
  const response=await fetch(base,{headers});
  if(!response.ok)throw Error('Worker source read failed (HTTP '+response.status+').');
  const parts=await response.formData();
  const worker=parts.get('worker.js');
  if(!worker||(typeof worker!=='string'&&typeof worker.text!=='function'))throw Error('Expected worker.js module missing.');
  const source=typeof worker==='string'?worker:await worker.text();
  const settingsResponse=await fetch(base+'/settings',{headers});
  const settings=await settingsResponse.json();
  if(!settings.success)throw Error('Worker settings read failed.');
  fs.mkdirSync('.image-work',{recursive:true});
  fs.writeFileSync('.image-work/deployed-worker.js',source);
  fs.writeFileSync('.image-work/worker-settings.json',JSON.stringify(settings.result,null,2));
  console.log('Saved current deployed source and settings in ignored .image-work/. No production changes.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});

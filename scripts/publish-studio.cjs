// GitHub API release path when local Git metadata is read-only.
// Token is supplied in process memory by the existing Git credential helper.
const fs=require('node:fs');
async function main(){
  if(!process.argv.includes('--approved'))throw Error('Explicit release approval required.');
  const token=process.env.STUDIO_DEPLOY_GITHUB_TOKEN;
  if(!token)throw Error('GitHub credential unavailable.');
  const root='https://api.github.com/repos/erikagonzalez103-hash/eridion-social-campaign-studio';
  async function api(path,method='GET',body){const r=await fetch(root+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok)throw Error('GitHub '+r.status+': '+d.message);return d;}
  const ref=await api('/git/ref/heads/main');
  const expected=process.env.STUDIO_EXPECTED_MAIN;
  if(!expected||ref.object.sha!==expected)throw Error('Remote main changed; reconcile before publishing.');
  const head=await api('/git/commits/'+expected);
  const files=['index.html','.gitignore','backend/image-chat.js','scripts/read-image-worker.cjs','scripts/prepare-image-worker.cjs','scripts/deploy-image-worker.cjs','scripts/preview-image-chat.cjs','scripts/publish-studio.cjs','tests/image-chat.test.cjs','IMAGE-CHAT-HANDOFF.md'];
  const tree=[];
  for(const path of files){const blob=await api('/git/blobs','POST',{content:fs.readFileSync(path).toString('base64'),encoding:'base64'});tree.push({path,mode:'100644',type:'blob',sha:blob.sha});}
  const createdTree=await api('/git/trees','POST',{base_tree:head.tree.sha,tree});
  const commit=await api('/git/commits','POST',{message:'Add post-led conversational image creation and revision',tree:createdTree.sha,parents:[expected]});
  await api('/git/refs/heads/main','PATCH',{sha:commit.sha,force:false});
  fs.writeFileSync('.image-work/frontend-release.json',JSON.stringify({sha:commit.sha,url:commit.html_url,at:new Date().toISOString()}));
  console.log('Studio release published: '+commit.sha);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});

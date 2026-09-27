const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const backend = fs.readFileSync('backend/image-chat.js','utf8');
const html = fs.readFileSync('index.html','utf8');
const frontend = html.slice(html.indexOf("const IMAGE_GUIDANCE_KEY="),html.lastIndexOf('</script>'));
const asset = 'https://pub-17160ed212d74341a64e62d4f71d7c34.r2.dev/original.png';
const body = (extra={})=>({requestId:webcrypto.randomUUID(),voice:'quinta',action:'create',message:'Create one photo.',size:'1024x1280',history:[],references:[],context:{sourceBlog:'The payoff is unclear.'},...extra});
function server(fetchImpl) {
  const saved = new Map(),assets=new Map();
  const env = {OPENAI_API_KEY:'test-only',ERIDION_KV:{get:async k=>saved.has(k)?JSON.parse(saved.get(k)):null,put:async(k,v)=>saved.set(k,v)},CATALOG:{put:async(k,v)=>assets.set(k,v)}};
  const ctx = vm.createContext({URL,Response,Request,Uint8Array,atob,AbortSignal,fetch:fetchImpl,json:(v,status=200)=>new Response(JSON.stringify(v),{status}),console});
  vm.runInContext(backend,ctx);
  return {env,ctx,saved,assets};
}
function ui() {
  const data = new Map(),els=new Map();let fail=false;
  const el=id=>{if(!els.has(id))els.set(id,{value:'',textContent:'',innerHTML:'',checked:false,disabled:false,hidden:false});return els.get(id);};
  const library=[{id:'q-blog',voice:'quinta',title:'Investing in ourselves',blog_text:'Original central payoff',blogUrl:'https://quintaand.co/blog/invest',imageCampaignGuidance:{quinta:'Campaign correction'}},
    {id:'q-post',parent_id:'q-blog',voice:'quinta',linkedin_text:'Caption',status:'scheduled',scheduled_for:'2026-10-01',imageUrls:[asset,asset+'?slide=2'],imageSource:'upload',imageChat:{turns:[],versions:[{id:'original',url:asset,label:'Original 1'},{id:'new',url:asset+'?new=1',label:'Version 1',parentId:'original'}],activeId:'new',pending:null,undo:[]}},
    {id:'e-post',voice:'eridion',linkedin_text:'Eridion caption'}];
  const ctx = vm.createContext({library,LIB_KEY:'library',localStorage:{getItem:k=>data.get(k)||null,setItem:(k,v)=>{if(fail)throw Error('Quota exceeded');data.set(k,v);}},
    document:{getElementById:el,createElement:()=>({set innerHTML(v){this.textContent=v.replace(/<[^>]*>/g,'');}})},
    crypto:webcrypto,URL,Date,AbortSignal,BRAND_IMAGE_BRIEFS:{quinta:'cream sage',eridion:'navy architectural'},getKB:v=>v+' facts',getBrandRefs:()=>[],
    getItemImageUrls:it=>(it.imageUrls||[]).slice(),escapeHTML:s=>s,renderLibrary(){},renderCalendar(){},refreshAllOpenImagePickers(){},kbBrandLabel:v=>v,WORKER:'https://example.com/api/messages',console});
  vm.runInContext(frontend,ctx);vm.runInContext("imageChatPostId='q-post'",ctx);
  return {ctx,library,data,el,setQuotaFailure:v=>{fail=v;}};
}
test('all inline scripts and candidate backend parse',()=>{
  for(const s of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(s[1]);
  new vm.Script(backend);
});
test('create and edit carry references; edits use selected image and requested dimensions',()=>{
  const {ctx,env}=server();
  const p=ctx.studioImagePayload(body({action:'revise',baseUrl:asset,references:[{url:asset+'?ref',note:'Keep the spacing'}],history:[{role:'user',text:'Remove the footer.'},{role:'assistant',text:'Reflowed.'}]}),env);
  assert.equal(p.tools[0].action,'edit');assert.equal(p.tools[0].size,'1024x1280');assert.equal(p.store,false);
  assert.equal(p.input[0].content.filter(c=>c.type==='input_image').length,2);
  assert.match(p.input[1].content,/Remove the footer/);
  const create=ctx.studioImagePayload(body({baseUrl:asset}),env);
  assert.equal(create.input[0].content.filter(c=>c.type==='input_image').length,0);
});
test('discussion cannot generate; invalid inputs/private image hosts rejected',()=>{
  const {ctx,env}=server();assert.equal(ctx.studioImagePayload(body({action:'discuss'}),env).tools,undefined);
  for(const patch of [{voice:'other'},{size:'1x1'},{action:'revise'},{message:''},{references:[{url:'http://127.0.0.1/secret'}]},{references:[{url:'https://evil.example/image.png'}]}])assert.throws(()=>ctx.studioImagePayload(body(patch),env));
});
test('worker stores images in R2 and recovers completed request without a second paid call',async()=>{
  let calls=0;const s=server(async()=>{calls++;return Response.json({status:'completed',output:[{type:'image_generation_call',result:btoa('test image bytes'),revised_prompt:'Exact prompt'}]});});
  const b=body();const request=()=>new Request('https://worker/api/image-chat',{method:'POST',body:JSON.stringify(b)});
  const first=await(await s.ctx.handleStudioImageChat(request(),s.env)).json();
  assert.equal(first.status,'completed');assert.match(first.images[0].url,/studio-images\/quinta\//);assert.equal(s.assets.size,1);
  const second=await(await s.ctx.handleStudioImageChat(request(),s.env)).json();assert.equal(second.images[0].url,first.images[0].url);assert.equal(calls,1);
  const recovery=await(await s.ctx.handleStudioImageChat(new Request('https://worker/api/image-chat?requestId='+b.requestId),s.env)).json();assert.equal(recovery.status,'completed');
});
test('worker records provider failures and rejects foreign browser origins',async()=>{
  const s=server(async()=>Response.json({error:{message:'Model unavailable'}},{status:400}));
  const b=body();const r=await s.ctx.handleStudioImageChat(new Request('https://worker/api/image-chat',{method:'POST',body:JSON.stringify(b)}),s.env);
  assert.equal(r.status,502);assert.equal((await r.json()).status,'failed');
  assert.equal((await s.ctx.handleStudioImageChat(new Request('https://worker/api/image-chat',{headers:{Origin:'https://evil.example'}}),s.env)).status,403);
});
test('source payoff and campaign guidance follow the post; brands stay separate',()=>{
  const u=ui();u.data.set('eridion_image_guidance_v1',JSON.stringify({quinta:'Real imperfect people'}));
  const q=u.ctx.imageChatContext(u.library[1]),e=u.ctx.imageChatContext(u.library[2]);
  assert.equal(q.sourceBlog,'Original central payoff');assert.equal(q.sourceBlogUrl,'https://quintaand.co/blog/invest');assert.equal(q.campaignGuidance,'Campaign correction');assert.equal(q.brandGuidance,'Real imperfect people');
  assert.equal(e.brandGuidance,'');assert.equal(e.campaignGuidance,'');assert.equal(e.brandBrief,'navy architectural');
});
test('choosing a revision replaces only its slot; undo preserves carousel, copy and schedule',()=>{
  const u=ui(),before=JSON.stringify(u.library[1]);u.el('ic-reviewed').checked=true;u.el('ic-slot').value='1';u.ctx.imageChatUse();
  assert.equal(u.library[1].imageUrls[0],asset);assert.equal(u.library[1].imageUrls[1],asset+'?new=1');assert.equal(u.library[1].status,'scheduled');
  u.ctx.imageChatUndo();assert.deepEqual(Array.from(u.library[1].imageUrls),JSON.parse(before).imageUrls);assert.equal(u.library[1].linkedin_text,'Caption');assert.equal(u.library[1].scheduled_for,'2026-10-01');
});
test('quota failure does not mutate saved content or pretend a result was saved',()=>{
  const u=ui(),before=JSON.stringify(u.library);u.setQuotaFailure(true);assert.throws(()=>u.ctx.imageChatCommit('q-post',it=>{it.linkedin_text='Bad mutation';}));assert.equal(JSON.stringify(u.library),before);
});
test('writes preserve unrelated changes from other tabs and reject changes to this post',()=>{
  const u=ui(),stored=JSON.parse(JSON.stringify(u.library));stored[2].linkedin_text='Updated in another tab';u.data.set('library',JSON.stringify(stored));
  u.ctx.imageChatCommit('q-post',it=>{it.imageChat.activeId='original';});
  assert.equal(JSON.parse(u.data.get('library'))[2].linkedin_text,'Updated in another tab');
  const changed=JSON.parse(u.data.get('library'));changed[1].linkedin_text='Edited elsewhere';u.data.set('library',JSON.stringify(changed));
  assert.throws(()=>u.ctx.imageChatCommit('q-post',it=>{it.imageChat.activeId='new';}),/another tab/);
  assert.equal(JSON.parse(u.data.get('library'))[1].linkedin_text,'Edited elsewhere');
});
test('returned version records parent and conversation without auto-attaching',()=>{
  const u=ui(),it=u.library[1],urls=it.imageUrls.slice();it.imageChat.pending={message:'Remove the footer',action:'revise',baseId:'original',requestId:'request'};
  u.ctx.imageChatAccept('q-post',{status:'completed',text:'Reflowed.',images:[{url:asset+'?revision',size:'1024x1280'}]});
  assert.deepEqual(Array.from(it.imageUrls),urls);assert.equal(it.imageChat.versions.at(-1).parentId,'original');assert.equal(it.imageChat.turns.length,2);assert.equal(it.imageChat.pending,null);
});
test('initial idea and conversational refinement are saved without touching post or images',()=>{
  const u=ui(),it=u.library[1],before=it.linkedin_text,key=u.ctx.imageChatSuggestionKey(it);
  it.imageChat.pending={action:'discuss',kind:'suggestion',message:'Internal suggestion request',suggestionKey:key};
  u.ctx.imageChatAccept('q-post',{status:'completed',text:'A restrained photo of a founder reviewing two options.',images:[]});
  assert.equal(it.imageChat.suggestionKey,key);assert.match(it.imageChat.suggestion,/restrained photo/);assert.equal(it.imageChat.turns[0].displayText,'Suggest a visual direction for this post.');
  const state=JSON.parse(u.data.get('library'));state[1].imageChat.pending={action:'discuss',message:'Try a quote card.',suggestionKey:key};u.data.set('library',JSON.stringify(state));Object.assign(it,state[1]);
  u.ctx.imageChatAccept('q-post',{status:'completed',text:'A cream quote card with one clear line.',images:[]});
  assert.match(it.imageChat.suggestion,/quote card/);assert.equal(it.linkedin_text,before);assert.equal(it.imageUrls.length,2);
  it.linkedin_text='Changed caption';assert.notEqual(u.ctx.imageChatSuggestionKey(it),key);
});

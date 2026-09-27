// Local test server. Uses an exported COPY of the Library and a simulated API.
// Never calls OpenAI, publishes, or reads API credentials.
const fs=require('node:fs');
const http=require('node:http');
const library=JSON.parse(fs.readFileSync('.image-work/library-backup.json','utf8'));
const replies=new Map();
const origin='http://127.0.0.1:5587';
const source=library.find(x=>x.voice==='quinta'&&!x.parent_id&&x.blog_text);
const group=library.filter(x=>x.id===source.id||x.parent_id===source.id);
const eridion=library.filter(x=>x.voice==='eridion').slice(0,6);
const fixture=JSON.stringify([...group,...eridion]).replace(/</g,'\\u003c');
const image=source.selectedImageUrl||source.imageUrls?.[0];
http.createServer(async(req,res)=>{
  const url=new URL(req.url,origin);
  const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  if(url.pathname==='/api/image-chat'){
    if(req.method==='GET')return json(url.searchParams.has('requestId')?(replies.get(url.searchParams.get('requestId'))||{status:'unknown'}):{ready:true,revision:'2026-09-27.1'});
    let raw='';for await(const part of req)raw+=part;
    const b=JSON.parse(raw);fs.writeFileSync('.image-work/last-preview-request.json',JSON.stringify(b,null,2));
    const reply={status:'completed',requestId:b.requestId,text:b.action==='discuss'?'TEST RESPONSE — The source payoff is the unclear return on investing in the business. A restrained photo or short quote can support that; keep the CTA on the original blog.':'TEST RESPONSE — This is the existing source image reused to test version controls. No new image was generated.',images:b.action==='discuss'?[]:[{url:image,size:b.size,revisedPrompt:'Simulated preview only'}]};
    replies.set(b.requestId,reply);return json(reply);
  }
  if(url.pathname.startsWith('/api/'))return json({error:'Other APIs are disabled in the local image preview.'},503);
  if(url.pathname!=='/') {res.writeHead(404);return res.end();}
  const bootstrap=`<script>if(!localStorage.getItem('studio_image_preview_seeded')){if(localStorage.getItem('eridion_studio_library'))throw Error('Existing local library found. Preview will not overwrite it.');localStorage.setItem('eridion_studio_library',JSON.stringify(${fixture}));localStorage.setItem('studio_image_preview_seeded','1');}</script>`;
  let html=fs.readFileSync('index.html','utf8').replace("const WORKER = 'https://frosty-base-f01e.erikagonzalez103.workers.dev/api/messages';",`const WORKER = '${origin}/api/messages';`);
  html=html.replace('</head>',bootstrap+'</head>').replace('<body>','<body><div style="background:#fff1c7;color:#493c17;padding:8px;text-align:center;font:13px sans-serif">Local test copy · simulated image API · no live generation or publishing</div>');
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);
}).listen(5587,'127.0.0.1',()=>console.log('Local test preview: '+origin));

const fs=require('fs');
const dir='apps/web/src/lib/endpoints';
const files=fs.readdirSync(dir).filter(f=>f.endsWith('.ts')&&f!=='index.ts');
const segs={};
const paths=[];
for(const f of files){
  const txt=fs.readFileSync(dir+'/'+f,'utf8');
  txt.split('\n').forEach((line,i)=>{
    if(/^\s*(\/\/|\*)/.test(line)) return;
    const re=/[`'"](\/[A-Za-z0-9_\-\/\$\{\}\.\?=&:%]*)[`'"]/g;let m;
    while((m=re.exec(line))){
      const p=m[1];
      if(p.length<2) continue;
      const seg=p.split('/').filter(Boolean)[0];
      if(!seg||seg.includes('$')) continue;
      paths.push({file:f,line:i+1,path:p,seg});
      segs[seg]=(segs[seg]||0)+1;
    }
  });
}
console.log(Object.entries(segs).sort().map(([k,v])=>k+' '+v).join('\n'));
fs.writeFileSync('.audit_tmp/paths.json',JSON.stringify(paths,null,1));
console.log('total',paths.length);

const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
test('shares simultaneous reads, clones bodies, never caches server failures',async()=>{
  let calls=0;
  const window={fetch:async()=>{calls++;return new Response(JSON.stringify({calls}),{status:calls===2?502:200,headers:{'content-type':'application/json'}})}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/data-client.js'),'utf8'),{window,URL,location:{href:'https://test.invalid/',origin:'https://test.invalid'}});
  const [a,b]=await Promise.all([window.fetch('/api/test?_=1'),window.fetch('/api/test?_=2')]);
  assert.equal(calls,1);assert.deepEqual(await a.json(),await b.json());
  await window.fetch('/api/test');assert.equal(calls,1);
  window.t360ClearRequestCache();assert.equal((await window.fetch('/api/test')).status,502);
  assert.equal((await window.fetch('/api/test')).status,200);assert.equal(calls,3);
});

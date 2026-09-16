const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixturesInRange}=require('../lib/fixtures');
test('falls back across month boundaries and deduplicates events',async()=>{
  const calls=[];
  const result=await fixturesInRange('20260831','20260902',async dates=>{
    calls.push(dates);
    if(dates.includes('-'))throw Error('HTTP 400');
    return {events:[{id:dates},{id:'shared'}]};
  });
  assert.deepEqual(calls,['20260831-20260902','20260831','20260901','20260902']);
  assert.equal(result.length,4);
});
test('failed day is an error, never a misleading empty or partial schedule',async()=>{
  await assert.rejects(fixturesInRange('20260901','20260902',async dates=>{
    if(dates.includes('-')||dates==='20260902')throw Error('offline');
    return {events:[]};
  }),/offline/);
});

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {appStandings, appStat} = require('../lib/standings');
const stats = Object.entries({gamesPlayed:5,losses:0,pointDifferential:7,points:13,pointsAgainst:6,pointsFor:13,ties:1,wins:4,rank:1}).map(([name,value])=>({name,value}));
test('points, rank and results do not collide with partial names',()=>{
  const rows=appStandings({children:[{standings:{entries:[{team:{id:'432',displayName:'Galatasaray'},stats}]}}]},'tur.1');
  assert.deepEqual([rows[0].rank,rows[0].played,rows[0].wins,rows[0].draws,rows[0].losses,rows[0].gf,rows[0].ga,rows[0].gd,rows[0].points],[1,5,4,1,0,13,6,7,13]);
  assert.equal(rows[0].played,rows[0].wins+rows[0].draws+rows[0].losses);
});
test('missing data remains unknown, exact aliases support zero and ordering',()=>{
  assert.equal(appStat({stats:[{name:'gamesPlayed',abbreviation:'GP',value:5}]},['p']),null);
  const rows=appStandings([{team:{id:'b'},stats:[{name:'rank',value:2}]},{team:{id:'a'},stats:[{name:'rank',value:1},{abbreviation:'W',value:0}]}],'eng.1');
  assert.equal(rows[0].teamId,'a'); assert.equal(rows[0].wins,0); assert.equal(rows[1].points,null);
});

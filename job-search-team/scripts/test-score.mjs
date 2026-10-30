import test from 'node:test';
import assert from 'node:assert/strict';
import { score, anonymousWeights } from './score.mjs';
const weights={match:30,growth:10,salary_cost:20,work_reviews:15,industry_reputation:25};
test('complete score',()=>assert.equal(score(weights,Object.fromEntries(Object.keys(weights).map(k=>[k,4]))).score_total,80));
test('unknown stays unknown without normalization',()=>{
  const result=score(weights,{match:4,growth:4,salary_cost:4,industry_reputation:4});
  assert.equal(result.score_total,null); assert.deepEqual(result.possible_range,[68,83]);
});
test('zero weight does not block',()=>assert.equal(score({match:100,work_reviews:0},{match:3}).score_total,60));
test('anonymous uses current weights',()=>assert.deepEqual(anonymousWeights({match:20,growth:20,salary_cost:40}),{match:25,growth:25,salary_cost:50}));
test('anonymous unknown stays unknown',()=>assert.equal(score(anonymousWeights(weights),{match:5,growth:5}).score_total,null));
test('invalid weights rejected',()=>{
  for(const w of [{match:99},{match:-1,growth:101},{match:NaN},{match:true}]) assert.throws(()=>score(w,{}));
  assert.throws(()=>anonymousWeights({match:0,growth:0,salary_cost:0}));
});
test('invalid ratings rejected',()=>{for(const rating of [6,-1,true,NaN,1.2]) assert.throws(()=>score({match:100},{match:rating}));});

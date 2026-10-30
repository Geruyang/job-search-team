import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const valid = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const round = v => Math.round(v * 1e6) / 1e6;
export function score(weights, ratings) {
  if (!object(weights) || !Object.keys(weights).length || !Object.values(weights).every(valid)) throw new Error('Weights must be finite nonnegative numbers');
  if (!object(ratings)) throw new Error('Ratings must be an object');
  if (Math.abs(Object.values(weights).reduce((a,b) => a+b, 0)-100) > 1e-6) throw new Error('Weights must sum to 100; confirm changes with the user');
  let known=0, unknown=0;
  const details = Object.create(null);
  for (const [key, weight] of Object.entries(weights)) {
    const rating = ratings[key] ?? null;
    if (weight===0) { details[key]={weight:0,rating:null,points:null,applicability:'not_applicable'}; continue; }
    let points=null;
    if (rating===null) unknown+=weight;
    else {
      if (!valid(rating) || rating>5 || !Number.isInteger(rating*2)) throw new Error(`${key}: rating must be 0..5 in 0.5 steps or null`);
      points=weight*rating/5; known+=points;
    }
    details[key]={weight,rating,points};
  }
  return {score_total:unknown===0?round(known):null,known_points:round(known),unknown_weight:round(unknown),possible_range:[round(known),round(known+unknown)],dimensions:details};
}
export function anonymousWeights(weights) {
  const keys=['match','growth','salary_cost'];
  if (!object(weights) || !keys.every(k => valid(weights[k]))) throw new Error('Anonymous dimensions need nonnegative weights');
  const total=keys.reduce((sum,k)=>sum+weights[k],0);
  if (!(total>0) || !Number.isFinite(total)) throw new Error('Anonymous dimensions need a positive finite sum');
  return Object.fromEntries(keys.map(k=>[k,100*weights[k]/total]));
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args=process.argv.slice(2);
    if (args.length<1 || args.length>2 || (args.length===2 && args[1]!=='--anonymous')) throw new Error('Usage: node score.mjs INPUT.json [--anonymous]');
    const data=JSON.parse((await readFile(args[0],'utf8')).replace(/^\uFEFF/,''));
    console.log(JSON.stringify(score(args[1]?anonymousWeights(data.weights):data.weights,data.ratings),null,2));
  } catch(error) { console.error(error.message); process.exitCode=1; }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {planReview} from './plan-attitude-review.mjs';

const now='2026-11-04T18:00:00+08:00';
const make=()=>({tracking_started_at:'2026-10-01T00:00:00+08:00',outreach_events:[],jobs:[],completed_review_boundaries:[]});
const event=(n,over={})=>({event_id:'e'+n,platform:'boss',opportunity_key:'job'+n,actor:'agent',kind:'greeting',outcome:'confirmed',at:'2026-11-04T10:00:00+08:00',receipt_ref:'local-receipt.json',...over});
const job=(id,first,over={})=>({platform:'boss',opportunity_key:id,first_outreach_at:first,attitude:'unknown',read_state:'unread',hr_has_replied:false,...over});
test('19 does not trigger; successful greeting number 20 triggers',()=>{
  const s=make();s.outreach_events=Array.from({length:19},(_,i)=>event(i));assert.equal(planReview(s,now).review_due,false);
  s.outreach_events.push(event(19));assert.deepEqual(planReview(s,now).pending_review_boundaries,[20]);
});
test('same job greeting/intro/CV counts once; cross-platform counts twice',()=>{
  const s=make();s.outreach_events=[event(1),event(2,{opportunity_key:'job1',kind:'full_introduction'}),event(3,{opportunity_key:'job1',kind:'resume_submission'}),event(4,{platform:'liepin',opportunity_key:'job1'})];assert.equal(planReview(s,now).contacted_jobs,2);
});
test('unknown, failure, ACK, manual and missing receipt do not count',()=>{
  const s=make();s.outreach_events=[event(1,{outcome:'unknown'}),event(2,{outcome:'failed'}),event(3,{outcome:'dispatch_ack'}),event(4,{actor:'user'}),event(5,{receipt_ref:null})];assert.equal(planReview(s,now).contacted_jobs,0);
});
test('3/7 day boundaries are strict; read and no HR reply both required',()=>{
  const s=make();s.outreach_events=Array.from({length:20},(_,i)=>event(i));
  s.jobs=[job('exact3','2026-11-01T18:00:00+08:00',{read_state:'read'}),job('over3','2026-11-01T17:59:59+08:00',{read_state:'read'}),job('over3unread','2026-11-01T17:00:00+08:00'),job('replied','2026-11-01T17:00:00+08:00',{read_state:'read',hr_has_replied:true,attitude:'neutral'}),job('exact7','2026-10-28T18:00:00+08:00'),job('over7','2026-10-28T17:59:59+08:00')];
  const p=planReview(s,now);assert.deepEqual(p.retire_from_periodic_review.map(j=>j.opportunity_key),['over3','over7']);assert.deepEqual(p.jobs_to_review.map(j=>j.opportunity_key),['exact3','over3unread','replied','exact7']);
});
test('completed cursor persists; multiple crossed boundaries coalesce; plan never mutates',()=>{
  const s=make();s.outreach_events=Array.from({length:60},(_,i)=>event(i));s.completed_review_boundaries=[20];const before=JSON.stringify(s);const p=planReview(s,now);assert.deepEqual(p.pending_review_boundaries,[40,60]);assert.equal(JSON.stringify(s),before);
});
test('unknown timestamps remain pending; known interested and rejected not reviewed',()=>{
  const s=make();s.outreach_events=Array.from({length:20},(_,i)=>event(i));s.jobs=[job('unknown',null,{hr_has_replied:null,read_state:'unknown'}),job('yes',null,{attitude:'interested'}),job('no',null,{attitude:'not_interested'})];const p=planReview(s,now);assert.equal(p.jobs_to_review.length,1);assert.equal(p.jobs_to_review[0].review_reason,'first_outreach_time_unknown');assert.equal(p.new_inbound_always_processed,true);
});
test('duplicate event is idempotent; conflicting event and duplicate jobs fail',()=>{
  const s=make();s.outreach_events=[event(1),event(1)];assert.equal(planReview(s,now).contacted_jobs,1);s.outreach_events.push(event(1,{platform:'liepin'}));assert.throws(()=>planReview(s,now),/Conflicting/);const j=make();j.jobs=[job('x',null),job('x',null)];assert.throws(()=>planReview(j,now),/Duplicate job/);
});
test('valid timezone and baseline required; future/old events excluded',()=>{
  const s=make();assert.throws(()=>planReview({...s,tracking_started_at:null},now),/tracking_started/);assert.throws(()=>planReview(s,'2026-11-04T18:00:00'),/timezone/);s.outreach_events=[event(1,{at:'2026-11-05T10:00:00+08:00'}),event(2,{at:'2026-09-30T10:00:00+08:00'})];assert.equal(planReview(s,now).contacted_jobs,0);
});

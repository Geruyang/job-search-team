import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const DAY=86400000;
const stamp=v=>typeof v==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v))?Date.parse(v):null;
const key=r=>{
  if(typeof r.platform!=='string'||!r.platform||typeof r.opportunity_key!=='string'||!r.opportunity_key)throw Error('platform/opportunity_key required');
  return JSON.stringify([r.platform,r.opportunity_key]);
};

export function planReview(state,now=new Date().toISOString()){
  const t=stamp(now);if(t===null)throw Error('now must be an ISO timestamp with timezone');
  const epoch=stamp(state.tracking_started_at);
  if(epoch===null||epoch>t)throw Error('tracking_started_at must be a valid nonfuture ISO timestamp with timezone');
  if(!Array.isArray(state.outreach_events)||!Array.isArray(state.jobs)||!Array.isArray(state.completed_review_boundaries))throw Error('tracking arrays required');
  const kinds=new Set(['greeting','full_introduction','resume_submission']);
  const ids=new Map(),success=new Map(),warnings=[];
  for(const e of state.outreach_events){
    if(typeof e.event_id!=='string'||!e.event_id)throw Error('Stable event_id required');
    if(ids.has(e.event_id)){
      if(JSON.stringify(ids.get(e.event_id))!==JSON.stringify(e))throw Error('Conflicting duplicate event_id: '+e.event_id);
      continue;
    }
    ids.set(e.event_id,e);
    if(e.outcome!=='confirmed'||!kinds.has(e.kind)||e.actor!=='agent')continue;
    const et=stamp(e.at);
    if(et===null||et>t){warnings.push({event_id:e.event_id,reason:'invalid_or_future_event_time'});continue;}
    if(et<epoch)continue;
    if(!e.receipt_ref){warnings.push({event_id:e.event_id,reason:'missing_receipt_reference'});continue;}
    const k=key(e);const old=success.get(k);
    if(!old||et<Date.parse(old.at))success.set(k,e);
  }
  const completed=new Set(state.completed_review_boundaries);
  for(const b of completed)if(!Number.isInteger(b)||b<20||b%20!==0)throw Error('Review boundaries must be positive multiples of 20');
  const pending=[];for(let n=20;n<=success.size;n+=20)if(!completed.has(n))pending.push(n);
  const eligible=[],retired=[],notPending=[];
  const jobKeys=new Set();
  for(const j of state.jobs){
    const k=key(j);if(jobKeys.has(k))throw Error('Duplicate job; reconcile same-platform aliases first: '+k);jobKeys.add(k);
    if(!['unknown','neutral','possible_interest'].includes(j.attitude)){notPending.push({platform:j.platform,opportunity_key:j.opportunity_key,reason:'attitude_already_known_or_unclassified'});continue;}
    const first=stamp(j.first_outreach_at);
    if(first!==null&&first>t){warnings.push({job_key:k,reason:'future_first_outreach_time'});eligible.push({...j,review_reason:'first_outreach_time_unreliable'});continue;}
    const age=first===null?null:t-first;
    const row={...j,age_hours:age===null?null:age/3600000};
    if(age!==null&&age>7*DAY)retired.push({...row,review_reason:'over_7d'});
    else if(age!==null&&age>3*DAY&&j.read_state==='read'&&j.hr_has_replied===false)retired.push({...row,review_reason:'read_no_reply_over_3d'});
    else eligible.push({...row,review_reason:first===null?'first_outreach_time_unknown':'pending_attitude_within_window'});
  }
  return {planned_at:now,tracking_started_at:state.tracking_started_at,contacted_jobs:success.size,next_boundary:(Math.floor(success.size/20)+1)*20,pending_review_boundaries:pending,review_due:pending.length>0,jobs_to_review:pending.length?eligible:[],eligible_waiting_for_boundary:pending.length?[]:eligible,retire_from_periodic_review:retired,known_attitudes_not_in_review:notPending,warnings,read_only_plan:true,new_inbound_always_processed:true};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2);
    if(args.length!==1&&!(args.length===3&&args[1]==='--now'))throw Error('Usage: node plan-attitude-review.mjs tracking.json [--now ISO_WITH_TIMEZONE]');
    console.log(JSON.stringify(planReview(JSON.parse(fs.readFileSync(args[0],'utf8')),args[2]),null,2));
  }catch(e){console.error(e.message);process.exitCode=1;}
}

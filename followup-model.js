import {textFirstName,textHash,textVariant,availableTextMeetings,meetingTimeLabel,centralParts,isBenefitsReplyLead,benefitsGroupName,isChildSafeLead} from './texting-mode.js?v=26';
import {chooseTextVariant} from './text-learning.js?v=2';
export const stepNames={intro:'Introduction · Sunday / Monday catch-up',tuesday:'Tuesday follow-up',thursday:'Thursday follow-up',saturday:'Saturday final follow-up'};
export function planDraft(user,lead,action,agent,meetings,records=[],now=Date.now()) {
 const same=centralParts(now).hour>=17&&availableTextMeetings(meetings,now,'same-day').length===2;
 const cohort=same?'after5-same-day-eligible':'standard';
 const experiment=(isBenefitsReplyLead(lead.request_type)?'plan-benefits-v2:':'plan-v1:')+action.step+':'+textHash(lead.request_type)+':'+cohort;
 const variant=action.draft?.variant||chooseTextVariant(records.filter(r=>r.timing_cohort===cohort),experiment,textVariant(user,lead.lead_id,experiment,['A','B','C','D']),Math.random,['A','B','C','D']);
 const policy=same&&['C','D'].includes(variant)?'same-day':'standard';
 const slots=availableTextMeetings(meetings,now,policy);
 const child=isChildSafeLead(lead.request_type),will=/will\s*kit/i.test(lead.request_type);
 const company=child?'American Income Life with the Child Safe Program':'American Income Life';
 const benefits=isBenefitsReplyLead(lead.request_type);
 const group=benefits?benefitsGroupName(lead.request_type,lead.group_name||lead.group):'';
 const program='the cost-free benefits program'+(group?' for members of '+group:'');
 const topic=child?'the Child Safe Kit':will?'the will kit':benefits?program+' you sent a reply card for':'your life insurance options';
 const intro='Hi '+textFirstName(lead.name)+', this is '+agent+(child?' from ':' with ')+company+'. ';
 const context={intro:benefits?'We received the reply card you sent in for '+program+'. ':child||will?'I’m reaching out about '+topic+'. ':'We got your request to talk with an agent about life insurance. ',tuesday:'Just following up about '+topic+'. ',thursday:'Wanted to check back about '+topic+'. ',saturday:'One last follow-up this week about '+topic+'. '}[action.step];
 const offers=slots.length===2?slots.map(t=>meetingTimeLabel(t,now)):[];
 const endings={A:offers.length?'I have '+offers[0]+' or '+offers[1]+' open to go over it with you on Zoom. Which works best?':'What day and time works for you to go over it on Zoom?',B:'What time are you usually available to go over it with me on Zoom?',C:offers.length?'I have an opening '+offers[0]+' and '+offers[1]+' for Zoom. Which should I put you down for?':'Would an afternoon or evening Zoom meeting work better for you?',D:offers.length?'Would '+offers[0]+' or '+offers[1]+' work for Zoom? If neither works, what time is usually best?':'Would you like to find a time to go over it on Zoom? What usually works for you?'};
 const mobile=lead.phones.find(p=>p.label==='Mobile'),home=lead.phones.find(p=>p.label==='Home');
 const noReply=records.some(r=>r.lead_id===lead.lead_id&&r.replied===false&&String(r.phone).replace(/\D/g,'')===String(mobile?.number).replace(/\D/g,''));
 return {variant,body:intro+context+endings[variant],number:(noReply&&home?home:mobile||home)?.number,experiment,timingCohort:cohort,offerPolicy:policy,offeredSlots:variant==='B'||offers.length!==2?[]:slots.map(t=>new Date(t).toISOString())};
}
export function centralInput(value){const [date,time]=value.split('T');if(!date||!time)throw Error('Choose a date and time.');const [y,m,d]=date.split('-').map(Number),[h,min]=time.split(':').map(Number);let n=Date.UTC(y,m-1,d,h,min);for(let i=0;i<3;i++){const p=centralParts(n);n+=Date.UTC(y,m-1,d,h)-Date.UTC(p.year,p.month-1,p.day,p.hour);}return new Date(n).toISOString();}

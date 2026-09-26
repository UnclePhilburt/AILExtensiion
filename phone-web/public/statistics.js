import { client } from './auth-runtime.js';
import { formatApl } from './appointment-outcomes.js';
import { RANGE_OPTIONS, COMPARE_OPTIONS, normalizeRange, periodLabel, rangeStart, metricRows, comparisonTrend, chartPoints, comparisonWindows, axisTicks, hourLabel } from './statistics-view.js';
const $ = (s) => document.querySelector(s); const status=$('#statsStatus'), summary=$('#statsSummary'), rows=$('#statsRows'), refresh=$('#statsRefresh'), range=$('#statsRange'), metric=$('#trendMetric'), compare=$('#trendCompare');
const TYPES=[['call','Calls started','☎'],['no-answer','No answer','○'],['virtual-appointment','Virtual appointments','▣'],['refused-appointment','Appointments refused','×'],['next','Leads moved forward','→']];
let allEvents=[], allOutcomes=[];
// Daily / Weekly / Monthly / Yearly and "Previous matching period" only. An
// old link (?range=ytd or all) falls back to a range that exists.
const option=(value,text)=>{const item=document.createElement('option');item.value=value;item.textContent=text;return item;};
range.replaceChildren(...RANGE_OPTIONS.map(([id,text])=>option(id,text)));range.value=normalizeRange(new URLSearchParams(location.search).get('range')||'today');
compare.replaceChildren(...COMPARE_OPTIONS.map(([id,text])=>option(id,text)));
const title=()=>periodLabel(range.value); const count=(items,type)=>items.filter(x=>x.event_type===type).length;
function tile(value,label){const box=document.createElement('div'), number=document.createElement('strong'), caption=document.createElement('span');number.textContent=String(value);caption.textContent=label;box.append(number,caption);return box;}
function row(icon,label,value){const line=document.createElement('div'),left=document.createElement('span'),mark=document.createElement('i'),text=document.createElement('span'),total=document.createElement('strong');line.className='statsRow';left.className='statsLabel';mark.textContent=icon;text.textContent=label;total.textContent=String(value);left.append(mark,text);line.append(left,total);return line;}
function currentData(){const start=rangeStart(range.value), end=new Date();return {events:allEvents.filter(x=>new Date(x.created_at)>=start&&new Date(x.created_at)<=end),outcomes:allOutcomes.filter(x=>new Date(x.created_at)>=start&&new Date(x.created_at)<=end)};}
function render(){const {events,outcomes}=currentData(), m=metricRows(events,outcomes);summary.replaceChildren(tile(m.calls,'Calls started'),tile(m.results,'Call results'),tile(count(events,'next'),'Leads moved'));summary.hidden=false;rows.replaceChildren(...TYPES.map(([type,label,icon])=>row(icon,label,count(events,type))));const panel=$('#appointmentStats'),outRows=$('#appointmentStatsRows');panel.hidden=!outcomes.length;if(outcomes.length)outRows.replaceChildren(row('✓','Appointments held',m.appointments),row('○','No shows',m.noShow),row('↻','Rescheduled',m.rescheduled),row('$','APL recorded',formatApl(m.apl)),row('+','Referrals collected',m.referrals));renderTrend();}
// Points with value null (days still to come, days last month did not have)
// are left out; the line breaks there instead of dropping to 0.
function line(svg, points, color, dashed=false, maxValue=null, axisLength=points.length){if(!points.length)return;const mapped=chartPoints(points,320,150,16,16,maxValue,axisLength);const runs=[];let run=[];for(const p of mapped){if(p.y===null){if(run.length)runs.push(run);run=[];}else run.push(p);}if(run.length)runs.push(run);for(const part of runs){if(part.length>1){const item=document.createElementNS('http://www.w3.org/2000/svg','polyline');item.setAttribute('points',part.map(p=>`${p.x},${p.y}`).join(' '));item.setAttribute('fill','none');item.setAttribute('stroke',color);item.setAttribute('stroke-width','3');item.setAttribute('stroke-linecap','round');item.setAttribute('stroke-linejoin','round');item.setAttribute('vector-effect','non-scaling-stroke');if(dashed)item.setAttribute('stroke-dasharray','7 6');svg.append(item);}for(const point of part){const dot=document.createElementNS('http://www.w3.org/2000/svg','circle');dot.setAttribute('cx',point.x);dot.setAttribute('cy',point.y);dot.setAttribute('r','3');dot.setAttribute('fill',color);svg.append(dot);}}}
// Daily: per clock hour, first to last activity of today or the comparison
// day. Weekly (Mon-Sun), Monthly (1 to the last day) and Yearly (Jan-Dec) use
// their whole period as the axis; the current line stops at today.
function renderTrend(){
  const chosen=metric.value, label=metric.options[metric.selectedIndex].text, hourly=range.value==='today';
  const series=comparisonTrend(allEvents,allOutcomes,chosen,range.value,compare.value);
  const chart=$('#trendChart'), legend=$('#trendLegend'), axis=$('#trendAxis');
  const unitWord={hour:'hour',weekday:'day',day:'day',month:'month'}[series.unit]||'day';
  $('#trendHeading').textContent=`${label} by ${unitWord}`;
  $('#trendEyebrow').textContent=hourly?'HOURLY TREND':series.unit==='month'?'MONTHLY TREND':'DAILY TREND';
  chart.setAttribute('aria-label',`${label} by ${unitWord}, ${title().toLowerCase()}`);
  chart.replaceChildren(); legend.replaceChildren(); axis.replaceChildren();
  const empty=!series.hasData||!series.current.length;
  chart.classList.toggle('isEmpty',empty); axis.hidden=empty; legend.hidden=empty||!series.comparison.length;
  if(empty){
    const note=document.createElement('p'); note.className='trendEmpty';
    note.textContent=`No ${label.toLowerCase()} recorded ${hourly?'today':`${title().toLowerCase()}`} yet.`;
    chart.append(note);
    $('#trendCaption').textContent=hourly?'The chart fills in hour by hour as you work.':'';
    return;
  }
  const values=[...series.current,...series.comparison].map(x=>x.value).filter(v=>v!==null);
  const maxima=Math.max(1,...values), length=series.axis.length;
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 320 150'); svg.setAttribute('preserveAspectRatio','none'); svg.setAttribute('aria-hidden','true');
  line(svg,series.current,'#247456',false,maxima,length); line(svg,series.comparison,'#7e8cba',true,maxima,length);
  chart.append(svg);
  // HTML labels under the chart (SVG text would stretch with the chart).
  const positions=chartPoints(series.axis.map(()=>({value:0})),320,150,16,16,maxima,length), narrow=(chart.clientWidth||320)<300;
  for(const index of axisTicks(series,narrow?4:5)){
    const x=positions[index].x, tick=document.createElement('span');
    tick.textContent=series.axis[index]; tick.style.left=`${x/320*100}%`;
    if(x<30) tick.className='atStart'; else if(x>290) tick.className='atEnd';
    axis.append(tick);
  }
  const addLegend=(color,text)=>{const item=document.createElement('span'),dot=document.createElement('i');dot.style.background=color;item.append(dot,document.createTextNode(text));legend.append(item);};
  addLegend('#247456',title()); if(series.comparison.length) addLegend('#7e8cba',series.label);
  const compared=series.comparison.length?` Solid green is ${title().toLowerCase()}; dashed blue is ${series.label.toLowerCase()}.`:'';
  const lined={hour:'clock hour',weekday:'weekday',day:'day of the month',month:'month'}[series.unit];
  $('#trendCaption').textContent=hourly
    ?`${label} per hour, ${hourLabel(series.first)} to ${hourLabel(series.last)}${series.comparison.length?`, lined up by ${lined}`:''}.${compared}`
    :`${label} per ${unitWord}${series.comparison.length?`, lined up by ${lined}`:''}.${compared}`;
}
async function load(){refresh.disabled=true;status.textContent='Loading your activity…';try{const {data:sessionData,error:sessionError}=await client.auth.getSession();if(sessionError||!sessionData.session){location.replace('account.html?next=statistics.html');return;}const windows=comparisonWindows(range.value,compare.value),start=[windows.current,...windows.comparisons].reduce((earliest,w)=>!earliest||w.start<earliest?w.start:earliest,null)||rangeStart(range.value);const [{data:events,error},outcomeResponse]=await Promise.all([client.from('companion_events').select('event_type,created_at').gte('created_at',start.toISOString()).order('created_at',{ascending:true}).limit(10000),client.from('appointment_outcomes').select('status,apl,referrals,created_at').gte('created_at',start.toISOString()).order('created_at',{ascending:true}).limit(10000)]);if(error)throw error;allEvents=events||[];allOutcomes=outcomeResponse.error?[]:outcomeResponse.data||[];render();status.textContent=`Updated ${new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})} · ${title()}`;}catch(error){status.textContent=error.message||'Could not load statistics.';}finally{refresh.disabled=false;}}
refresh.addEventListener('click',load);range.addEventListener('change',load);metric.addEventListener('change',renderTrend);compare.addEventListener('change',load);load();

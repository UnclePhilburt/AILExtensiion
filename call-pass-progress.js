const centralDay=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
export async function savedCallsToday(client,user,now=new Date()){
 const since=new Date(+now-48*60*60*1000).toISOString(),today=centralDay(now);
 async function read(table,columns,time){
  const rows=[];
  for(let offset=0;;offset+=500){
   const {data,error}=await client.from(table).select(columns).eq('user_id',user).gte(time,since).order(time).order('id').range(offset,offset+499);
   if(error){if(table!=='calling_number_calls'&&['42P01','PGRST205'].includes(error.code))return [];throw error;}
   rows.push(...data);if(data.length<500)return rows;
  }
 }
 const [legacy,workspace,actions]=await Promise.all([read('calling_number_calls','id,created_at','created_at'),read('followup_workspace_calls','id,started_at,action_id','started_at'),read('followup_actions','id,kind,started_at','started_at')]);
 const calls=new Set(),linked=new Set(workspace.map(c=>c.action_id).filter(Boolean));
 for(const c of legacy)if(centralDay(c.created_at)===today)calls.add(c.id);
 for(const c of workspace)if(centralDay(c.started_at)===today)calls.add(c.id);
 for(const c of actions)if(c.kind==='call'&&!linked.has(c.id)&&centralDay(c.started_at)===today)calls.add('plan:'+c.id);
 return calls.size;
}
export function createCallPassProgress(root,{client,getUser}){
 if(!root)return {refresh:async()=>{}};
 const label=document.createElement('strong'),detail=document.createElement('p'),bar=document.createElement('progress'),restart=document.createElement('button');
 label.textContent='Calling pass';bar.max=1;bar.value=0;bar.style.width='100%';bar.setAttribute('aria-label','Leads called this pass');restart.textContent='New pass';restart.type='button';restart.hidden=true;
 const daily=document.createElement('strong');daily.textContent='Loading saved calls…';
 root.append(daily,label,bar,detail,restart);let pass=null,busy=false;
 async function refreshDaily(user){try{const count=await savedCallsToday(client,user);if(getUser()===user)daily.textContent=count+' calls today · Both phones';}catch{if(getUser()===user)daily.textContent='Saved calls unavailable — retrying';}} 
 async function refresh(reset=null){
  const user=getUser();if(busy||!user)return;busy=true;restart.disabled=true;
  const dailyRefresh=refreshDaily(user);
  try{const {data,error}=await client.rpc('workspace_pass_progress',{p_restart:reset});if(getUser()!==user)return;if(error)throw error;
   pass=data.pass;restart.hidden=Boolean(data.needs_list);bar.max=data.total||1;bar.value=data.called||0;
   label.textContent=data.needs_list?'Calling list not connected':'Pass '+data.pass+' · '+data.called+' / '+data.total+' leads called';
   detail.textContent=data.needs_list?'Open your IMPACT inbox and let Load all pages for calling finish.':data.remaining+' remaining · Both phones combined';
  }catch(error){if(getUser()!==user)return;label.textContent='Calling pass';detail.replaceChildren();const a=document.createElement('a');a.href='downloads/shared-call-pass.sql';a.textContent=['PGRST202','42883'].includes(error.code)?'Run the shared-pass SQL update once':'Counter unavailable — refresh after reconnecting';detail.append(a);}
  finally{await dailyRefresh;busy=false;restart.disabled=false;}
 }
 restart.onclick=()=>{if(pass&&confirm('Start a new calling pass for BOTH phones? Call history will be kept.'))void refresh(pass);};
 setInterval(()=>{if(!document.hidden)void refresh();},10000);
 addEventListener('focus',()=>void refresh());
 return {refresh};
}

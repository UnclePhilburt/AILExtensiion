export function createCallPassProgress(root,{client,getUser}){
 if(!root)return {refresh:async()=>{}};
 const label=document.createElement('strong'),detail=document.createElement('p'),bar=document.createElement('progress'),restart=document.createElement('button');
 label.textContent='Calling pass';bar.max=1;bar.value=0;bar.style.width='100%';bar.setAttribute('aria-label','Leads called this pass');restart.textContent='New pass';restart.type='button';restart.hidden=true;
 root.append(label,bar,detail,restart);let pass=null,busy=false;
 async function refresh(reset=null){
  const user=getUser();if(busy||!user)return;busy=true;restart.disabled=true;
  try{const {data,error}=await client.rpc('workspace_pass_progress',{p_restart:reset});if(getUser()!==user)return;if(error)throw error;
   pass=data.pass;restart.hidden=Boolean(data.needs_list);bar.max=data.total||1;bar.value=data.called||0;
   label.textContent=data.needs_list?'Calling list not connected':'Pass '+data.pass+' · '+data.called+' / '+data.total+' leads called';
   detail.textContent=data.needs_list?'Open your IMPACT inbox and let Load all pages for calling finish.':data.remaining+' remaining · Both phones combined';
  }catch(error){if(getUser()!==user)return;label.textContent='Calling pass';detail.replaceChildren();const a=document.createElement('a');a.href='downloads/shared-call-pass.sql';a.textContent=['PGRST202','42883'].includes(error.code)?'Run the shared-pass SQL update once':'Counter unavailable — refresh after reconnecting';detail.append(a);}
  finally{busy=false;restart.disabled=false;}
 }
 restart.onclick=()=>{if(pass&&confirm('Start a new calling pass for BOTH phones? Call history will be kept.'))void refresh(pass);};
 setInterval(()=>{if(!document.hidden)void refresh();},10000);
 addEventListener('focus',()=>void refresh());
 return {refresh};
}

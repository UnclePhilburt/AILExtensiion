export async function currentCallPass(client){
 let result=await client.rpc('workspace_pass_progress',{p_restart:null});
 if(!result.error&&!result.data.needs_list&&result.data.total>0&&result.data.called>=result.data.total){
  // The server compares pass numbers under a lock, so both phones can finish together.
  result=await client.rpc('workspace_pass_progress',{p_restart:result.data.pass});
 }
 return result;
}
export function createCallPassProgress(root,{client,getUser}){
 if(!root)return {refresh:async()=>{}};
 const label=document.createElement('strong'),detail=document.createElement('p'),bar=document.createElement('progress');
 label.textContent='Calling pass';bar.max=1;bar.value=0;bar.setAttribute('aria-label','Leads called this pass');
 
 root.classList.add('callPass');label.className='callPassLabel';detail.className='callPassDetail';root.title='Call totals and pass progress are shared by both phones';
 root.append(label,detail);let busy=false;
 async function refresh(){
  const user=getUser();if(busy||!user)return;busy=true;

  try{const {data,error}=await currentCallPass(client);if(getUser()!==user)return;if(error)throw error;
   bar.hidden=Boolean(data.needs_list);bar.max=data.total||1;bar.value=data.called||0;
   label.textContent=data.needs_list?'Calling list not connected':data.called+'/'+data.total+' Leads called this pass';
   detail.hidden=!data.needs_list;detail.textContent=data.needs_list?'Open your IMPACT inbox and let Load all pages for calling finish.':data.remaining+' left';
  }catch(error){if(getUser()!==user)return;label.textContent='Calling pass';detail.hidden=false;detail.replaceChildren();const a=document.createElement('a');a.href='downloads/shared-call-pass.sql';a.textContent=['PGRST202','42883'].includes(error.code)?'Run the shared-pass SQL update once':'Counter unavailable — refresh after reconnecting';detail.append(a);}
  finally{busy=false;}
 }
 setInterval(()=>{if(!document.hidden)void refresh();},10000);
 addEventListener('focus',()=>void refresh());
 return {refresh};
}

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');
const model=vm.createContext({});
vm.runInContext(fs.readFileSync('phone-web/public/calling-numbers-model.js','utf8').replace(/^export /gm,''),model);

test('calling numbers normalize equivalent formats and reject invalid input',()=>{
  for(const value of ['(312) 555-0199','1-312-555-0199','+1 312 555 0199']) assert.equal(model.normalizeCallingNumber(value),'+13125550199');
  assert.equal(model.normalizeCallingNumber('+44 20 7946 0958'),'+442079460958');
  for(const value of ['', '555-0199', 'call me', '+012345678', '3125550199 ext 2','12+34567890','++13125550199']) assert.equal(model.normalizeCallingNumber(value),null);
});

test('health rates use recorded results, distinguish empty data and require enough history for comparison',()=>{
  const empty=model.numberHealth([],'a');
  assert.equal(empty.calls,0); assert.equal(empty.noAnswerRate,'—');
  const stats=[{number_id:'a',period:'current',calls:100,recorded:40,no_answer:30,appointments:8,refused:2},
    {number_id:'a',period:'previous',calls:40,recorded:20,no_answer:10,appointments:6,refused:4},
    {number_id:'b',period:'current',calls:500,recorded:500,no_answer:500}];
  const health=model.numberHealth(stats,'a');
  assert.equal(health.missing,60); assert.equal(health.noAnswerRate,'75%'); assert.equal(health.appointmentRate,'20%');
  assert.equal(health.answered,10); assert.equal(health.estimate,'mixed'); assert.equal(health.estimateLabel,'Mixed');
  assert.match(health.trend,/25 percentage points higher/);
  assert.equal(empty.estimate,'early');
  assert.equal(model.numberHealth(stats,'b').estimate,'wearing');
  const steady=model.numberHealth([{number_id:'c',period:'current',calls:20,recorded:20,no_answer:8,appointments:8,refused:4}],'c');
  assert.equal(steady.estimate,'steady'); assert.equal(steady.answered,12);
  stats[1].recorded=19; assert.match(model.numberHealth(stats,'a').trend,/at least 20/);
});

test('number storage, call attribution, retries, cloud integration and owner privacy',async()=>{
  const db=new PGlite();
  const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
  const device='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const id=n=>`cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12,'0')}`;
  const asUser=user=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
  const record=(n,type,number=null)=>db.query('select calling_number_record($1,$2,$3)',[id(n),type,number]);
  const manage=(number,action)=>db.query('select calling_number_manage($1,$2)',[number,action]);
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public, auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
      insert into auth.users values ('${a}'),('${b}');`);
    for(const file of ['001_cloud_sync.sql','006_activity_statistics.sql','008_allow_activity_logging.sql','010_call_timing_insights.sql','018_calling_numbers.sql','019_two_phone_windows.sql','021_phone_specific_calling_numbers.sql']) await db.exec(fs.readFileSync(`supabase/migrations/${file}`,'utf8'));
    await db.exec(`insert into companion_members(user_id) values ('${a}'),('${b}'); set role authenticated;`);
    await asUser(a);
    await db.query('select calling_number_save($1,$2)',['+13125550199','Work']);
    await db.query('select calling_number_save($1,$2)',['+13125550199','Updated label']);
    await db.query('select calling_number_save($1,$2)',['+13125550198','Backup']);
    const numbers=(await db.query('select * from calling_numbers order by phone desc')).rows;
    assert.equal(numbers.length,2); assert.equal(numbers[0].label,'Updated label');
    const first=numbers[0].id,second=numbers[1].id;
    await assert.rejects(db.query('select calling_number_save($1,$2)',['not a number','Invalid']),/check constraint/);
    await record(1,'call'); // no active number: remains unattributed
    await record(2,'call',first);
    await record(2,'call',second); // retry must not move the original call
    await record(2,'no-answer');
    await record(2,'no-answer');
    await record(2,'refused-appointment'); // first result wins
    await record(3,'call',second);
    await record(3,'virtual-appointment'); // picker opened: not yet an appointment
    assert.equal((await db.query('select outcome from calling_number_calls where id=$1',[id(3)])).rows[0].outcome,null);
    await record(3,'virtual-appointment-slot');
    await record(1,'call',first);
    const calls=(await db.query('select * from calling_number_calls order by id')).rows;
    assert.equal(calls.length,3); assert.equal(calls[0].number_id,null);
    assert.equal(calls[1].number_id,first); assert.equal(calls[1].outcome,'no-answer');
    assert.equal(calls[2].number_id,second); assert.equal(calls[2].outcome,'virtual-appointment-slot');
    await manage(first,'archive');
    assert.equal((await db.query('select * from calling_number_stats()')).rows.length,2);
    await db.query('select calling_number_save($1,$2)',['+13125550199','Restored']);
    assert.equal((await db.query('select archived from calling_numbers where id=$1',[first])).rows[0].archived,false);

    await db.query('select companion_desktop($1,$2)',[device,{available:true,leadId:'123'}]);
    await db.query('select companion_send($1,$2,$3)',[id(10),device,{type:'call',leadId:'123',healthCallId:id(4),healthNumberId:second}]);
    await db.query('select companion_send($1,$2,$3)',[id(11),device,{type:'refused-appointment',leadId:'123',healthCallId:id(4),healthNumberId:second}]);
    const cloud=(await db.query('select * from calling_number_calls where id=$1',[id(4)])).rows[0];
    assert.equal(cloud.number_id,second); assert.equal(cloud.outcome,'refused-appointment');
    await assert.rejects(db.query('select companion_send($1,$2,$3)',[id(12),device,{type:'call',leadId:'wrong',healthCallId:id(5)}]),/lead changed/);
    assert.equal((await db.query('select * from calling_number_calls where id=$1',[id(5)])).rows.length,0);

    await asUser(b);
    assert.equal((await db.query('select * from calling_numbers')).rows.length,0);
    assert.equal((await db.query('select * from calling_number_stats()')).rows.length,0);
    await assert.rejects(manage(first,'activate'),/not found/);
    await assert.rejects(db.query('insert into calling_number_calls(id,number_id) values($1,$2)',[id(99),first]),/foreign key/);
    await record(4,'no-answer');
    await asUser(a);
    assert.equal((await db.query('select outcome from calling_number_calls where id=$1',[id(4)])).rows[0].outcome,'refused-appointment');
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query('select calling_number_stats()'),/permission denied/);
  } finally {await db.close();}
});

test('settings UI saves, assigns a line to this phone, archives, and reports unavailable stats without false zeroes',async()=>{
  const nodes=[];
  const make=tag=>{
    const item={tag,children:[],listeners:{},textContent:'',disabled:false,value:'',
      append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},
      addEventListener(type,fn){this.listeners[type]=fn;},querySelectorAll(){return nodes.filter(n=>['button','input'].includes(n.tag));}};
    nodes.push(item);return item;
  };
  const els=new Map(['callingNumbers','callingNumberForm','callingNumberList','callingNumberStatus','refreshCallingNumbers'].map(id=>[id,make(id==='refreshCallingNumbers'?'button':'div')]));
  const form=els.get('callingNumberForm');form.elements={phone:make('input'),label:make('input')};
  form.reset=()=>{form.elements.phone.value='';form.elements.label.value='';};
  let numbers=[],statsFail=false,numbersFail=false;
  const client={auth:{getSession:async()=>({data:{session:{user:{id:'a'}}}}),onAuthStateChange(){}},
    from:()=>({select(){return this;},order:async()=>numbersFail?{error:{code:'42P01'}}:{data:numbers}}),
    rpc:async(name,args)=>{
      if(name==='calling_number_stats')return statsFail?{error:{message:'offline'}}:{data:[]};
      if(name==='calling_number_save')numbers.push({id:'a',phone:args.p_phone,label:args.p_label,active:false,archived:false});
      if(name==='calling_number_manage'){numbers[0].active=args.p_action==='activate';numbers[0].archived=args.p_action==='archive';}
      return {};
    }};
  const context=vm.createContext({client,document:{querySelector:s=>els.get(s.slice(1)),createElement:make},setTimeout,localStorage:{},loadPhoneSettings:()=>({phoneLineId:''}),savePhoneSettings:()=>{}});
  vm.runInContext(fs.readFileSync('phone-web/public/calling-numbers-model.js','utf8').replace(/^export /gm,'')+'\n'+fs.readFileSync('phone-web/public/calling-numbers.js','utf8').replace(/^import .*;\r?\n/gm,''),context);
  const settle=async()=>{for(let i=0;i<5;i++)await new Promise(setImmediate);};
  const text=node=>node.textContent+' '+node.children.map(text).join(' ');
  await settle();assert.match(text(els.get('callingNumberList')),/No calling numbers/);
  form.elements.phone.value='invalid';form.listeners.submit({preventDefault(){}});assert.match(els.get('callingNumberStatus').textContent,/Enter a 10-digit/);
  form.elements.phone.value='312-555-0199';form.elements.label.value='Work';
  form.listeners.submit({preventDefault(){}});await settle();
  assert.equal(numbers[0].phone,'+13125550199');
  const currentButton=label=>{
    const walk=node=>node.children.flatMap(child=>[child,...walk(child)]);
    return walk(els.get('callingNumberList')).find(n=>n.tag==='button'&&n.textContent===label);
  };
  assert.match(text(els.get('callingNumberList')), /Verizon/);
  assert.match(text(els.get('callingNumberList')), /T-Mobile/);
  assert.match(text(els.get('callingNumberList')), /AT&T/);
  assert.match(text(els.get('callingNumberList')), /Sprint/);
  assert.match(text(els.get('callingNumberList')), /Register as a real number/);
  assert.match(text(els.get('callingNumberList')), /Twilio video/);
  assert.equal(currentButton('Copy this number').textContent, 'Copy this number');
  currentButton('Use on this phone').listeners.click();await settle();
  assert.match(els.get('callingNumberStatus').textContent,/other phone/);
  currentButton('Archive').listeners.click();await settle();assert.equal(numbers[0].archived,true);
  assert.match(text(els.get('callingNumberList')),/history saved/);
  statsFail=true;els.get('refreshCallingNumbers').listeners.click();await settle();
  assert.match(text(els.get('callingNumberList')),/Statistics are unavailable/);
  assert.doesNotMatch(text(els.get('callingNumberList')),/Calls started/);
  numbersFail=true;els.get('refreshCallingNumbers').listeners.click();await settle();
  assert.match(els.get('callingNumberStatus').textContent,/account update needs to be installed/);
  assert.equal(form.elements.phone.disabled,true);
});

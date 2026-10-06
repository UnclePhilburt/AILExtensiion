const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const dir = path.join(__dirname, '../phone-web/public');
const read = (file) => fs.readFileSync(path.join(dir, file), 'utf8').replace(/^export /gm, '');
const context = vm.createContext({});
vm.runInContext(`${read('call-scripts.data.js')}\n${read('call-scripts.js').replace(/^import .*$/gm, '')}\nObject.assign(this, { scriptForRequestType, fillScriptText, firstNameFrom, CALL_SCRIPTS });`, context);

test('a reply-card lead opens the Response Card script with the person\'s first name', () => {
  const script = context.scriptForRequestType('Union Member Response Card');
  assert.equal(script.id, 'RESPONSE');
  assert.match(context.fillScriptText(script.steps[0].body, { leadName: 'CARTER, JAMES', address: '10 Main St' }), /Hey, James/);
  assert.match(context.fillScriptText(script.steps[1].body, { leadName: 'CARTER, JAMES', address: '10 Main St' }), /10 Main St/);
  assert.match(context.fillScriptText(script.steps[0].body, { leadName: 'CARTER, JAMES' }, 'Cody'), /this is Cody/);
  assert.match(context.fillScriptText('this is {agent}', {}, ''), /this is \(You\)/);
});

test('will kit, globe lapse and an unknown lead pick the right script or none', () => {
  assert.equal(context.scriptForRequestType('Free Will Kit').id, 'WILLKIT');
  assert.equal(context.scriptForRequestType('Globe Lapse').id, 'GLOBELAPSE');
  assert.equal(context.scriptForRequestType('Something else'), null);
  assert.equal(context.CALL_SCRIPTS.length, 13);
});
test('association names appear in the phone script without a local number',()=>{
 assert.equal(context.fillScriptText('Your group is {group}',{requestType:'St Louis Bowling Association (SGCOY) (AD&D)'}),'Your group is St Louis Bowling Association');
 assert.equal(context.fillScriptText('{group}',{group:'St Louis Bowling Association'}),'St Louis Bowling Association');
});

test('an open script follows lead changes and late type updates',()=>{
 const nodes=[];
 function node(tag){const n={tag,hidden:false,value:'',children:[],listeners:{},append(...x){this.children.push(...x);},replaceChildren(...x){this.children=x;},setAttribute(){},addEventListener(k,f){this.listeners[k]=f;}};nodes.push(n);return n;}
 const ctx=vm.createContext({document:{createElement:node},localStorage:{},loadPhoneSettings:()=>({firstName:'Cody'}),CALL_SCRIPTS:context.CALL_SCRIPTS,scriptForRequestType:context.scriptForRequestType,fillScriptText:context.fillScriptText});
 vm.runInContext(read('script-overlay.js').replace(/^import .*$/gm,''),ctx);
 const overlay=ctx.createScriptOverlay(node('main')),picker=nodes.find(n=>n.className==='scriptPicker');
 overlay.open({leadId:'1',requestType:'Union Member Response Card'});assert.equal(picker.value,'RESPONSE');
 overlay.sync({enabled:true,calling:true,lead:{leadId:'2',requestType:'Child Safe Kit Offer'}});assert.equal(picker.value,'CHILDSAFE');
 overlay.sync({enabled:true,calling:true,lead:{leadId:'2',requestType:'Free Will Kit'}});assert.equal(picker.value,'WILLKIT');
 overlay.sync({enabled:true,calling:true,lead:{leadId:'3',requestType:''}});assert.equal(picker.value,'');
});

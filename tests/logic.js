// Node-only deterministic logic tests; works without a browser or Firebase account.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const elements=new Map();
function el(key){if(!elements.has(key)) elements.set(key,{innerHTML:'',textContent:'',value:'',classList:{remove(){},add(){},toggle(){}},addEventListener(){},querySelectorAll(){return []}});return elements.get(key)}
const saved={};
const ctx={console,Date,Math,Number,Object,Array,Map,String,JSON,RegExp,Intl,crypto:require('crypto').webcrypto,
 document:{querySelector:el,querySelectorAll(){return []},addEventListener(){}},
 navigator:{},location:{protocol:'file:'},
 window:{scrollTo(){},setTimeout,clearTimeout,open(){}},
 localStorage:{getItem:key=>saved[key]||null,setItem:(key,value)=>saved[key]=value},
 setTimeout,clearTimeout};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(require('path').join(__dirname,'../app.js'),'utf8'),ctx,{filename:'app.js'});
const evalCode=code=>vm.runInContext(code,ctx);
assert.equal(evalCode('PRODUCTS.length'),36);
assert.equal(evalCode('CONVERSIONS.length'),4);
assert.deepEqual(JSON.parse(JSON.stringify(evalCode(`parseWhatsApp('2 x Pine gel 5 L\\n1 x Two-stroke oil 500 ml\\n3 x Black bags').lines`))),[
 {productId:'pine-gel-5l',quantity:2},{productId:'two-stroke-500ml',quantity:1},{productId:'black-bags',quantity:3}]);
assert.equal(evalCode("parseWhatsApp('Please send the equipment').unmatched.length"),1);
// Each added stock item is available in the catalogue and WhatsApp matcher.
for(const [phrase,id] of [["Petromark Super Two Stroke 20 L", "two-stroke-20l"], ["a660", "a660-turf-adhesive"], ["oilcap", "oilcap-25l"], ["outpace", "outpace-flowable-5l"], ["viroaxe", "viroaxe-5l"], ["starbug", "starbug-5l"], ["cypermethrin", "cypermethrin-1l"], ["hth clear 4 weeks", "hth-clear4weeks-12kg"], ["black sanitiser", "black-sanitiser"]]){
 assert.equal(evalCode(`parseWhatsApp(${JSON.stringify('2 x '+phrase)}).lines[0].productId`),id);
 assert.equal(evalCode(`qty(${JSON.stringify(id)})`),0);
 assert.ok(evalCode('options()').includes(`value="${id}"`));
}
// Custom wording uses the same parser for pasted text and screenshot OCR.
evalCode(`data.settings.productEdits={
 'hand-soap-5l':{nicknames:['Blue soap 5 L','Guest soap']},
 'hand-soap-20l':{nicknames:['Blue soap 20 L','Guest soap']},
 'black-bags':{nicknames:['Wheelie liners']}
}`);
const nicknameOrder=evalCode(`parseWhatsApp('2 x BLUE SOAP 5L\\n3 x blue soap 20 litres\\n4 x wheelie liners')`);
assert.deepEqual(JSON.parse(JSON.stringify(nicknameOrder.lines)),[
 {productId:'hand-soap-5l',quantity:2},{productId:'hand-soap-20l',quantity:3},{productId:'black-bags',quantity:4}]);
assert.equal(nicknameOrder.unmatched.length,0);
for(const line of ['2 x Guest soap','2 x Blue soap 5 L 20 L','2 x wheelie liners and mop']){
 const parsed=evalCode(`parseWhatsApp(${JSON.stringify(line)})`);
 assert.equal(parsed.lines.length,0);
 assert.equal(parsed.unmatched[0],line);
}
delete saved.stock_control_local_v1;
evalCode('delete data.settings.productEdits');
assert.equal(evalCode("whatsappPhone('082 123 4567')"),'27821234567');
assert.equal(evalCode("whatsappPhone('bad-number')"),null);
// Stock deductions happen once only on Collected, and never go below zero.
evalCode(`data.counts['pine-gel-5l']=3;
 data.tickets.push({id:'TEST-0001',manager:'Test',site:'',notes:'',phone:'',lines:[{productId:'pine-gel-5l',quantity:2}],status:'ready',createdAt:new Date().toISOString()});`);
evalCode("changeStatus('TEST-0001','collected')");
assert.equal(evalCode("data.counts['pine-gel-5l']"),1);
assert.equal(evalCode("data.movements.filter(x=>x.ticketId==='TEST-0001').length"),1);
evalCode("changeStatus('TEST-0001','collected')");
assert.equal(evalCode("data.counts['pine-gel-5l']"),1);
// Insufficient inventory blocks collection without changing the ticket.
evalCode(`data.tickets.push({id:'TEST-0002',manager:'Test',site:'',notes:'',phone:'',lines:[{productId:'pine-gel-5l',quantity:5}],status:'ready',createdAt:new Date().toISOString()});`);
evalCode("changeStatus('TEST-0002','collected')");
assert.equal(evalCode("data.counts['pine-gel-5l']"),1);
assert.equal(evalCode("data.tickets.find(t=>t.id==='TEST-0002').status"),'ready');
for(const p of JSON.parse(JSON.stringify(evalCode('PRODUCTS'))))assert.ok(fs.existsSync(require('path').join(__dirname,'../assets',p.img)),`Missing image: ${p.img}`);
console.log('PASS: catalogue and images, message parser, WhatsApp numbers, single-issue collection and insufficient-stock protection');

(async()=>{
 evalCode("accessRole='owner'; confirmTicketDeletion('TEST-0001')");
 assert.match(el('#modal-host').innerHTML,/Confirm deletion/);
 assert.ok(evalCode("data.tickets.some(t=>t.id==='TEST-0001')"));
 evalCode("ticketDetails('TEST-0001')");
 assert.ok(evalCode("data.tickets.some(t=>t.id==='TEST-0001')"));
 evalCode("accessRole='stock'; ticketDetails('TEST-0001')");
 assert.doesNotMatch(el('#modal-host').innerHTML,/data-action="delete-ticket"/);
 await evalCode("deleteTicket('TEST-0001')");
 assert.ok(evalCode("data.tickets.some(t=>t.id==='TEST-0001')"));
 evalCode("accessRole='owner'; confirmTicketDeletion('TEST-0001')");
 await evalCode("deleteTicket('TEST-0001')");
 assert.ok(!evalCode("data.tickets.some(t=>t.id==='TEST-0001')"));
 assert.ok(evalCode("data.tickets.some(t=>t.id==='TEST-0002')"));
 assert.equal(evalCode("data.counts['pine-gel-5l']"),1);
 assert.equal(evalCode("data.movements.filter(x=>x.ticketId==='TEST-0001').length"),1);
 console.log('PASS: ticket confirmation, owner-only deletion and stock history preservation');
})().catch(error=>{console.error(error);process.exitCode=1});

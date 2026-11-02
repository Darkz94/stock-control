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
assert.equal(evalCode('PRODUCTS.length'),16);
assert.equal(evalCode('CONVERSIONS.length'),4);
assert.deepEqual(JSON.parse(JSON.stringify(evalCode(`parseWhatsApp('2 x Pine gel 5 L\\n1 x Two-stroke oil 500 ml\\n3 x Black bags').lines`))),[
 {productId:'pine-gel-5l',quantity:2},{productId:'two-stroke-500ml',quantity:1},{productId:'black-bags',quantity:3}]);
assert.equal(evalCode("parseWhatsApp('Please send the equipment').unmatched.length"),1);
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

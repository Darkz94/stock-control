'use strict';
/* Stock Control v1: client-side, single-device prototype. Never put API keys or real customer data in this repository. */
const PRODUCTS = [
  {id:'two-stroke-500ml',name:'Two-stroke oil',size:'500 ml bottle',group:'Chemicals & liquids',unit:'bottles',img:'two-stroke-500ml.webp',keywords:['two stroke oil 500 ml','two-stroke oil 500 ml','two stroke 500','two-stroke 500','2 stroke 500','2t oil 500']},
  {id:'two-stroke-20l',name:'Two-stroke oil',size:'20 L bucket',group:'Chemicals & liquids',unit:'buckets',img:'two-stroke-20l.webp',keywords:['two stroke oil 20 l','two-stroke oil 20 l','two stroke 20','two-stroke 20','2 stroke 20','2t oil 20']},
  {id:'nylon-line',name:'Nylon line',size:'Trimmer line spool',group:'Garden consumables',unit:'spools',img:'nylon-line.webp',keywords:['nylon','trimmer line','brushcutter line']},
  {id:'pine-gel-5l',name:'Pine gel',size:'5 L bucket',group:'Chemicals & liquids',unit:'buckets',img:'pine-gel-5l.webp',keywords:['pine gel 5','pinegel 5']},
  {id:'pine-gel-20l',name:'Pine gel',size:'20 L bucket',group:'Chemicals & liquids',unit:'buckets',img:'pine-gel-20l.webp',keywords:['pine gel 20','pinegel 20']},
  {id:'non-selective-20l',name:'Non-selective herbicide',size:'20 L plastic container',group:'Chemicals & liquids',unit:'containers',img:'non-selective-20l.webp',keywords:['non selective herbicide 20','nonselective herbicide 20','non selective 20','non-selective 20','nonselective 20']},
  {id:'non-selective-1l',name:'Non-selective herbicide',size:'1 L bottle',group:'Chemicals & liquids',unit:'bottles',img:'non-selective-1l.webp',keywords:['non selective herbicide 1','nonselective herbicide 1','non selective 1','non-selective 1','nonselective 1']},
  {id:'selective-20l',name:'Selective herbicide',size:'20 L container',group:'Chemicals & liquids',unit:'containers',img:'selective-20l.webp',keywords:['selective 20','selective herbicide 20']},
  {id:'selective-5l',name:'Selective herbicide',size:'5 L bucket',group:'Chemicals & liquids',unit:'buckets',img:'selective-5l.webp',keywords:['selective 5','selective herbicide 5']},
  {id:'bleach-5l',name:'Bleach',size:'5 L container',group:'Chemicals & liquids',unit:'containers',img:'bleach-5l.webp',keywords:['bleach','jik']},
  {id:'toilet-paper',name:'Toilet paper',size:'Pack',group:'Cleaning supplies',unit:'packs',img:'toilet-paper.webp',keywords:['toilet paper','toilet roll','toilet tissue']},
  {id:'black-bags',name:'Black bags',size:'Roll',group:'Cleaning supplies',unit:'rolls',img:'black-bags.webp',keywords:['black bags','bin bags','refuse bags','garbage bags']},
  {id:'rake',name:'Garden rake',size:'Complete tool',group:'Tools & equipment',unit:'rakes',img:'rake.webp',keywords:['rake','rakes']},
  {id:'broom',name:'Broom',size:'Complete tool',group:'Tools & equipment',unit:'brooms',img:'broom.webp',keywords:['broom','brooms']},
  {id:'mop',name:'Mop',size:'Complete tool',group:'Tools & equipment',unit:'mops',img:'mop.webp',keywords:['mop','mops']},
  {id:'broom-sticks',name:'Broom sticks',size:'Loose handles',group:'Tools & equipment',unit:'sticks',img:'broom-sticks.webp',keywords:['broom stick','broomstick','handles','wooden pole']}
];
const CONVERSIONS=[
  {source:'two-stroke-20l',target:'two-stroke-500ml',ratio:40},
  {source:'pine-gel-20l',target:'pine-gel-5l',ratio:4},
  {source:'non-selective-20l',target:'non-selective-1l',ratio:20},
  {source:'selective-20l',target:'selective-5l',ratio:4}
];
const STATUSES={review:'Needs review',new:'New request',preparing:'Preparing',ready:'Ready to collect',collected:'Collected',cancelled:'Cancelled'};
const KEY='stock_control_local_v1';
const initial=()=>({schema:1,counts:Object.fromEntries(PRODUCTS.map(p=>[p.id,0])),tickets:[],movements:[],nextTicket:1,settings:{company:'Stock Control',businessWhatsApp:'',lowThreshold:2}});
let data;
try{const saved=JSON.parse(localStorage.getItem(KEY)||'null');data=validateData(saved)?saved:initial();}catch(_){data=initial()}
const ui={view:'dashboard',category:'All products',search:'',ticketFilter:'All',detail:null,draftLines:[],unmatched:[],captureMeta:{manager:'',phone:'',site:''}};
const product=id=>PRODUCTS.find(p=>p.id===id);
const img=id=>'./assets/'+product(id).img;
const esc=v=>String(v??'').replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
const dateFmt=iso=>new Date(iso).toLocaleString('en-ZA',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
const qty=id=>Number(data.counts[id]||0);
const formatLabel=p=>p.name+' — '+p.size;
const statusBadge=s=>`<span class="pill ${esc(s)}">${esc(STATUSES[s]||s)}</span>`;
const title=(eyebrow,heading,description,buttons='')=>`<div class="page-title"><div><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(heading)}</h1><p class="subtitle">${esc(description)}</p></div><div class="actions">${buttons}</div></div>`;
const btn=(text,action,style='primary',extra='')=>`<button type="button" class="btn ${style}" data-action="${esc(action)}" ${extra}>${text}</button>`;
function validateData(v){return !!(v&&v.schema===1&&v.counts&&typeof v.counts==='object'&&Array.isArray(v.tickets)&&Array.isArray(v.movements)&&v.settings&&Number.isSafeInteger(v.nextTicket))}
function save(){try{localStorage.setItem(KEY,JSON.stringify(data));}catch(e){notify('Could not save. Export a backup and free browser space.',true);console.error(e)}}
function notify(message,error=false){const host=document.querySelector('#toast-host');host.innerHTML=`<div class="toast ${error?'error':''}">${esc(message)}</div>`;window.clearTimeout(notify._timer);notify._timer=setTimeout(()=>host.innerHTML='',3900)}
function move(id,change,kind,reason,ticketId=null){data.counts[id]=qty(id)+change;data.movements.unshift({id:crypto.randomUUID?.()||String(Date.now()+Math.random()),at:new Date().toISOString(),productId:id,change,kind,reason:String(reason||''),ticketId});}
function dashboard(){
 const pending=data.tickets.filter(t=>['review','new','preparing'].includes(t.status));const ready=data.tickets.filter(t=>t.status==='ready');const low=PRODUCTS.filter(p=>qty(p.id)<=data.settings.lowThreshold);const collected=data.tickets.filter(t=>t.status==='collected');
 return title('OPERATIONS OVERVIEW','Your stock, at a glance','Keep supplies organised and manager requests moving.',btn('＋ New order ticket','new-order')+btn('＋ Receive stock','stock-receive',''))+
 `<div class="stats-grid"><div class="stat top"><div class="stat-top">Product variants <span class="stat-icon">▦</span></div><div class="stat-number">${PRODUCTS.length}</div><div class="stat-bottom">Cleaning, garden & maintenance</div></div><div class="stat"><div class="stat-top">Open requests <span class="stat-icon">☷</span></div><div class="stat-number">${pending.length}</div><div class="stat-bottom">New and being prepared</div></div><div class="stat"><div class="stat-top">Ready to collect <span class="stat-icon">✓</span></div><div class="stat-number">${ready.length}</div><div class="stat-bottom">Awaiting handover</div></div><div class="stat"><div class="stat-top">Low / zero stock <span class="stat-icon">!</span></div><div class="stat-number">${low.length}</div><div class="stat-bottom">At or below alert threshold</div></div></div>`+
 `<div class="two-columns"><section class="panel"><div class="panel-heading"><div><h2>Recent order tickets</h2><div class="panel-sub">Track requests from creation through collection</div></div><button class="heading-link btn tiny" data-view="orders">All tickets →</button></div>${data.tickets.length?`<div class="ticket-list">${data.tickets.slice(0,5).map(ticketRow).join('')}</div>`:`<div class="empty-state"><span class="empty-illustration">☷</span>No orders yet. Create your first manager request to open a ticket.</div>`}</section>
 <aside><section class="panel"><div class="panel-heading"><div><h2>Quick actions</h2><div class="panel-sub">Common stock operations</div></div></div><div class="quick-actions"><button class="quick-action" data-action="new-order"><span>☷</span>New ticket</button><button class="quick-action" data-action="stock-receive"><span>＋</span>Receive stock</button><button class="quick-action" data-view="transfers"><span>⇄</span>Convert packs</button><button class="quick-action" data-view="activity"><span>◷</span>Stock history</button></div></section><div style="height:17px"></div><div class="notice"><strong>Local prototype mode</strong>Orders and stock are saved in this browser only. Managers cannot see the same live stock yet. Export backups regularly, and do not enter sensitive information until a secure shared backend is connected.</div></aside></div>`;
}
function ticketRow(t){return `<button class="ticket-row" style="width:100%;background:white;text-align:left" data-action="ticket-detail" data-id="${esc(t.id)}"><div><div class="ticket-row-title">${esc(t.id)} · ${esc(t.manager)}</div><div class="ticket-row-meta">${esc(t.site||'No location')} · ${t.lines.reduce((n,l)=>n+l.quantity,0)} units · ${esc(dateFmt(t.createdAt))}</div></div><div class="ticket-row-right">${statusBadge(t.status)}<span style="color:#91a79b">›</span></div></button>`}
function inventory(){
 const categories=['All products','Chemicals & liquids','Garden consumables','Cleaning supplies','Tools & equipment'];
 const filtered=PRODUCTS.filter(p=>(ui.category==='All products'||ui.category===p.group)&&`${p.name} ${p.size}`.toLowerCase().includes(ui.search.toLowerCase()));
 return title('STOCK CATALOGUE','Inventory','Each pack size is tracked separately so your stock counts stay accurate.',btn('＋ Receive stock','stock-receive')+btn('↓ Export stock CSV','export-stock',''))+
 `<div class="toolbar"><div class="searchbox"><span>⌕</span><input id="inventory-search" placeholder="Search products or pack sizes..." autocomplete="off" value="${esc(ui.search)}" aria-label="Search inventory" /></div><span class="subtitle">${filtered.length} products</span></div>
 <div class="filters">${categories.map(c=>`<button class="filter ${ui.category===c?'active':''}" data-action="category" data-category="${esc(c)}">${esc(c)}</button>`).join('')}</div><div class="product-grid" id="product-grid">${filtered.map(productCard).join('')}</div>${filtered.length?'':'<div class="empty-state">No products match this search.</div>'}`;
}
function productCard(p){let n=qty(p.id);return `<article class="product"><div class="product-image"><span class="category-tag">${esc(p.group)}</span><img src="${esc(img(p.id))}" alt="${esc(formatLabel(p))}" loading="lazy" /></div><div class="product-info"><div class="product-title">${esc(p.name)}</div><div class="product-variant">${esc(p.size)}</div><div class="product-footer"><div class="stock-qty ${n<=data.settings.lowThreshold?'stock-low':''}">${n}<small>${esc(p.unit)}</small></div><button class="btn tiny" data-action="adjust-stock" data-id="${esc(p.id)}">Adjust</button></div></div></article>`}
function orders(){
 const tks=ui.ticketFilter==='All'?data.tickets:data.tickets.filter(t=>t.status===ui.ticketFilter);
 return title('MANAGER REQUESTS','Order tickets','Paste a normal WhatsApp message and a ticket is created immediately.',btn('＋ Manual order','new-order'))+
 `<section class="panel" style="padding:20px;margin-bottom:17px">
  <div class="panel-heading"><div><h2>⚡ Quick WhatsApp Paste</h2><p class="panel-sub">One paste = one saved ticket. No Create Ticket button required.</p></div></div>
  <div class="notice"><strong>Normal WhatsApp only</strong>Copy the manager’s order from WhatsApp. Pasting below instantly creates a numbered ticket marked <strong>Needs review</strong>. Check the products and manager before preparing stock. No chat access or automatic messages.</div>
  <div class="form-grid" style="margin-top:15px">
   <div class="field"><label for="quick-manager">Manager name (optional before pasting)</label><input id="quick-manager" maxlength="100" placeholder="e.g. Thabo" value="${esc(ui.captureMeta.manager)}" /></div>
   <div class="field"><label for="quick-phone">Manager WhatsApp number (optional)</label><input id="quick-phone" inputmode="tel" placeholder="e.g. 082 123 4567" value="${esc(ui.captureMeta.phone)}" /></div>
   <div class="field full"><label for="quick-site">Site / property (optional)</label><input id="quick-site" maxlength="120" placeholder="e.g. Complex A" value="${esc(ui.captureMeta.site)}" /></div>
  </div>
  <div class="field"><label for="quick-paste-message">Paste WhatsApp order here — creates ticket instantly</label>
  <textarea id="quick-paste-message" rows="5" placeholder="2 x Pine Gel 5L&#10;4 x Two-Stroke Oil 500ml&#10;3 x Black Bags" aria-describedby="quick-paste-help"></textarea>
  <small id="quick-paste-help">If your phone inserts text without triggering a Paste event, use the backup button below.</small></div>
  ${btn('Save typed text as ticket','quick-capture','dark')}
 </section>
 <div class="filters">${['All','review','new','preparing','ready','collected','cancelled'].map(st=>`<button data-action="ticket-filter" data-status="${st}" class="filter ${ui.ticketFilter===st?'active':''}">${st==='All'?'All tickets':STATUSES[st]} (${st==='All'?data.tickets.length:data.tickets.filter(t=>t.status===st).length})</button>`).join('')}</div>
 <section class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Ticket</th><th>Manager / site</th><th>Items</th><th>Created</th><th>Status</th><th></th></tr></thead><tbody>${tks.map(t=>`<tr><td><strong>${esc(t.id)}</strong></td><td><strong>${esc(t.manager)}</strong><span class="small-muted">${esc(t.site||'No site supplied')}</span></td><td>${t.lines.length} products</td><td>${esc(dateFmt(t.createdAt))}</td><td>${statusBadge(t.status)}</td><td><button class="btn tiny" data-action="ticket-detail" data-id="${esc(t.id)}">View ›</button></td></tr>`).join('')}</tbody></table></div>${!tks.length?'<div class="empty-state">No tickets in this category.</div>':''}</section>`;
}

function transfers(){return title('PACK SIZE CONVERSIONS','Stock conversions','Record stock moving from larger containers into smaller product sizes.',btn('⇄ Record conversion','new-transfer'))+
 `<div class="notice warning"><strong>Important safety note</strong>This screen records inventory conversions; it is not a procedure for physically handling or repackaging chemicals. Follow product labels, applicable safety procedures and required container labelling.</div><div style="height:18px"></div><div class="product-grid">${CONVERSIONS.map(c=>{let a=product(c.source),b=product(c.target);return `<section class="panel" style="padding:14px"><div style="display:flex;align-items:center;gap:8px"><img src="${esc(img(a.id))}" alt="" style="width:38%;max-height:100px;object-fit:contain" /><span style="font-size:23px;color:var(--accent)">→</span><img src="${esc(img(b.id))}" alt="" style="width:38%;max-height:100px;object-fit:contain" /></div><strong style="font-size:13px">${esc(a.name)}</strong><p class="small-muted">1 × ${esc(a.size)} = ${c.ratio} × ${esc(b.size)}</p><p class="small-muted">Available bulk: ${qty(a.id)} · Small: ${qty(b.id)}</p><button class="btn tiny" data-action="new-transfer" data-source="${esc(a.id)}" style="margin-top:13px">Convert stock</button></section>`}).join('')}</div>`}
function activity(){return title('AUDIT TRAIL','Stock movement history','Every received, adjusted, converted and collected item is recorded.',btn('↓ Export history CSV','export-history',''))+
 `<section class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Product</th><th>Movement</th><th>Reason / ticket</th></tr></thead><tbody>${data.movements.map(m=>`<tr><td>${esc(dateFmt(m.at))}</td><td><strong>${esc(product(m.productId)?.name||m.productId)}</strong><span class="small-muted">${esc(product(m.productId)?.size||'')}</span></td><td><span class="activity-badge ${m.change<0?'out':''}">${m.change>0?'+':''}${esc(m.change)} ${esc(product(m.productId)?.unit||'')}</span></td><td>${esc(m.reason)}${m.ticketId?`<span class="small-muted">${esc(m.ticketId)}</span>`:''}</td></tr>`).join('')}</tbody></table></div>${!data.movements.length?'<div class="empty-state">No stock movements recorded yet.</div>':''}</section>`}
function settings(){return title('PREFERENCES & DATA','Settings & backups','Use your normal WhatsApp number and safeguard your local records.')+
 `<div class="settings-grid"><section class="panel"><div class="panel-heading"><h2>Business details</h2></div><form id="settings-form"><div class="field"><label for="company">Business / department name</label><input id="company" value="${esc(data.settings.company)}" maxlength="90" required /></div><div class="field"><label for="business-number">My regular WhatsApp number (optional)</label><input id="business-number" value="${esc(data.settings.businessWhatsApp)}" placeholder="e.g. +27 82 123 4567" inputmode="tel" /><small>Used only to open a prefilled WhatsApp chat for your own ticket copy; no Business account or API is needed. You must tap Send manually.</small></div><div class="field"><label for="low-threshold">Low stock alert at or below</label><input id="low-threshold" type="number" min="0" max="99999" step="1" value="${data.settings.lowThreshold}" required /></div><button class="btn primary" type="submit">Save settings</button></form></section>
 <section class="panel"><div class="panel-heading"><h2>Backup & reporting</h2></div><p class="subtitle">Because this version saves to one browser, a downloaded backup is essential. Importing a backup replaces all local records.</p><div class="layout-stack" style="margin-top:22px">${btn('↓ Download full JSON backup','export-backup','dark')}${btn('↑ Restore a JSON backup','import-backup','')}${btn('↓ Export ticket CSV','export-orders','')}${btn('↓ Export stock CSV','export-stock','')}</div></section></div><div style="height:18px"></div><div class="notice warning"><strong>Before daily business use</strong>This public prototype has no staff sign-in or secure shared database. Ordinary WhatsApp cannot automatically import orders or send replies. The WhatsApp buttons only prepare messages for a person to check and send. Make the production app private and add authentication and server-side permissions before storing real manager phone numbers or deploying to a team.</div>`}
function render(){document.querySelector('#app-main').innerHTML=({dashboard,inventory,orders,transfers,activity,settings}[ui.view]||dashboard)();document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===ui.view));document.querySelector('#crumb-current').textContent={dashboard:'Overview',inventory:'Inventory',orders:'Order tickets',transfers:'Stock conversions',activity:'Stock history',settings:'Settings & backups'}[ui.view];document.querySelector('#ticket-pill').textContent=data.tickets.filter(t=>['review','new','preparing','ready'].includes(t.status)).length||'';}
function navigate(view){ui.view=view;document.querySelector('#sidebar').classList.remove('open');render();window.scrollTo(0,0);}
function modal(body,heading,wide=false){document.querySelector('#modal-host').innerHTML=`<div class="modal-shade" role="dialog" aria-modal="true" aria-label="${esc(heading)}"><div class="modal ${wide?'wide':''}"><div class="modal-title"><h2>${esc(heading)}</h2><button class="close-btn" data-action="close-modal" aria-label="Close">×</button></div>${body}</div></div>`;}
function closeModal(){document.querySelector('#modal-host').innerHTML='';ui.draftLines=[];ui.unmatched=[];}
function options(selected=''){return PRODUCTS.map(p=>`<option value="${esc(p.id)}" ${p.id===selected?'selected':''}>${esc(formatLabel(p))}</option>`).join('')}
function openStock(id='',mode='receive'){let p=product(id)||PRODUCTS[0];modal(`<form id="stock-form"><div class="field"><label for="stock-product">Product</label><select id="stock-product">${options(p.id)}</select></div><div class="form-grid"><div class="field"><label for="stock-operation">Action</label><select id="stock-operation"><option value="in" ${mode==='receive'?'selected':''}>Receive / add</option><option value="out">Remove / write-off</option><option value="count">Set exact stock count</option></select></div><div class="field"><label for="stock-quantity">Quantity (whole packs)</label><input id="stock-quantity" type="number" min="0" step="1" value="1" required /></div></div><div class="field"><label for="stock-reason">Reason / reference</label><input id="stock-reason" placeholder="e.g. Supplier delivery, stocktake, damaged" maxlength="220" required /></div><div class="notice">Current balance: <strong id="stock-current">${qty(p.id)} ${esc(p.unit)}</strong>All changes will appear in stock history.</div><div class="modal-actions">${btn('Cancel','close-modal','')}<button type="submit" class="btn primary">Save stock movement</button></div></form>`,mode==='receive'?'Receive stock':'Adjust stock');}
function normaliseOrderText(str){
 return String(str||'').toLowerCase().replace(/(\d+)\s*(millilitres?|milliliters?)\b/g,'$1 ml').replace(/(\d+)\s*(litres?|liters?)\b/g,'$1 l').replace(/(\d+)\s*(ml|l)\b/g,'$1 $2').replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
}
function parseWhatsApp(raw){
 const input=String(raw||'').split(/\n|;/).map(l=>l.trim()).filter(Boolean);
 const found=new Map(),unmatched=[];
 const ordered=PRODUCTS.map(p=>({...p,finds:[formatLabel(p),...p.keywords].map(normaliseOrderText)}));
 for(let line of input){
  if(/^(?:from|sender|manager)\s*:/i.test(line))continue;
  if(/^\s*\[[^\]]+\]\s*[^:\n]{2,65}:\s*/.test(line))line=line.replace(/^\s*\[[^\]]+\]\s*[^:\n]{2,65}:\s*/,'');
  const low=normaliseOrderText(line);let result=null,score=0;const productHits=new Set();
  for(const p of ordered){for(const k of p.finds){
   if(k&&(' '+low+' ').includes(' '+k+' ')){productHits.add(p.id);if(k.length>score){result=p;score=k.length}}
  }}
  if(!result){unmatched.push(line);continue}
  // Two requested products in the same sentence need manual review, not a guessed one-item order.
  const separateAmounts=(low.match(/\b\d+\s*x\b/g)||[]).length;
  if(productHits.size>1&&(/\b(?:and|plus)\b|[,&+]/i.test(line)||separateAmounts>1)){unmatched.push(line);continue}
  let leading=low.match(/^(\d+)\s*(?:x|of|bottles?|buckets?|containers?|rolls?|packs?|spools?|pcs?|pieces?)?\s/);
  if(/^\d+\s+(?:l|ml)\b/.test(low))leading=null; // a pack size is not an order quantity
  const trailing=low.match(/(?:x|qty|quantity)\s*(\d+)\s*$/);
  const embedded=!leading&&!trailing?low.match(/\b(\d+)\s*x\b/):null;
  const amount=leading?Number(leading[1]):trailing?Number(trailing[1]):embedded?Number(embedded[1]):1;
  if(!leading&&!trailing&&!embedded)unmatched.push('Quantity assumed as 1 — confirm: '+line);
  if(!Number.isSafeInteger(amount)||amount<1||amount>9999||((found.get(result.id)||0)+amount)>9999){unmatched.push(line);continue}
  found.set(result.id,(found.get(result.id)||0)+amount);
 }
 return {lines:[...found].map(([productId,quantity])=>({productId,quantity})),unmatched};
}
function capturedManager(raw){
 const msg=String(raw||'');
 const named=msg.match(/(?:^|\n)\s*(?:From|Manager|Sender)\s*:\s*([^\n]{2,75})/i);
 const header=msg.match(/^\s*\[[^\]]+\]\s*([^:\n]{2,70})\s*:/);
 return (named?.[1]||header?.[1]||'').trim().slice(0,100);
}
function capturePastedOrder(raw){
 const message=String(raw||'').trim();
 if(!message){notify('Paste a WhatsApp order first.',true);return}
 if(message.length>6000){notify('This message is too long. Copy just the order.',true);return}
 const managerInput=document.querySelector('#quick-manager'),phoneInput=document.querySelector('#quick-phone'),siteInput=document.querySelector('#quick-site');
 const manager=(managerInput?.value||'').trim()||capturedManager(message);
 const phone=(phoneInput?.value||'').trim(),site=(siteInput?.value||'').trim();
 ui.captureMeta={manager:managerInput?.value||'',phone,site};
 const duplicate=data.tickets.find(t=>t.source==='manual-whatsapp-paste'&&t.rawMessage===message&&t.manager===(manager||'Manager not specified')&&t.site===site&&Date.now()-Date.parse(t.createdAt)<60000);
 if(duplicate){navigate('orders');ticketDetails(duplicate.id);notify('This message was recently captured. Opened the existing ticket.');return}
 const parsed=parseWhatsApp(message),timestamp=new Date().toISOString();
 const ticketId=`SC-${timestamp.slice(0,10).replace(/-/g,'')}-${String(data.nextTicket++).padStart(4,'0')}`;
 const t={id:ticketId,manager:manager||'Manager not specified',phone,site,rawMessage:message,notes:'',lines:parsed.lines,reviewLines:parsed.unmatched,status:'review',source:'manual-whatsapp-paste',createdAt:timestamp,updatedAt:timestamp};
 data.tickets.unshift(t);save();ui.ticketFilter='All';navigate('orders');ticketDetails(t.id);
 notify(`Ticket ${ticketId} created instantly — check ${parsed.lines.length} matched product(s).`);
}

function draftLineHTML(line,i){return `<div class="line-entry"><select aria-label="Product ${i+1}" class="order-product">${options(line.productId)}</select><input aria-label="Quantity ${i+1}" class="order-qty" type="number" min="1" max="9999" value="${esc(line.quantity)}" required /><button type="button" class="round-btn" data-action="remove-line" data-index="${i}" title="Remove line">×</button></div>`}
function syncDraft(){const rows=[...document.querySelectorAll('#line-host .line-entry')];if(rows.length)ui.draftLines=rows.map(row=>({productId:row.querySelector('.order-product').value,quantity:Number(row.querySelector('.order-qty').value)}));}
function redrawLines(){const host=document.querySelector('#line-host');if(host)host.innerHTML=ui.draftLines.map(draftLineHTML).join('')}
function newOrder(){ui.draftLines=[{productId:PRODUCTS[0].id,quantity:1}];modal(`<form id="order-form"><div class="notice"><strong>Received in normal WhatsApp?</strong>Copy the manager's message from WhatsApp, paste it below, tap Read product lines, then check the quantities. The app cannot access your chats directly.</div><div style="height:13px"></div><div class="form-grid"><div class="field"><label for="order-manager">Manager name *</label><input id="order-manager" required maxlength="100" placeholder="e.g. Site manager" /></div><div class="field"><label for="order-phone">Manager's regular WhatsApp number</label><input id="order-phone" inputmode="tel" placeholder="e.g. +27 82 123 4567" /></div><div class="field full"><label for="order-site">Site / property / department</label><input id="order-site" maxlength="120" placeholder="Where the supplies are needed" /></div></div>
 <div class="field"><label for="order-message">Paste message from normal WhatsApp (optional)</label><textarea id="order-message" placeholder="Example:\n2 x Pine gel 5 L\n1 x Two-stroke oil 500 ml\n3 x Black bags"></textarea><div class="actions">${btn('↳ Read product lines','parse-order','')}</div><small>Matched items are only suggestions. Check all products and quantities before creating the ticket.</small></div><div id="unmatched-lines"></div>
 <div class="section-header"><strong>Order items *</strong>${btn('＋ Add product','add-line','tiny')}</div><div class="line-rows" id="line-host"></div><div class="field" style="margin-top:16px"><label for="order-notes">Notes</label><textarea id="order-notes" style="min-height:68px" maxlength="1500" placeholder="Optional preparation or collection instructions"></textarea></div><div class="modal-actions">${btn('Cancel','close-modal','')}<button type="submit" class="btn primary">Create order ticket</button></div></form>`,'New manager order',true);redrawLines();}
function ticketDetails(id){
 const t=data.tickets.find(x=>x.id===id);if(!t){notify('Ticket not found',true);return}
 const steps=['new','preparing','ready','collected'];const stage=steps.indexOf(t.status);
 const canCollect=t.lines.length>0&&t.lines.every(l=>qty(l.productId)>=l.quantity);
 const unresolved=Array.isArray(t.reviewLines)?t.reviewLines:[];
 modal(`<div class="step-progress" aria-hidden="true">${steps.map((st,i)=>`<span class="${stage>=i?'on':''}"></span>`).join('')}</div><div class="actions" style="justify-content:space-between"><div><strong>${esc(t.id)}</strong><p class="small-muted">${esc(dateFmt(t.createdAt))}</p></div>${statusBadge(t.status)}</div>
 ${t.status==='review'?'<div class="notice warning" style="margin-top:14px"><strong>Ticket saved immediately</strong>This copied WhatsApp request is already in your order queue. Confirm the manager and quantities before preparing or issuing stock.</div>':''}
 <div class="mini-card"><strong>Request from ${esc(t.manager)}</strong>Site: ${esc(t.site||'Not specified')}<br/>WhatsApp: ${esc(t.phone||'Not entered')}${t.notes?`<br/>Notes: ${esc(t.notes)}`:''}</div>
 <div class="section-header"><strong>Products recognised</strong></div><div class="order-detail-lines">${t.lines.map(l=>`<div class="detail-line"><img src="${esc(img(l.productId))}" alt=""/><div class="detail-line-name"><strong>${esc(product(l.productId).name)}</strong><span class="small-muted">${esc(product(l.productId).size)} · available: ${qty(l.productId)}</span></div><strong>× ${l.quantity}</strong></div>`).join('')||'<div class="notice warning">No catalogue products were recognised. Add them manually using Review and confirm.</div>'}</div>
 ${unresolved.length?`<div class="notice warning" style="margin-top:15px"><strong>Text to check — not automatically matched</strong>${unresolved.map(line=>`<div>${esc(line)}</div>`).join('')}</div>`:''}
 ${t.rawMessage?`<details style="margin-top:17px"><summary class="subtitle" style="cursor:pointer">Original WhatsApp message</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px">${esc(t.rawMessage)}</pre></details>`:''}
 ${!canCollect&&['new','preparing','ready'].includes(t.status)?'<div class="notice warning" style="margin-top:15px"><strong>Insufficient stock</strong>Receive missing stock before marking this order collected.</div>':''}
 <div class="section-header"><strong>Ticket actions</strong></div><div class="order-actions">
 ${!['collected','cancelled'].includes(t.status)?btn(t.status==='review'?'✓ Review and confirm ticket':'Edit ticket','review-ticket','dark',`data-id="${esc(t.id)}"`):''}
 ${t.status==='new'?btn('Start preparing','status','dark',`data-id="${esc(t.id)}" data-status="preparing"`):''}
 ${['new','preparing'].includes(t.status)?btn('✓ Ready to collect','status','primary',`data-id="${esc(t.id)}" data-status="ready"`):''}
 ${t.status==='ready'?btn('Mark collected & deduct stock','status','primary',`data-id="${esc(t.id)}" data-status="collected" ${!canCollect?'disabled':''}`):''}
 ${!['cancelled','collected'].includes(t.status)?btn('Cancel ticket','status','danger',`data-id="${esc(t.id)}" data-status="cancelled"`):''}</div>
 <div class="order-actions">
 ${t.status!=='review'&&t.phone?btn('Open WhatsApp: acknowledgement','send-manager','',`data-id="${esc(t.id)}" data-message="ack"`):''}
 ${['ready','collected'].includes(t.status)&&t.phone?btn('Open WhatsApp: ready notice','send-manager','',`data-id="${esc(t.id)}" data-message="ready"`):''}
 ${t.status!=='review'&&data.settings.businessWhatsApp?btn('Open my WhatsApp: ticket copy','send-business','',`data-id="${esc(t.id)}"`):''}
 ${t.status!=='review'?btn('Copy reply text','copy-manager-message','',`data-id="${esc(t.id)}" data-message="${['ready','collected'].includes(t.status)?'ready':'ack'}"`):''}
 ${btn('Print ticket','print-ticket','',`data-id="${esc(t.id)}"`)}
 </div><p class="footer-note">Normal WhatsApp only. Opening a prefilled chat does not send the message; you must check and tap Send yourself.</p>
 <div class="modal-actions">${btn('Close','close-modal','')}</div>`,'Order ticket · '+id,true);
}
function reviewTicket(id){
 const t=data.tickets.find(x=>x.id===id);if(!t||['collected','cancelled'].includes(t.status)){notify('Ticket cannot be edited.',true);return}
 ui.draftLines=t.lines.map(l=>({...l}));
 modal(`<form id="review-ticket-form"><input type="hidden" id="review-ticket-id" value="${esc(t.id)}" />
  <div class="notice"><strong>Confirm this saved ticket</strong>The ticket was created at paste time. Check the sender, products and pack sizes; only then mark it ready for preparation.</div>
  <div class="form-grid" style="margin-top:17px">
   <div class="field"><label for="review-manager">Manager name *</label><input id="review-manager" maxlength="100" required value="${esc(t.manager==='Manager not specified'?'':t.manager)}" /></div>
   <div class="field"><label for="review-phone">Regular WhatsApp number (optional)</label><input id="review-phone" inputmode="tel" value="${esc(t.phone||'')}" /></div>
   <div class="field full"><label for="review-site">Site / property</label><input id="review-site" maxlength="120" value="${esc(t.site||'')}" /></div>
  </div>
  ${Array.isArray(t.reviewLines)&&t.reviewLines.length?`<div class="notice warning"><strong>Unmatched text from original order</strong>${t.reviewLines.map(line=>`<div>${esc(line)}</div>`).join('')}</div>`:''}
  <div class="section-header"><strong>Confirmed products and quantities *</strong>${btn('＋ Add product','add-line','tiny')}</div><div id="line-host" class="line-rows"></div>
  <div class="field" style="margin-top:18px"><label for="review-notes">Notes</label><textarea id="review-notes" maxlength="1500">${esc(t.notes||'')}</textarea></div>
  <details style="margin-top:12px"><summary>Original pasted WhatsApp order</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px">${esc(t.rawMessage||'')}</pre></details>
  <div class="modal-actions">${btn('Back','ticket-detail','',`data-id="${esc(t.id)}"`)}<button class="btn primary" type="submit">Save and confirm ticket</button></div>
 </form>`,'Review ticket · '+id,true);redrawLines();
}
function whatsappPhone(raw){let s=String(raw||'').replace(/\D/g,'');if(s.startsWith('00'))s=s.slice(2);if(s.startsWith('0')&&s.length===10)s='27'+s.slice(1);return /^[1-9]\d{7,14}$/.test(s)?s:null}
function orderSummary(t){return t.lines.map(l=>`${l.quantity} × ${formatLabel(product(l.productId))}`).join('\n')}
function whatsappMessage(t,kind){const name=data.settings.company||'Stock Control';if(kind==='ack')return `Hello ${t.manager}, your stock request has been logged.\nTicket: ${t.id}\n${orderSummary(t)}\nWe will let you know when your order is ready.\n— ${name}`;
 if(kind==='ready')return `Hello ${t.manager}, your stock order is ready for collection.\nTicket: ${t.id}\n${orderSummary(t)}\nPlease arrange collection.\n— ${name}`;
 return `New stock order ticket ${t.id}\nManager: ${t.manager}\nSite: ${t.site||'Not specified'}\n${orderSummary(t)}\nStatus: ${STATUSES[t.status]}`;}
function openWhatsApp(rawPhone,message){const phone=whatsappPhone(rawPhone);if(!phone){notify('Add a valid WhatsApp number in international format.',true);return}window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`,'_blank','noopener,noreferrer');notify('WhatsApp draft opened. Review and tap Send there.');}
function changeStatus(id,status){const t=data.tickets.find(x=>x.id===id);if(!t)return;const allowed={review:['cancelled'],new:['preparing','ready','cancelled'],preparing:['ready','cancelled'],ready:['collected','cancelled'],collected:[],cancelled:[]};if(!allowed[t.status]?.includes(status)){notify('This status change is not allowed.',true);return}
 if(['preparing','ready','collected'].includes(status)&&(t.manager==='Manager not specified'||!t.manager||!t.lines.length)){notify('Confirm the manager and order items first.',true);return}
 if(status==='collected'){
  const totals=new Map();for(const l of t.lines)totals.set(l.productId,(totals.get(l.productId)||0)+l.quantity);
  for(const [pid,q] of totals){if(qty(pid)<q){notify('Not enough stock to hand over '+product(pid).name,true);return}}
  for(const [pid,q] of totals)move(pid,-q,'Order collected',`Issued on ticket ${id}`,id);
 }
 t.status=status;t.updatedAt=new Date().toISOString();save();render();ticketDetails(id);
 if(status==='ready'){notify("Ticket marked ready. Open the manager\'s normal WhatsApp draft and tap Send to notify them.");}
 else notify('Ticket updated to '+STATUSES[status]+'.');
}
function transferDialog(sourceId){const c=CONVERSIONS.find(x=>x.source===sourceId)||CONVERSIONS[0];modal(`<form id="transfer-form"><div class="field"><label for="transfer-type">Conversion</label><select id="transfer-type">${CONVERSIONS.map(x=>`<option value="${x.source}" ${x.source===c.source?'selected':''}>${esc(formatLabel(product(x.source)))} → ${esc(formatLabel(product(x.target)))}</option>`).join('')}</select></div><div class="field"><label for="transfer-count">Number of full large containers</label><input id="transfer-count" type="number" min="1" step="1" value="1" required /></div><div id="transfer-preview" class="notice">${qty(c.source)} available · 1 large container becomes ${c.ratio} smaller containers</div><div class="field" style="margin-top:15px"><label for="transfer-reason">Reference / notes</label><input id="transfer-reason" placeholder="e.g. Repack batch or inventory conversion reference" maxlength="220" required /></div><div class="notice warning">Only record a conversion after the stock has genuinely changed pack size. Follow chemical handling and labelling rules.</div><div class="modal-actions">${btn('Cancel','close-modal','')}<button type="submit" class="btn primary">Record conversion</button></div></form>`,'Convert stock sizes');}
function downloadText(filename,content,type){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function csvCell(v){let x=String(v??'');if(typeof v!=='number'&&/^[\s]*[=+@\-\t\r]/.test(x))x="'"+x;return '"'+x.replace(/"/g,'""')+'"'}
function csvExport(filename,headers,rows){downloadText(filename,'\ufeff'+[headers,...rows].map(r=>r.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8')}
function exportData(type){if(type==='backup')downloadText('stock-control-backup-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(data,null,2),'application/json');
 if(type==='stock')csvExport('stock-balances.csv',['Product','Pack size','Units available','Count unit'],PRODUCTS.map(p=>[p.name,p.size,qty(p.id),p.unit]));
 if(type==='orders')csvExport('order-tickets.csv',['Ticket','Date','Manager','WhatsApp','Site','Products','Status','Notes'],data.tickets.map(t=>[t.id,t.createdAt,t.manager,t.phone,t.site,orderSummary(t).replace(/\n/g,'; '),STATUSES[t.status],t.notes]));
 if(type==='history')csvExport('stock-movements.csv',['Date','Product','Pack size','Movement','Kind','Reason','Ticket'],data.movements.map(m=>[m.at,product(m.productId)?.name,product(m.productId)?.size,m.change,m.kind,m.reason,m.ticketId]));notify('Export downloaded.');}
function printTicket(id){const t=data.tickets.find(x=>x.id===id);if(!t)return;const popup=window.open('','_blank');if(!popup){notify('Allow popups to print the ticket.',true);return}popup.document.write(`<!doctype html><html><head><title>${esc(t.id)}</title><style>body{font:15px Arial;padding:30px;color:#163b30}li{margin:9px 0}</style></head><body><h1>${esc(data.settings.company)}</h1><h2>Order ticket ${esc(t.id)}</h2><p>Manager: ${esc(t.manager)}<br/>Site: ${esc(t.site)}<br/>Date: ${esc(dateFmt(t.createdAt))}<br/>Status: ${esc(STATUSES[t.status])}</p><h3>Products</h3><ul>${t.lines.map(l=>`<li>${l.quantity} × ${esc(formatLabel(product(l.productId)))}</li>`).join('')}</ul><p>${esc(t.notes)}</p><p>Prepared by: _____________________ &nbsp; Collected by: _____________________</p></body></html>`);popup.document.close();popup.focus();popup.print();}
// Event delegation handles all dynamically rendered views and modal controls.
document.addEventListener('click',e=>{
 const view=e.target.closest('[data-view]');if(view){navigate(view.dataset.view);return}
 const b=e.target.closest('[data-action]');if(!b)return;const a=b.dataset.action,id=b.dataset.id;
 switch(a){case 'close-modal':closeModal();break;case 'new-order':newOrder();break;case 'stock-receive':openStock();break;case 'adjust-stock':openStock(id,'adjust');break;
 case 'category':ui.category=b.dataset.category;render();break;case 'ticket-filter':ui.ticketFilter=b.dataset.status;render();break;case 'ticket-detail':ticketDetails(id);break;
 case 'new-transfer':transferDialog(b.dataset.source);break;
 case 'quick-capture':capturePastedOrder(document.querySelector('#quick-paste-message')?.value||'');break;
 case 'review-ticket':reviewTicket(id);break;
 case 'parse-order':{const val=document.querySelector('#order-message').value;const parsed=parseWhatsApp(val);if(parsed.lines.length){ui.draftLines=parsed.lines;redrawLines()}ui.unmatched=parsed.unmatched;document.querySelector('#unmatched-lines').innerHTML=parsed.unmatched.length?`<div class="notice warning"><strong>Could not match these lines</strong>${parsed.unmatched.map(esc).join('<br>')}<br>Please add/check the items manually.</div>`:'';notify(`${parsed.lines.length} product types identified. Review before saving.`);break}
 case 'add-line':syncDraft();ui.draftLines.push({productId:PRODUCTS[0].id,quantity:1});redrawLines();break;
 case 'remove-line':syncDraft();ui.draftLines.splice(Number(b.dataset.index),1);redrawLines();break;
 case 'status':changeStatus(id,b.dataset.status);break;
 case 'send-manager':{const t=data.tickets.find(x=>x.id===id);if(t)openWhatsApp(t.phone,whatsappMessage(t,b.dataset.message));break}
 case 'copy-manager-message':{const t=data.tickets.find(x=>x.id===id);if(!t)break;const message=whatsappMessage(t,b.dataset.message);if(navigator.clipboard?.writeText){navigator.clipboard.writeText(message).then(()=>notify('Reply copied. Paste it into normal WhatsApp and tap Send.')).catch(()=>notify('Clipboard unavailable. Use Open WhatsApp instead.',true))}else notify('Clipboard unavailable. Use Open WhatsApp instead.',true);break}
 case 'send-business':{const t=data.tickets.find(x=>x.id===id);if(t)openWhatsApp(data.settings.businessWhatsApp,whatsappMessage(t,'business'));break}
 case 'print-ticket':printTicket(id);break;
 case 'export-backup':exportData('backup');break;case 'export-stock':exportData('stock');break;case 'export-orders':exportData('orders');break;case 'export-history':exportData('history');break;
 case 'import-backup':document.querySelector('#backup-import').click();break;
 }
});
document.addEventListener('paste',e=>{if(e.target.id!=='quick-paste-message')return;const raw=e.clipboardData?.getData('text/plain');if(!raw?.trim())return;e.preventDefault();e.target.value=raw;capturePastedOrder(raw);});
document.addEventListener('input',e=>{if(e.target.id==='quick-paste-message'&&e.inputType==='insertFromPaste'&&e.target.value.trim()){capturePastedOrder(e.target.value);return}if(e.target.id==='inventory-search'){const start=e.target.selectionStart;ui.search=e.target.value;render();let input=document.querySelector('#inventory-search');input.focus();input.setSelectionRange(start,start)}});
document.addEventListener('change',e=>{
 if(e.target.id==='stock-product'){let p=product(e.target.value);document.querySelector('#stock-current').textContent=`${qty(p.id)} ${p.unit}`;}
 if(e.target.id==='transfer-type'){let c=CONVERSIONS.find(x=>x.source===e.target.value);document.querySelector('#transfer-preview').textContent=`${qty(c.source)} available · 1 large container becomes ${c.ratio} smaller containers`;}
});
document.addEventListener('submit',e=>{
 if(!['stock-form','order-form','transfer-form','settings-form','review-ticket-form'].includes(e.target.id))return;e.preventDefault();const form=e.target.id;
 if(form==='review-ticket-form'){
  syncDraft();const id=document.querySelector('#review-ticket-id').value;const t=data.tickets.find(x=>x.id===id);
  if(!t||['cancelled','collected'].includes(t.status)){notify('Ticket cannot be edited.',true);return}
  const manager=document.querySelector('#review-manager').value.trim(),phone=document.querySelector('#review-phone').value.trim(),site=document.querySelector('#review-site').value.trim(),notes=document.querySelector('#review-notes').value.trim();
  if(!manager||manager==='Manager not specified'){notify('Enter the manager name.',true);return}
  if(phone&&!whatsappPhone(phone)){notify('Correct the WhatsApp number or leave it blank.',true);return}
  if(!ui.draftLines.length||ui.draftLines.some(l=>!product(l.productId)||!Number.isSafeInteger(l.quantity)||l.quantity<1||l.quantity>9999)){notify('Add at least one valid product with a whole quantity.',true);return}
  const combined=new Map();for(const l of ui.draftLines)combined.set(l.productId,(combined.get(l.productId)||0)+l.quantity);
  if([...combined.values()].some(n=>n>9999)){notify('Total quantity per product cannot exceed 9999.',true);return}
  t.manager=manager;t.phone=phone;t.site=site;t.notes=notes;t.lines=[...combined].map(([productId,quantity])=>({productId,quantity}));t.reviewLines=[];t.reviewedAt=new Date().toISOString();t.updatedAt=t.reviewedAt;if(t.status==='review')t.status='new';
  save();render();ticketDetails(id);notify('Ticket confirmed. You can now prepare the order.');return;
 }
 if(form==='settings-form'){const threshold=Number(document.querySelector('#low-threshold').value);if(!Number.isSafeInteger(threshold)||threshold<0){notify('Alert threshold must be a whole number.',true);return}data.settings={company:document.querySelector('#company').value.trim()||'Stock Control',businessWhatsApp:document.querySelector('#business-number').value.trim(),lowThreshold:threshold};save();render();notify('Settings saved on this device.');return}
 if(form==='stock-form'){const id=document.querySelector('#stock-product').value,mode=document.querySelector('#stock-operation').value,amount=Number(document.querySelector('#stock-quantity').value),reason=document.querySelector('#stock-reason').value.trim();if(!Number.isSafeInteger(amount)||amount<0||amount>1000000||!reason){notify('Enter a valid quantity and reason.',true);return}let change=mode==='in'?amount:mode==='out'?-amount:amount-qty(id);if(mode!=='count'&&amount===0){notify('Quantity must be greater than zero.',true);return}if(qty(id)+change<0){notify('Cannot remove more than is available.',true);return}move(id,change,mode==='count'?'Stock count':mode==='in'?'Received':'Written off',reason);save();closeModal();render();notify('Stock balance updated.');return}
 if(form==='transfer-form'){let c=CONVERSIONS.find(x=>x.source===document.querySelector('#transfer-type').value);const count=Number(document.querySelector('#transfer-count').value),reason=document.querySelector('#transfer-reason').value.trim();if(!c||!Number.isSafeInteger(count)||count<=0||count>100000||!reason){notify('Enter a valid whole-container count and reference.',true);return}if(qty(c.source)<count){notify('Not enough source containers are available.',true);return}move(c.source,-count,'Conversion out',reason);move(c.target,count*c.ratio,'Conversion in',reason);save();closeModal();render();notify(`${count} bulk container(s) converted into ${count*c.ratio} small units.`);return}
 if(form==='order-form'){syncDraft();const manager=document.querySelector('#order-manager').value.trim(),phone=document.querySelector('#order-phone').value.trim(),site=document.querySelector('#order-site').value.trim(),rawMessage=document.querySelector('#order-message').value.trim(),notes=document.querySelector('#order-notes').value.trim();if(!manager||!ui.draftLines.length||ui.draftLines.some(l=>!product(l.productId)||!Number.isSafeInteger(l.quantity)||l.quantity<1||l.quantity>9999)){notify('Enter a manager and one or more valid product quantities.',true);return}if(phone&&!whatsappPhone(phone)){notify('Use a valid WhatsApp number, or leave the field empty.',true);return}const combined=new Map();ui.draftLines.forEach(l=>combined.set(l.productId,(combined.get(l.productId)||0)+l.quantity));let lines=[...combined].map(([productId,quantity])=>({productId,quantity}));const ticketId=`SC-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(data.nextTicket++).padStart(4,'0')}`;data.tickets.unshift({id:ticketId,manager,phone,site,rawMessage,notes,lines,status:'new',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});save();closeModal();navigate('orders');ticketDetails(ticketId);notify(`Ticket ${ticketId} created. Open normal WhatsApp and tap Send to share ticket updates.`);return}
});
document.querySelector('#backup-import').addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;try{const imported=JSON.parse(await f.text());if(!validateData(imported)||PRODUCTS.some(p=>!Number.isSafeInteger(imported.counts[p.id])||imported.counts[p.id]<0)||imported.tickets.some(t=>!Array.isArray(t.lines)||t.lines.some(l=>!product(l.productId)||!Number.isSafeInteger(l.quantity)||l.quantity<1))){throw Error('Invalid backup schema')}
 if(!confirm('Restore this backup? It will replace all tickets, stock counts and history on this device.'))return;data=imported;save();navigate('dashboard');notify('Backup successfully restored.');}catch(err){notify('This is not a valid Stock Control backup.',true)}finally{e.target.value=''}});
document.querySelector('#menu-toggle').addEventListener('click',()=>document.querySelector('#sidebar').classList.toggle('open'));
document.querySelector('#today-date').textContent=new Date().toLocaleDateString('en-ZA',{weekday:'short',day:'numeric',month:'long',year:'numeric'});
if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(e=>console.warn('Offline mode unavailable',e));
render();

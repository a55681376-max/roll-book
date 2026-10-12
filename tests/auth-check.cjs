const fs = require('fs'), vm = require('vm'), assert = require('assert/strict');
const html=fs.readFileSync('index.html','utf8');
const code=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
const nodes=new Map();
function node(id='') { if(nodes.has(id)) return nodes.get(id); const classes=new Set(); const n={id,value:'',style:{},textContent:'',innerHTML:'',classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle:(x,v)=>{v??=!classes.has(x);v?classes.add(x):classes.delete(x);}},focus(){},appendChild(){},getAttribute(){return '';},getContext(){return new Proxy({}, {get:()=>()=>{}});},toDataURL(){return 'data:image/png;base64,test';}};nodes.set(id,n);return n; }
const tabs=['Program','Participants','Attendance','Print','Master'].map(x=>node('subtabBtn'+x));
const panels=['entryView','kioskView','adminView'].map(node);
const ctx={console,setTimeout:()=>0,clearTimeout(){},alert:()=>{},confirm:()=>true,window:{addEventListener(){}},document:{getElementById:node,createElement:()=>node(),querySelectorAll:q=>q==='.admin-subtab-btn'?tabs:q.includes('.view-panel')?panels.filter(n=>!q.includes(':not')||n.id!=='entryView'):[]},localStorage:{getItem:()=>null,setItem(){}},Date};
vm.createContext(ctx); vm.runInContext(code,ctx);
vm.runInContext(`
 appData=JSON.parse(JSON.stringify(DEFAULT_DATA));
 renderKioskGrid=()=>{}; renderAdminProgramSubtab=()=>{}; renderAdminAccountsTable=()=>{};
 function login(type,user,pw,destination='attendance') {openAdminLoginModal(type,destination);document.getElementById('adminUsernameInput').value=user;document.getElementById('adminPasswordInput').value=pw;handleAdminLogin({preventDefault(){}});}
`,ctx);
function run(x){return vm.runInContext(x,ctx);}
run('showEntryScreen()'); assert.equal(run('currentRole'),'entry');
run("login('general','admin','wrong')");assert.equal(run('currentRole'),'entry');
run("login('general','admin','1234')");assert.equal(run('currentRole'),'kiosk');assert.equal(run('isAdminLoggedIn'),false);
run('tryEnterAdminMode()');assert.equal(node('adminLoginModal').classList.contains('hidden'),false);
run("login('general','admin','1234','management')");assert.equal(run('currentRole'),'admin');assert.equal(run('currentAdminTab'),'program');
run("switchAdminTab('master')");assert.equal(run('currentAdminTab'),'program');
run("switchRole('kiosk')");assert.equal(run('isAdminLoggedIn'),false);
run("switchRole('admin')");assert.equal(run('currentRole'),'kiosk');
run("showEntryScreen();login('master','master','master1234')");assert.equal(run('currentAdminTab'),'master');
assert.equal(tabs[0].style.display,'none'); assert.equal(tabs[4].style.display,'inline-block');
node('masterUsernameInput').value='master2';node('masterCurrentPasswordInput').value='wrong';node('masterPasswordInput').value='new-pass';node('masterConfirmPasswordInput').value='new-pass';
run('saveMasterAccountSettings({preventDefault(){}})');assert.equal(run('appData.masterAccount.username'),'master');
node('masterCurrentPasswordInput').value='master1234';run('saveMasterAccountSettings({preventDefault(){}})');assert.equal(run('appData.masterAccount.username'),'master2');
run("logoutAdmin();login('master','master','master1234')");assert.equal(run('currentRole'),'entry');
run("login('master','master2','new-pass')");assert.equal(run('currentRole'),'admin');
node('editAdminIndex').value='-1';node('accUsernameInput').value='staff2';node('accPasswordInput').value='staff-pass';node('accNameInput').value='미술 담당';
run('saveAdminAccount({preventDefault(){}})');assert.equal(run("appData.generalAdmins.find(a=>a.username==='staff2').memo"),'미술 담당');
run("logoutAdmin();login('general','staff2','staff-pass')");assert.equal(run('currentRole'),'kiosk');
assert.equal(run('appData.programs.length'),1);
run("appData=normalizeAccountData({adminPassword:'legacy-secret',programs:[{id:'kept'}]});showEntryScreen();login('master','master','master1234')");
assert.equal(run('currentRole'),'admin');
run("logoutAdmin();login('general','admin','1234')");assert.equal(run('currentRole'),'entry');
run("login('general','admin','legacy-secret')");assert.equal(run('currentRole'),'kiosk');
assert.equal(run('appData.programs[0].id'),'kept');
run("appData=normalizeAccountData({masterAccount:{username:'changed',password:'custom'},generalAdmins:[],adminPassword:'legacy-secret'});showEntryScreen();login('general','admin','legacy-secret')");
assert.equal(run('currentRole'),'entry');assert.equal(run('appData.generalAdmins.length'),0);
assert.equal(run('appData.masterAccount.username'),'changed');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
assert(!html.includes('키오스크'));assert(!html.includes('일반 관리자'));assert(!html.includes('직원 (관리자)'));
console.log('PASS: entry, invalid login, attendance, repeated authentication, role separation, account change, staff registration, data retention, unique IDs, terminology');

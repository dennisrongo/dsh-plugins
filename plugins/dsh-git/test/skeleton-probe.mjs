
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = Number(process.env.CDP_PORT ?? 39371)
const bundle = readFileSync('lib/client.js', 'utf8')
const s = bundle.indexOf('.dshgit {')
const e = bundle.indexOf(String.fromCharCode(96), s)
const css = bundle.slice(s, e)
if (!css.includes('dshgit-skel-bar')) throw new Error('bundle css missing skeleton')

const KINDS = ['meta','meta','hunk','','add','add','','del','','add','','']
const W = [42,34,26,68,54,76,47,61,72,39,58,44]
let skel = ''
for (let i=0;i<KINDS.length;i++) skel += '<div class="dshgit-skel-line ' + KINDS[i] + '" id="s'+i+'"><span class="dshgit-skel-bar" style="width:'+W[i]+'%;animation-delay:'+(i*70)+'ms"></span></div>'

const html = '<!doctype html><meta charset=utf-8><style>' +
  'html,body{margin:0;height:100%;background:#111}#host{height:100vh;display:flex;flex-direction:column}' + css + '</style>' +
  '<div id=host><div class="dshgit"><div class="dshgit-panes hasdiff">' +
  '<div class="dshgit-scroll"><ul class="dshgit-list"><li class="dshgit-row">a.ts</li></ul></div>' +
  '<div class="dshgit-diff">' +
    '<div class="dshgit-diffhead" id="head">a.ts</div>' +
    '<div class="dshgit-skel" id="skel">' + skel + '</div>' +
    '<pre class="dshgit-diffbody" id="body"><div class="dshgit-dl meta" id="real0">--- a/x</div><div class="dshgit-dl add" id="real1">+ added</div></pre>' +
  '</div></div></div></div>'

const dir = mkdtempSync(join(tmpdir(),'dshgit-skel-'))
const page = join(dir,'p.html'); writeFileSync(page, html)
const profile = mkdtempSync(join(tmpdir(),'dshgit-cdp-'))
const chrome = spawn(CHROME,['--headless=new','--remote-debugging-port='+PORT,'--user-data-dir='+profile,'--no-first-run','--no-default-browser-check','--disable-gpu','about:blank'],{stdio:'ignore'})
async function waitForCdp(){for(let i=0;i<80;i++){try{const r=await fetch('http://127.0.0.1:'+PORT+'/json/version');if(r.ok)return await r.json()}catch{}await new Promise(r=>setTimeout(r,250))}throw new Error('no cdp')}
const v = await waitForCdp(); const ws = new WebSocket(v.webSocketDebuggerUrl)
await new Promise(r=>ws.addEventListener('open',r,{once:true}))
let id=1; const pending=new Map()
ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id)}})
const send=(method,params={},sid)=>{const i=id++;return new Promise(res=>{pending.set(i,res);ws.send(JSON.stringify({id:i,method,params,sessionId:sid}))})}
const {result:t}=await send('Target.createTarget',{url:'about:blank'})
const {result:att}=await send('Target.attachToTarget',{targetId:t.targetId,flatten:true}); const sid=att.sessionId
await send('Page.enable',{},sid); await send('Runtime.enable',{},sid)
await send('Emulation.setDeviceMetricsOverride',{width:1200,height:800,deviceScaleFactor:1,mobile:false},sid)
await send('Page.navigate',{url:'file:///'+page.replace(/\\/g,'/')},sid)
await new Promise(r=>setTimeout(r,600))
const EXPR='(()=>{const R=id=>{const el=document.getElementById(id);const b=el.getBoundingClientRect();return{h:Math.round(b.height*10)/10,w:Math.round(b.width)}};' +
 'const bar=document.querySelector(".dshgit-skel-bar");const bs=getComputedStyle(bar);const br=bar.getBoundingClientRect();' +
 'const sk=getComputedStyle(document.getElementById("skel"));const bd=getComputedStyle(document.getElementById("body"));' +
 'const anim=bar.getAnimations().map(a=>a.animationName||"");' +
 'const barX=Math.round(br.x);' +
 'const rng=document.createRange();const rn=document.getElementById("real0").firstChild;rng.setStart(rn,0);rng.setEnd(rn,1);' +
 'const textX=Math.round(rng.getBoundingClientRect().x);' +
 'return JSON.stringify({barX,textX,skelLine:R("s0"),realLine:R("real0"),barH:Math.round(br.height*10)/10,' +
 'skelPad:sk.padding,bodyPad:bd.padding,linePad:getComputedStyle(document.getElementById("s0")).padding,' +
 'realPad:getComputedStyle(document.getElementById("real0")).padding,anim,animCount:bar.getAnimations().length,' +
 'skelW:R("skel").w,bodyW:R("body").w});})()'
const {result}=await send('Runtime.evaluate',{expression:EXPR,returnByValue:true},sid)
const d=JSON.parse(result.result.value)
console.log(JSON.stringify(d,null,2))
const fail=[]
if (d.skelLine.h !== d.realLine.h) fail.push('skeleton line height '+d.skelLine.h+' != real diff line '+d.realLine.h)
// Real lines use padding-left 32px with text-indent -12px; the skeleton has no
// text to indent, so 20px is the equivalent. Compare the RESULTING x, not the
// padding string.
if (d.barX !== d.textX) fail.push('bar starts at x='+d.barX+' but real diff text starts at x='+d.textX)
if (d.skelPad !== d.bodyPad) fail.push('skeleton container padding '+d.skelPad+' != body '+d.bodyPad)
if (d.barH !== 10) fail.push('bar height '+d.barH+' != 10px')
if (d.animCount < 1) fail.push('shimmer animation not running')
ws.close(); chrome.kill(); await new Promise(r=>setTimeout(r,300))
for(const p of [dir,profile]){try{rmSync(p,{recursive:true,force:true,maxRetries:5,retryDelay:150})}catch{}}
if(fail.length){console.log('');console.log('FAIL:');for(const f of fail)console.log('  x '+f);process.exit(1)}
console.log('');console.log('  ok  skeleton rows match the real diff line box exactly');console.log('  ok  bars align with the real diff text gutter');console.log('  ok  shimmer animation is running');
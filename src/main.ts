import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { OnlineSession } from './network/session';
import { addBot, applyAction, currentDrafter, removeBot } from './game/engine';
import type { GameAction, GameView } from './game/types';
import { quickRules, renderGame, type Locale } from './ui/render';
import { TrackScene } from './three/trackScene';

const app=document.querySelector<HTMLElement>('#app')!;
const session=new OnlineSession();
let currentView:GameView|null=null;
let scene:TrackScene|null=null;
let sceneCanvas:HTMLCanvasElement|null=null;
let status='';
let botTimer:number|undefined;
let effectTimer:number|undefined;
let revealTimer:number|undefined;
let motionTimer:number|undefined;
let locale=(localStorage.getItem('ma-locale')==='en'?'en':'zh') as Locale;
let settingsOpen=false;
let logOpen=false;
let rollFxUntil=0;
let lastSeenRollSeq=0;
let revealUntil=0;
let revealIndex=0;
let updateReady=false;

const updateSW=registerSW({
  immediate:true,
  onNeedRefresh(){updateReady=true;if(!currentView)void updateSW(true);else{status=txt('发现新版本，返回首页后会自动更新。','A new version is ready and will update from the home screen.');render();}}
});

session.onState=view=>{
  const previous=currentView;
  currentView=view;
  if(view.rollSeq>lastSeenRollSeq){
    lastSeenRollSeq=view.rollSeq;
    rollFxUntil=performance.now()+1050;
    clearTimeout(effectTimer);
    effectTimer=window.setTimeout(()=>render(),1080);
  }
  if(previous?.phase==='select'&&view.phase==='race')startReveal(view);
  render();
  scheduleBots();
};
session.onStatus=(text,error)=>{
  status=localizeNetworkText(text);
  render();
  if(!error)setTimeout(()=>{if(status===localizeNetworkText(text)){status='';render();}},2400);
};

renderLanding();

function renderLanding(error=''){
  scene?.destroy();scene=null;sceneCanvas=null;currentView=null;
  clearTimeout(revealTimer);clearTimeout(effectTimer);clearTimeout(motionTimer);
  const room=new URLSearchParams(location.search).get('room')?.toUpperCase()??'';
  const remembered=localStorage.getItem('ma-player-name')??'';
  app.innerHTML=`<main class="join-page">
    <div class="landing-tools"><div class="language-switch"><button data-language="zh" class="${locale==='zh'?'active':''}">中文</button><button data-language="en" class="${locale==='en'?'active':''}">EN</button></div></div>
    <section class="join-layout">
      <div class="join-card">
        <div class="join-logo"><span class="brand-dot"></span>${txt('2–4 人线上桌游','ONLINE BOARD GAME · 2–4')}</div>
        <h1>${txt('魔法','MAGICAL')}<br><span>${txt('运动会','ATHLETE')}</span></h1>
        <p>${txt('选秀一支古怪跑团，投骰、触发能力并跑完四场越来越值钱的比赛。支持真人与 AI 混合开房，无需账号。','Draft a team of oddball racers, roll the dice, trigger wild powers, and race through four increasingly valuable events. Mix human players and AI—no account needed.')}</p>
        <form class="form-stack" id="join-form">
          <label for="name">${txt('你的名字','Your name')}</label>
          <input id="name" maxlength="16" placeholder="${txt('例如：小魔王','e.g. Tiny Wizard')}" value="${escapeAttr(remembered)}" autocomplete="nickname">
          <label for="room">${txt('房间码','Room code')}</label>
          <input id="room" maxlength="6" placeholder="${txt('加入时填写 6 位房间码','Enter the 6-character code to join')}" value="${escapeAttr(room)}" autocapitalize="characters">
          <div class="error-text">${escapeHtml(error)}</div>
          <div class="split-actions"><button class="btn primary" type="button" id="host">${txt('创建房间','Create room')}</button><button class="btn secondary" type="submit">${txt('加入房间','Join room')}</button></div>
        </form>
        <div class="network-note">${txt('免费测试联机：玩家之间点对点同步；房主页面需要保持在线。','Free test multiplayer uses peer-to-peer sync; the host page must stay online.')}</div>
      </div>
      <aside class="landing-rules"><span class="eyebrow">${txt('第一次玩吗？','FIRST GAME?')}</span><h2>${txt('一分钟就能开跑','Start racing in one minute')}</h2>${quickRules(locale)}</aside>
    </section>
  </main>`;
  document.querySelectorAll<HTMLElement>('[data-language]').forEach(x=>x.onclick=()=>setLocale(x.dataset.language as Locale));
  const name=document.querySelector<HTMLInputElement>('#name')!;
  const roomInput=document.querySelector<HTMLInputElement>('#room')!;
  document.querySelector('#host')!.addEventListener('click',async()=>{
    if(!name.value.trim()){renderLanding(txt('请先填写名字','Please enter your name'));return;}
    setBusy(true);
    try{remember(name.value);await session.host(name.value.trim());history.replaceState(null,'',`${location.pathname}?room=${session.state!.roomCode}`);}
    catch(e){renderLanding(message(e));}
  });
  document.querySelector('#join-form')!.addEventListener('submit',async e=>{
    e.preventDefault();
    if(!name.value.trim()||roomInput.value.trim().length!==6){renderLanding(txt('请填写名字和 6 位房间码','Enter your name and a 6-character room code'));return;}
    setBusy(true);
    try{remember(name.value);await session.join(roomInput.value.trim(),name.value.trim());history.replaceState(null,'',`${location.pathname}?room=${roomInput.value.trim().toUpperCase()}`);}
    catch(err){renderLanding(message(err));}
  });
  function setBusy(b:boolean){document.querySelectorAll<HTMLButtonElement>('button').forEach(x=>x.disabled=b);document.querySelector('.error-text')!.textContent=b?txt('正在建立联机通道…','Opening the multiplayer connection…'):'';}
}

function render(){
  if(!currentView)return;
  if(scene)scene.update(currentView,locale);
  const pendingMotion=scene?.getPendingAnimationMs()??0;
  const revealActive=performance.now()<revealUntil;
  const rollActive=performance.now()<rollFxUntil;
  clearTimeout(motionTimer);
  if(pendingMotion>20)motionTimer=window.setTimeout(()=>render(),pendingMotion+40);
  const preservedCanvas=sceneCanvas;
  renderGame(app,currentView,{dispatch,copyInvite,addBot:addAi,removeBot:removeAi,leave,openSettings:()=>{settingsOpen=true;render();},closeSettings:()=>{settingsOpen=false;render();},setLocale,toggleLog:()=>{logOpen=!logOpen;render();}},{locale,settingsOpen,logOpen,showRollFx:rollActive,showReveal:revealActive,revealIndex,motionLocked:revealActive||rollActive||pendingMotion>20},status);
  const placeholder=document.querySelector<HTMLCanvasElement>('#track-canvas');
  if(placeholder&&scene&&preservedCanvas){
    placeholder.replaceWith(preservedCanvas);
    sceneCanvas=preservedCanvas;
    scene.update(currentView,locale);
    scene.resizeNow();
  }else if(placeholder){
    scene?.destroy();
    sceneCanvas=placeholder;
    scene=new TrackScene(placeholder,locale);
    scene.update(currentView,locale);
  }else{
    scene?.destroy();scene=null;sceneCanvas=null;
  }
}

function startReveal(view:GameView){
  clearTimeout(revealTimer);
  revealIndex=0;
  const perCard=900;
  revealUntil=performance.now()+view.racers.length*perCard+650;
  const advance=()=>{
    if(performance.now()>=revealUntil){render();scheduleBots();return;}
    revealIndex=(revealIndex+1)%view.racers.length;
    render();
    revealTimer=window.setTimeout(advance,perCard);
  };
  revealTimer=window.setTimeout(advance,perCard);
}

function dispatch(action:GameAction){session.dispatch(action);}
function copyInvite(){
  if(!currentView)return;
  const url=`${location.origin}${location.pathname}?room=${currentView.roomCode}`;
  navigator.clipboard?.writeText(url).then(()=>{status=txt('邀请链接已复制','Invite link copied');render();}).catch(()=>{status=`${txt('房间码','Room code')}：${currentView!.roomCode}`;render();});
}
function addAi(){if(!session.isHost||!session.state)return;session.replaceHostState(addBot(session.state));}
function removeAi(){if(!session.isHost||!session.state)return;session.replaceHostState(removeBot(session.state));}
function leave(){clearTimeout(botTimer);clearTimeout(revealTimer);clearTimeout(effectTimer);clearTimeout(motionTimer);session.close();history.replaceState(null,'',location.pathname);if(updateReady)void updateSW(true);else renderLanding();}

function scheduleBots(){
  clearTimeout(botTimer);
  if(!session.isHost||!session.state||!session.state.demoMode)return;
  const s=session.state;
  let botId:string|undefined;
  if(s.phase==='draft'){
    const drafter=currentDrafter(s);
    botId=s.players.find(p=>p.id===drafter&&p.isBot)?.id;
  }else if(s.phase==='select')botId=s.players.find(p=>p.isBot&&!s.selected[p.id])?.id;
  else if(s.phase==='race')botId=s.players.find(p=>p.id===s.turnPlayerId&&p.isBot)?.id;
  if(!botId)return;
  const revealDelay=Math.max(0,revealUntil-performance.now());
  const movementDelay=scene?.getPendingAnimationMs()??0;
  const delay=Math.max(850,revealDelay+350,movementDelay+450);
  botTimer=window.setTimeout(()=>takeBotAction(botId!),delay);
}

function takeBotAction(botId:string){
  if(!session.isHost||!session.state)return;
  const s=session.state;
  const bot=s.players.find(p=>p.id===botId&&p.isBot);
  if(!bot)return;
  let action:GameAction|undefined;
  if(s.phase==='draft'&&currentDrafter(s)===botId)action={type:'DRAFT',racerId:s.draftPool[0]};
  else if(s.phase==='select'&&!s.selected[botId]){const available=bot.hand.filter(id=>!bot.used.includes(id));action={type:'SELECT_RACER',racerId:available[Math.floor(Math.random()*available.length)]};}
  else if(s.phase==='race'&&s.turnPlayerId===botId){
    if(s.pendingDecision?.playerId===botId){const opts=s.pendingDecision.options;action={type:'DECIDE',value:opts[Math.floor(Math.random()*opts.length)].value};}
    else action={type:'ROLL'};
  }
  if(action)session.replaceHostState(applyAction(s,botId,action));
}

function setLocale(next:Locale){
  locale=next;
  settingsOpen=false;
  localStorage.setItem('ma-locale',next);
  if(currentView)render();else renderLanding();
}
function remember(name:string){localStorage.setItem('ma-player-name',name.trim());}
function message(e:unknown){return e instanceof Error?localizeNetworkText(e.message):txt('连接失败，请稍后重试','Connection failed. Please try again.');}
function txt(zh:string,en:string){return locale==='zh'?zh:en;}
function localizeNetworkText(text:string){
  if(locale==='zh')return text;
  if(text.startsWith('房间 ')&&text.endsWith(' 已创建'))return `Room ${text.slice(3,-4)} created`;
  if(text.startsWith('已连接房间 '))return `Connected to room ${text.slice(6)}`;
  const exact:Record<string,string>={'一名选手正在加入…':'A player is joining…','与房主的连接已断开，可刷新后重新加入':'Disconnected from the host. Refresh to rejoin.','联机通道发生错误':'The multiplayer connection failed.','连接信令服务器超时':'Connection setup timed out.','找不到该房间，请检查房间码':'Room not found. Check the code.','这个房间码正在使用，请重试':'That room code is in use. Try again.','找不到房间，请确认房主在线':'Room not found. Make sure the host is online.','网络连接失败，请检查网络':'Network connection failed.','信令连接有波动，正在恢复…':'Signaling connection fluctuated; reconnecting…','信令连接有波动，当前对局仍可继续':'Signaling fluctuated; the current match can continue.'};
  return exact[text]??text;
}
function escapeHtml(s:string){return s.replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]!));}
function escapeAttr(s:string){return escapeHtml(s);}

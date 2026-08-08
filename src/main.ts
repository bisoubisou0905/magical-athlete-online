import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { OnlineSession } from './network/session';
import { addBot, applyAction, currentDrafter, getFinishChance, removeBot, selectionComplete, type FinishChance } from './game/engine';
import type { GameAction, GameView, LogEntry } from './game/types';
import { quickRules, renderGame, type DiceGesture, type Locale } from './ui/render';
import { TrackScene } from './three/trackScene';
import { FinishDramaAudio } from './audio/finishDramaAudio';

const app=document.querySelector<HTMLElement>('#app')!;
const session=new OnlineSession();
let currentView:GameView|null=null;
let scene:TrackScene|null=null;
let sceneCanvas:HTMLCanvasElement|null=null;
let status='';
let botTimer:number|undefined;
let rollTimer:number|undefined;
let eventTimer:number|undefined;
let eventPumpTimer:number|undefined;
let revealTimer:number|undefined;
let revealTickTimer:number|undefined;
let motionTimer:number|undefined;
let autoAssistTimer:number|undefined;
let locale=(localStorage.getItem('ma-locale')==='en'?'en':'zh') as Locale;
let soundEnabled=localStorage.getItem('ma-sound')!=='off';
let autoAdvance=localStorage.getItem('ma-auto-advance')==='on';
let settingsOpen=false;
let logOpen=false;
let rollFxUntil=0;
let lastSeenRollSeq=0;
let revealUntil=0;
let revealIndex=0;
let revealActive=false;
let inspectRacerId:string|null=null;
let inspectSpace:number|null=null;
let updateReady=false;
let activeEffect:LogEntry|null=null;
let effectQueue:LogEntry[]=[];
let effectUntil=0;
let effectSequenceStep=0;
let effectSequenceTotal=0;
let lastSeenLogId=0;
let diceGesture:DiceGesture={x:28,y:-90,power:.75,twist:-150};
let pendingLocalGesture=false;
let settlingRacerId:string|null=null;
let presentationUntil=0;
let finishDrama:FinishChance|null=null;
let cameraMoved=false;
const finishAudio=new FinishDramaAudio(soundEnabled);
const EFFECT_DISPLAY_MIN_MS=820;
const EFFECT_DISPLAY_MAX_MS=1080;
const EFFECT_GAP_MS=90;
const NORMAL_ROLL_MS=1050;
const FINISH_ROLL_MS=2350;
const NORMAL_MOVE_DELAY=680;
const FINISH_MOVE_DELAY=1850;

window.addEventListener('pointerdown',()=>{if(soundEnabled)void finishAudio.unlock();},{capture:true});

const updateSW=registerSW({
  immediate:true,
  onNeedRefresh(){updateReady=true;if(!currentView)void updateSW(true);else{status=txt('发现新版本，返回首页后会自动更新。','A new version is ready and will update from the home screen.');render();}}
});

session.onState=view=>{
  const previous=currentView;
  if(!previous&&view.phase==='race')lastSeenLogId=view.logs.at(-1)?.id??0;
  const newRoll=view.rollSeq>lastSeenRollSeq;
  const forecast=newRoll&&previous?getFinishChance(previous,previous.turnRacerId):null;
  currentView=view;
  if(newRoll){
    if(!pendingLocalGesture||view.lastRollPlayerId!==view.viewerId)diceGesture=defaultDiceGesture(view.rollSeq,view.lastRoll??1);
    pendingLocalGesture=false;
    lastSeenRollSeq=view.rollSeq;
    finishDrama=forecast?.possible?forecast:null;
    const rollDuration=finishDrama?FINISH_ROLL_MS:NORMAL_ROLL_MS;
    const moveDelay=finishDrama?FINISH_MOVE_DELAY:NORMAL_MOVE_DELAY;
    rollFxUntil=performance.now()+rollDuration;
    settlingRacerId=view.lastRollRacerId;
    const before=previous?.racers.find(r=>r.id===view.lastRollRacerId)?.position;
    const after=view.racers.find(r=>r.id===view.lastRollRacerId)?.position;
    const moved=before===undefined||after===undefined?0:Math.abs(after-before);
    presentationUntil=performance.now()+Math.max(rollDuration,moveDelay+moved*205+250);
    if(finishDrama){
      const rolledRacer=view.racers.find(r=>r.id===view.lastRollRacerId);
      const outcome=rolledRacer?.finished?'success':finishDrama.successfulRolls.includes(view.lastRoll??0)?'chance':'miss';
      finishAudio.play(outcome);
    }
    clearTimeout(rollTimer);
    rollTimer=window.setTimeout(()=>{render();pumpEffectQueue();},rollDuration+30);
  }
  const freshEffect=view.logs.find(log=>log.id>lastSeenLogId&&log.sourceRacerId&&log.effectKind&&log.effectKind!=='move');
  if(freshEffect&&!settlingRacerId){settlingRacerId=previous?.turnRacerId??freshEffect.sourceRacerId??null;presentationUntil=performance.now()+EFFECT_DISPLAY_MIN_MS;}
  queueEffectEvents(view);
  if(previous?.phase==='select'&&view.phase==='race')startReveal(view);
  render();
  scheduleAutomaticAssist(view);
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
  clearTimeout(revealTimer);clearInterval(revealTickTimer);clearTimeout(rollTimer);clearTimeout(eventTimer);clearTimeout(eventPumpTimer);clearTimeout(motionTimer);clearTimeout(autoAssistTimer);
  activeEffect=null;effectQueue=[];effectUntil=0;effectSequenceStep=0;effectSequenceTotal=0;lastSeenLogId=0;settlingRacerId=null;presentationUntil=0;finishDrama=null;cameraMoved=false;revealActive=false;inspectRacerId=null;inspectSpace=null;
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
  const showingReveal=revealActive;
  const rollActive=performance.now()<rollFxUntil;
  const finishDramaActive=rollActive&&Boolean(finishDrama);
  const previousPendingMotion=scene?.getPendingAnimationMs()??0;
  const keepSettlingActor=performance.now()<presentationUntil||rollActive||previousPendingMotion>20||Boolean(activeEffect)||effectQueue.length>0||Boolean(currentView.presentationGate);
  if(!keepSettlingActor)settlingRacerId=null;
  const presentedRacerId=(keepSettlingActor?settlingRacerId:null)??currentView.turnRacerId;
  const movementStartDelay=finishDramaActive?FINISH_MOVE_DELAY:NORMAL_MOVE_DELAY;
  const heldMovementRacerId=currentView.presentationGate?.racerId??null;
  const heldMovementKind=currentView.presentationGate?.kind??null;
  if(scene)scene.update(currentView,locale,presentedRacerId,activeEffect?.sourceRacerId,activeEffect?.targetRacerId,movementStartDelay,heldMovementRacerId,heldMovementKind);
  const pendingMotion=scene?.getPendingAnimationMs()??0;
  clearTimeout(motionTimer);
  if(pendingMotion>20)motionTimer=window.setTimeout(()=>render(),pendingMotion+40);
  const preservedCanvas=sceneCanvas;
  renderGame(app,currentView,{dispatch,rollDice,copyInvite,addBot:addAi,removeBot:removeAi,leave,openSettings:()=>{settingsOpen=true;render();},closeSettings:()=>{settingsOpen=false;render();},setLocale,toggleLog:()=>{logOpen=!logOpen;render();},toggleSound,toggleAutoAdvance,skipReveal,closeInspector:()=>{inspectRacerId=null;inspectSpace=null;render();},confirmMovement,resetCamera},{locale,settingsOpen,logOpen,showRollFx:rollActive,showReveal:showingReveal,revealIndex,revealRemainingMs:Math.max(0,revealUntil-performance.now()),motionLocked:showingReveal||rollActive||pendingMotion>20||Boolean(activeEffect)||effectQueue.length>0,activeEffect,effectQueueLength:effectQueue.length,effectSequenceStep,effectSequenceTotal,diceGesture,presentedRacerId,finishChance:getFinishChance(currentView),finishDrama:finishDramaActive?finishDrama:null,soundEnabled,autoAdvance,inspectRacerId,inspectSpace,cameraMoved},status);
  const placeholder=document.querySelector<HTMLCanvasElement>('#track-canvas');
  if(placeholder&&scene&&preservedCanvas){
    placeholder.replaceWith(preservedCanvas);
    sceneCanvas=preservedCanvas;
    scene.update(currentView,locale,presentedRacerId,activeEffect?.sourceRacerId,activeEffect?.targetRacerId,movementStartDelay,heldMovementRacerId,heldMovementKind);
    scene.resizeNow();
  }else if(placeholder){
    scene?.destroy();
    sceneCanvas=placeholder;
    scene=new TrackScene(placeholder,locale,{onRacerTap:handleRacerTap,onSpaceLongPress:space=>{inspectSpace=space;inspectRacerId=null;render();},onCameraViewChange:moved=>{if(cameraMoved===moved)return;cameraMoved=moved;render();}});
    scene.update(currentView,locale,presentedRacerId,activeEffect?.sourceRacerId,activeEffect?.targetRacerId,movementStartDelay,heldMovementRacerId,heldMovementKind);
  }else{
    if(scene)cameraMoved=false;
    scene?.destroy();scene=null;sceneCanvas=null;
  }
}

function startReveal(view:GameView){
  clearTimeout(revealTimer);clearInterval(revealTickTimer);
  revealIndex=0;revealActive=view.racers.length>0;scheduleRevealStep();
}

function scheduleRevealStep(){
  clearTimeout(revealTimer);clearInterval(revealTickTimer);
  if(!currentView||!revealActive)return;
  const duration=autoAdvance?1100:7000;revealUntil=performance.now()+duration;render();
  revealTickTimer=window.setInterval(()=>render(),250);
  revealTimer=window.setTimeout(()=>advanceReveal(),duration);
}

function advanceReveal(){
  clearTimeout(revealTimer);clearInterval(revealTickTimer);
  if(!currentView||!revealActive)return;
  revealIndex++;
  if(revealIndex>=currentView.racers.length){revealActive=false;revealUntil=0;render();scheduleBots();return;}
  scheduleRevealStep();
}

function skipReveal(){if(revealActive)advanceReveal();}

function dispatch(action:GameAction){session.dispatch(action);}
function rollDice(gesture:DiceGesture){diceGesture=gesture;pendingLocalGesture=true;dispatch({type:'ROLL'});}
function copyInvite(){
  if(!currentView)return;
  const url=`${location.origin}${location.pathname}?room=${currentView.roomCode}`;
  navigator.clipboard?.writeText(url).then(()=>{status=txt('邀请链接已复制','Invite link copied');render();}).catch(()=>{status=`${txt('房间码','Room code')}：${currentView!.roomCode}`;render();});
}
function addAi(){if(!session.isHost||!session.state)return;session.replaceHostState(addBot(session.state));}
function removeAi(){if(!session.isHost||!session.state)return;session.replaceHostState(removeBot(session.state));}
function leave(){clearTimeout(botTimer);clearTimeout(revealTimer);clearInterval(revealTickTimer);clearTimeout(rollTimer);clearTimeout(eventTimer);clearTimeout(eventPumpTimer);clearTimeout(motionTimer);clearTimeout(autoAssistTimer);session.close();history.replaceState(null,'',location.pathname);if(updateReady)void updateSW(true);else renderLanding();}

function scheduleBots(){
  clearTimeout(botTimer);
  if(!session.isHost||!session.state||!session.state.demoMode||revealActive)return;
  const s=session.state;
  let botId:string|undefined;
  if(s.presentationGate)botId=s.players.find(p=>p.id===s.presentationGate!.playerId&&p.isBot)?.id;
  else if(s.phase==='draft'){
    const drafter=currentDrafter(s);
    botId=s.players.find(p=>p.id===drafter&&p.isBot)?.id;
  }else if(s.phase==='select')botId=s.players.find(p=>p.isBot&&!selectionComplete(s,p.id))?.id;
  else if(s.phase==='race')botId=s.players.find(p=>p.id===s.turnPlayerId&&p.isBot)?.id;
  if(!botId)return;
  const movementDelay=scene?.getPendingAnimationMs()??0;
  const eventDelay=Math.max(0,effectUntil-performance.now())+effectQueue.reduce((total,event)=>total+effectDisplayMs(event)+EFFECT_GAP_MS,0);
  const rollDelay=Math.max(0,rollFxUntil-performance.now());
  const delay=Math.max(850,rollDelay+180,movementDelay+450,eventDelay+220);
  botTimer=window.setTimeout(()=>takeBotAction(botId!),delay);
}

function takeBotAction(botId:string){
  if(!session.isHost||!session.state)return;
  const s=session.state;
  const bot=s.players.find(p=>p.id===botId&&p.isBot);
  if(!bot)return;
  let action:GameAction|undefined;
  if(s.presentationGate?.playerId===botId)action={type:'ACK_PRESENTATION',id:s.presentationGate.id};
  else if(s.phase==='draft'&&currentDrafter(s)===botId)action={type:'DRAFT',racerId:s.draftPool[0]};
  else if(s.phase==='select'&&!selectionComplete(s,botId)){const picked=[s.selected[botId],s.selectedSecond[botId]].filter(Boolean);const available=bot.hand.filter(id=>!bot.used.includes(id)&&!picked.includes(id));action={type:'SELECT_RACER',racerId:available[Math.floor(Math.random()*available.length)]};}
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

function toggleSound(){
  soundEnabled=!soundEnabled;
  localStorage.setItem('ma-sound',soundEnabled?'on':'off');
  finishAudio.setEnabled(soundEnabled);
  if(soundEnabled)void finishAudio.unlock();
  render();
}

function toggleAutoAdvance(){
  autoAdvance=!autoAdvance;localStorage.setItem('ma-auto-advance',autoAdvance?'on':'off');
  if(revealActive)scheduleRevealStep();else render();
  if(currentView)scheduleAutomaticAssist(currentView);
}

function scheduleAutomaticAssist(view:GameView){
  clearTimeout(autoAssistTimer);if(!autoAdvance)return;
  if(view.presentationGate?.playerId===view.viewerId){
    const gateId=view.presentationGate.id;const delay=Math.max(180,rollFxUntil-performance.now()+140);
    autoAssistTimer=window.setTimeout(()=>{if(currentView?.presentationGate?.id===gateId)dispatch({type:'ACK_PRESENTATION',id:gateId});},delay);return;
  }
  if(view.pendingDecision?.playerId===view.viewerId&&view.pendingDecision.kind==='recover-trip'){
    autoAssistTimer=window.setTimeout(()=>{if(currentView?.pendingDecision?.kind==='recover-trip')dispatch({type:'DECIDE',value:'recover'});},650);
  }
}

function handleRacerTap(racerStateId:string){
  if(!currentView)return;
  const gate=currentView.presentationGate;
  if(gate?.playerId===currentView.viewerId&&gate.racerId===racerStateId){dispatch({type:'ACK_PRESENTATION',id:gate.id});return;}
  inspectRacerId=racerStateId;inspectSpace=null;render();
}

function confirmMovement(){
  if(!currentView)return;const gate=currentView.presentationGate;if(gate&&gate.playerId===currentView.viewerId)dispatch({type:'ACK_PRESENTATION',id:gate.id});
}

function resetCamera(){
  scene?.resetCameraView();
  if(cameraMoved){cameraMoved=false;render();}
}

function queueEffectEvents(view:GameView){
  const newest=view.logs.at(-1)?.id??lastSeenLogId;
  const fresh=view.logs.filter(log=>log.id>lastSeenLogId&&log.sourceRacerId&&log.effectKind&&log.effectKind!=='move');
  lastSeenLogId=Math.max(lastSeenLogId,newest);
  if(fresh.length){
    if(!activeEffect&&effectQueue.length===0){effectSequenceStep=0;effectSequenceTotal=fresh.length;}
    else effectSequenceTotal+=fresh.length;
    effectQueue.push(...fresh);
    pumpEffectQueue();
  }
}

function pumpEffectQueue(){
  clearTimeout(eventPumpTimer);
  if(activeEffect||!effectQueue.length||!currentView)return;
  const waitForDice=Math.max(0,rollFxUntil-performance.now());
  const waitForMotion=scene?.getPendingAnimationMs()??0;
  const waitForGate=currentView.presentationGate?420:0;
  const waitForPresentation=Math.max(waitForDice,waitForMotion,presentationUntil-performance.now(),waitForGate);
  if(waitForPresentation>20){eventPumpTimer=window.setTimeout(pumpEffectQueue,waitForPresentation+25);return;}
  activeEffect=effectQueue.shift()!;
  effectSequenceStep++;
  const duration=effectDisplayMs(activeEffect);
  effectUntil=performance.now()+duration;
  render();
  clearTimeout(eventTimer);
  eventTimer=window.setTimeout(()=>{
    activeEffect=null;effectUntil=0;render();
    if(effectQueue.length)eventPumpTimer=window.setTimeout(pumpEffectQueue,EFFECT_GAP_MS);
    else{effectSequenceStep=0;effectSequenceTotal=0;scheduleBots();}
  },duration);
}

function effectDisplayMs(event:LogEntry){
  const text=locale==='zh'?event.text:event.textEn;
  return Math.round(Math.min(EFFECT_DISPLAY_MAX_MS,Math.max(EFFECT_DISPLAY_MIN_MS,720+Array.from(text).length*7)));
}

function defaultDiceGesture(sequence:number,value:number):DiceGesture{
  const direction=(sequence+value)%2===0?1:-1;
  return{x:direction*(42+(value%3)*20),y:-95-(value%2)*28,power:.72+(value%3)*.12,twist:direction*(135+value*17)};
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

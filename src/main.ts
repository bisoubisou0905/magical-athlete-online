import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { OnlineSession } from './network/session';
import { addBot, applyAction, currentDrafter, removeBot } from './game/engine';
import type { GameAction, GameView } from './game/types';
import { renderGame } from './ui/render';
import { TrackScene } from './three/trackScene';

registerSW({ immediate:true });
const app=document.querySelector<HTMLElement>('#app')!;
const session=new OnlineSession();
let currentView:GameView|null=null;
let scene:TrackScene|null=null;
let status='';
let botTimer:number|undefined;

session.onState=view=>{currentView=view;render();scheduleBots();};
session.onStatus=(text,error)=>{status=text;render();if(!error)setTimeout(()=>{if(status===text){status='';render();}},2200);};

renderLanding();

function renderLanding(error=''){
  scene?.destroy();scene=null;currentView=null;
  const room=new URLSearchParams(location.search).get('room')?.toUpperCase()??'';
  const remembered=localStorage.getItem('ma-player-name')??'';
  app.innerHTML=`<main class="join-page"><section class="join-card"><div class="join-logo"><span class="brand-dot"></span>2–4 人线上赛跑</div><h1>魔法<br><span>运动会</span></h1><p>真人与 AI 自由组成 2–4 人房间，用骰子跑完四场越来越值钱的混乱比赛。无需账号，也无需安装。</p><form class="form-stack" id="join-form"><label for="name">你的名字</label><input id="name" maxlength="16" placeholder="例如：小魔王" value="${escapeAttr(remembered)}" autocomplete="nickname"><label for="room">房间码</label><input id="room" maxlength="6" placeholder="加入时填写 6 位房间码" value="${escapeAttr(room)}" autocapitalize="characters"><div class="error-text">${escapeHtml(error)}</div><div class="split-actions"><button class="btn primary" type="button" id="host">创建房间</button><button class="btn secondary" type="submit">加入房间</button></div></form><div class="network-note">免费测试联机：GitHub Pages + PeerJS Cloud 信令 + WebRTC 点对点连接。房主页面必须在线。</div></section></main>`;
  const name=document.querySelector<HTMLInputElement>('#name')!,roomInput=document.querySelector<HTMLInputElement>('#room')!;
  document.querySelector('#host')!.addEventListener('click',async()=>{if(!name.value.trim()){renderLanding('请先填写名字');return;}setBusy(true);try{remember(name.value);await session.host(name.value.trim());history.replaceState(null,'',`${location.pathname}?room=${session.state!.roomCode}`);}catch(e){renderLanding(message(e));}});
  document.querySelector('#join-form')!.addEventListener('submit',async e=>{e.preventDefault();if(!name.value.trim()||roomInput.value.trim().length!==6){renderLanding('请填写名字和 6 位房间码');return;}setBusy(true);try{remember(name.value);await session.join(roomInput.value.trim(),name.value.trim());history.replaceState(null,'',`${location.pathname}?room=${roomInput.value.trim().toUpperCase()}`);}catch(err){renderLanding(message(err));}});
  function setBusy(b:boolean){document.querySelectorAll<HTMLButtonElement>('button').forEach(x=>x.disabled=b);document.querySelector('.error-text')!.textContent=b?'正在连接免费信令服务器…':'';}
}

function render(){
  if(!currentView){return;}
  renderGame(app,currentView,{dispatch,copyInvite,addBot:addAi,removeBot:removeAi,leave},status);
  const canvas=document.querySelector<HTMLCanvasElement>('#track-canvas');
  if(canvas){scene?.destroy();scene=new TrackScene(canvas);scene.update(currentView);}else{scene?.destroy();scene=null;}
}

function dispatch(action:GameAction){session.dispatch(action);}
function copyInvite(){if(!currentView)return;const url=`${location.origin}${location.pathname}?room=${currentView.roomCode}`;navigator.clipboard?.writeText(url).then(()=>{status='邀请链接已复制';render();}).catch(()=>{status=`房间码：${currentView!.roomCode}`;render();});}
function addAi(){if(!session.isHost||!session.state)return;session.replaceHostState(addBot(session.state));}
function removeAi(){if(!session.isHost||!session.state)return;session.replaceHostState(removeBot(session.state));}
function leave(){clearTimeout(botTimer);session.close();history.replaceState(null,'',location.pathname);renderLanding();}

function scheduleBots(){
  clearTimeout(botTimer);if(!session.isHost||!session.state||!session.state.demoMode)return;
  const s=session.state;let botId:string|undefined;
  if(s.phase==='draft'){
    const drafter=currentDrafter(s);
    botId=s.players.find(p=>p.id===drafter&&p.isBot)?.id;
  }
  else if(s.phase==='select')botId=s.players.find(p=>p.isBot&&!s.selected[p.id])?.id;
  else if(s.phase==='race')botId=s.players.find(p=>p.id===s.turnPlayerId&&p.isBot)?.id;
  if(!botId)return;const bot=s.players.find(p=>p.id===botId)!;
  botTimer=window.setTimeout(()=>{
    if(!session.state)return;let action:GameAction;
    if(session.state.phase==='draft')action={type:'DRAFT',racerId:session.state.draftPool[0]};
    else if(session.state.phase==='select'){const available=bot.hand.filter(id=>!bot.used.includes(id));action={type:'SELECT_RACER',racerId:available[Math.floor(Math.random()*available.length)]};}
    else if(session.state.pendingDecision?.playerId===botId){const opts=session.state.pendingDecision.options;action={type:'DECIDE',value:opts[Math.floor(Math.random()*opts.length)].value};}
    else action={type:'ROLL'};
    session.replaceHostState(applyAction(session.state,botId!,action));
  },480);
}

function remember(name:string){localStorage.setItem('ma-player-name',name.trim());}
function message(e:unknown){return e instanceof Error?e.message:'连接失败，请稍后重试';}
function escapeHtml(s:string){return s.replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]!));}
function escapeAttr(s:string){return escapeHtml(s);}

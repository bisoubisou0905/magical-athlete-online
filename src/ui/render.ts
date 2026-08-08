import { RACER_BY_ID } from '../game/racers';
import { availableSpecials, currentDrafter } from '../game/engine';
import type { GameAction, GameView } from '../game/types';

export type Locale = 'zh' | 'en';

export interface UiState {
  locale: Locale;
  settingsOpen: boolean;
  logOpen: boolean;
  showRollFx: boolean;
  showReveal: boolean;
  revealIndex: number;
  motionLocked: boolean;
}

export interface UiHandlers {
  dispatch:(a:GameAction)=>void;
  copyInvite:()=>void;
  addBot:()=>void;
  removeBot:()=>void;
  leave:()=>void;
  openSettings:()=>void;
  closeSettings:()=>void;
  setLocale:(locale:Locale)=>void;
  toggleLog:()=>void;
}

export function renderGame(root:HTMLElement,view:GameView,h:UiHandlers,ui:UiState,status=''){
  const me=view.players.find(p=>p.id===view.viewerId)!;
  const l=ui.locale;
  root.innerHTML=`
    <main class="game-shell">
      <header class="topbar">
        <button class="brand" data-action="leave" aria-label="${tx(l,'返回首页','Back to home')}"><span class="brand-dot"></span><span>${tx(l,'魔法运动会','MAGICAL ATHLETE')}</span></button>
        <div class="top-actions">
          <button class="icon-btn" data-action="log" aria-label="${tx(l,'赛事播报','Race log')}">☷</button>
          <button class="room-pill" data-action="copy">${tx(l,'房间','Room')} ${view.roomCode} · ${tx(l,'邀请','Invite')}</button>
          <button class="icon-btn" data-action="settings" aria-label="${tx(l,'设置','Settings')}">⚙</button>
        </div>
      </header>
      <section class="score-strip">${view.players.map(p=>playerChip(view,p.id,l)).join('')}</section>
      <section class="stage ${['lobby','draft','select'].includes(view.phase)?'panel-stage':''}">${stageContent(view,me.id,l,ui.motionLocked)}</section>
      ${['race','raceResult','gameOver'].includes(view.phase)?`<canvas id="track-canvas" aria-label="${tx(l,'三维桌游赛道','3D board-game track')}"></canvas>`:''}
      <aside class="log-panel ${ui.logOpen?'open':''}">
        <div class="log-head"><b>${tx(l,'赛事播报','Race Log')}</b><button data-action="log" aria-label="${tx(l,'关闭','Close')}">×</button></div>
        <div class="log-scroll">${view.logs.slice(-18).reverse().map(x=>`<p class="log ${x.tone??''}">${escapeHtml(l==='zh'?x.text:(x.textEn??x.text))}</p>`).join('')}</div>
      </aside>
      ${view.phase==='race' && view.logs.length?`<div class="live-caption ${view.logs.at(-1)?.tone??''}">${escapeHtml(l==='zh'?view.logs.at(-1)!.text:(view.logs.at(-1)!.textEn??view.logs.at(-1)!.text))}</div>`:''}
      ${ui.showRollFx&&view.lastRoll&&view.lastRollPlayerId?diceTheater(view,l):''}
      ${ui.showReveal&&view.racers.length?revealTheater(view,l,ui.revealIndex):''}
      ${ui.settingsOpen?settings(l):''}
      ${status?`<div class="toast">${escapeHtml(status)}</div>`:''}
    </main>`;
  bind(root,h);
}

function stageContent(v:GameView,me:string,l:Locale,motionLocked:boolean){
  if(v.phase==='lobby')return lobby(v,me,l);
  if(v.phase==='draft')return draft(v,me,l);
  if(v.phase==='select')return selection(v,me,l);
  if(v.phase==='race')return raceHud(v,me,l,motionLocked);
  if(v.phase==='raceResult')return result(v,me,l);
  return gameOver(v,l);
}

function lobby(v:GameView,me:string,l:Locale){
  const host=me===v.hostId;
  const bots=v.players.filter(p=>p.isBot).length;
  return `<div class="center-panel lobby-panel">
    <span class="eyebrow">${tx(l,'2–4 人动态房间','Dynamic room for 2–4')}</span>
    <h1>${tx(l,'召集你的','Gather your')}<br><em>${tx(l,'混乱跑团','chaotic racers')}</em></h1>
    <button class="room-code" data-action="copy">${v.roomCode}</button>
    <p>${tx(l,'真人与电脑可自由组合，达到 2 名即可开始。房主页面负责同步比赛，请保持在线。','Mix human players and AI freely. Start with 2 or more; the host keeps the match in sync and should stay online.')}</p>
    <div class="lobby-list">${v.players.map((p,i)=>`<div class="lobby-seat ${p.connected?'ready':''}"><span>${i+1}</span><b>${escapeHtml(p.name)}</b><small>${p.isBot?tx(l,'AI 电脑','AI player'):tx(l,'已连接','Connected')}</small></div>`).join('')}${Array.from({length:4-v.players.length},(_,i)=>`<div class="lobby-seat"><span>${v.players.length+i+1}</span><b>${tx(l,'等待选手…','Waiting…')}</b><small>${tx(l,'空位','Open')}</small></div>`).join('')}</div>
    ${host?`<div class="action-row"><button class="btn secondary" data-action="add-bot" ${v.players.length>=4?'disabled':''}>+ ${tx(l,'添加 AI','Add AI')}</button><button class="btn ghost" data-action="remove-bot" ${bots===0?'disabled':''}>− ${tx(l,'移除 AI','Remove AI')}</button><button class="btn primary" data-game="start" ${v.players.length<2?'disabled':''}>${tx(l,`以 ${v.players.length} 人开始`,`Start with ${v.players.length}`)}</button></div>`:`<div class="waiting">${tx(l,'等待房主开始比赛…','Waiting for the host…')}</div>`}
    ${quickRules(l,true)}
  </div>`;
}

function draft(v:GameView,me:string,l:Locale){
  const drafter=currentDrafter(v);
  const mine=drafter===me;
  const round=Math.min(2,v.draftRound+1);
  return `<div class="wide-panel">
    <span class="eyebrow">${tx(l,`第 ${round}/2 轮蛇形选秀 · ${v.draftIndex+1}/${v.draftOrder.length}`,`Snake draft ${round}/2 · Pick ${v.draftIndex+1}/${v.draftOrder.length}`)}</span>
    <h2>${mine?tx(l,'轮到你招募！','Your pick!'):tx(l,`等待 ${v.players.find(p=>p.id===drafter)?.name??''} 选择`,`Waiting for ${v.players.find(p=>p.id===drafter)?.name??''}`)}</h2>
    <p class="subcopy">${tx(l,'从桌面公开角色中选一张；每轮结束会翻开一组新角色。','Choose one face-up racer. A fresh group appears for the second draft round.')}</p>
    <div class="card-grid">${v.draftPool.map(id=>racerCard(id,mine,`draft:${id}`,l)).join('')}</div>
  </div>`;
}

function selection(v:GameView,me:string,l:Locale){
  const p=v.players.find(x=>x.id===me)!;
  const selected=v.selected[me];
  const locked=Boolean(selected);
  const ready=v.players.filter(x=>Boolean(v.selected[x.id])).length;
  return `<div class="wide-panel select-panel">
    <span class="eyebrow">${tx(l,`第 ${v.raceNumber+1}/4 局 · ${v.raceNumber%2===0?'温和里程':'狂野里程'}`,`Race ${v.raceNumber+1}/4 · ${v.raceNumber%2===0?'Mild Mile':'Wild Mile'}`)}</span>
    <h2>${locked?tx(l,'已锁定，等待共同揭晓','Locked in—waiting for the reveal'):tx(l,'秘密选择本局角色','Secretly choose your racer')}</h2>
    <p class="subcopy">${tx(l,'每名角色整场只能使用一次；所有人锁定后，会一起翻牌揭晓。','Each racer can be used only once. Everyone reveals together after locking in.')}</p>
    ${locked&&selected!=='hidden'?lockedPreview(selected!,p.name,l):`<div class="card-grid hand">${p.hand.filter(id=>!p.used.includes(id)).map(id=>racerCard(id,true,`select:${id}`,l)).join('')}</div>`}
    <div class="ready-dots">${v.players.map(x=>`<span class="${v.selected[x.id]?'on':''}">${escapeHtml(x.name)} · ${v.selected[x.id]?tx(l,'已锁定','Ready'):tx(l,'选择中','Choosing')}</span>`).join('')}</div>
    <div class="ready-meter"><i style="width:${ready/v.players.length*100}%"></i></div>
  </div>`;
}

function lockedPreview(id:string,playerName:string,l:Locale){
  const r=RACER_BY_ID[id];
  return `<div class="locked-preview" style="--racer:${r.color}"><div class="selection-pulse"></div><img src="${racerImage(id)}" alt="${escapeHtml(name(r,l))}"><div><span>${tx(l,'你的选择','YOUR PICK')} · ${escapeHtml(playerName)}</span><h3>${escapeHtml(name(r,l))}</h3><p>${escapeHtml(powerText(r,l))}</p><small>${tx(l,'其他玩家现在只能看见“已锁定”状态','Other players only see that you are ready')}</small></div></div>`;
}

function raceHud(v:GameView,me:string,l:Locale,motionLocked:boolean){
  const r=v.racers.find(x=>x.playerId===me);
  const turn=v.turnPlayerId===me;
  const def=r?RACER_BY_ID[r.racerId]:null;
  const specials=availableSpecials(v,me);
  const turnPlayer=v.players.find(p=>p.id===v.turnPlayerId);
  const turnRacer=v.racers.find(x=>x.playerId===v.turnPlayerId);
  const turnDef=turnRacer?RACER_BY_ID[turnRacer.racerId]:null;
  return `<div class="race-hud">
    <div class="race-badge">${tx(l,`第 ${v.raceNumber+1} 局 · ${v.track==='mild'?'温和里程':'狂野里程'}`,`Race ${v.raceNumber+1} · ${v.track==='mild'?'Mild Mile':'Wild Mile'}`)}</div>
    <div class="turn-banner" style="--player:${turnPlayer?.color??'#fff'}"><i></i><span>${turn?tx(l,'轮到你了','Your turn'):tx(l,`${turnPlayer?.name??''} 正在行动`,`${turnPlayer?.name??''} is moving`)}</span><b>${turnDef?escapeHtml(name(turnDef,l)):''}</b></div>
    ${r&&def?`<div class="my-racer" style="--racer:${def.color};--player:${v.players.find(p=>p.id===me)?.color}"><img class="racer-icon" src="${racerImage(r.racerId)}" alt="${escapeHtml(name(def,l))}"><div><span>${tx(l,'我的角色','MY RACER')}</span><b>${escapeHtml(name(def,l))}</b><small>${escapeHtml(powerText(def,l))}</small></div></div>`:''}
    <div class="command-dock">${motionLocked?`<div class="waiting moving-wait"><i></i>${tx(l,'棋子正在逐格移动…','Moving the piece space by space…')}</div>`:v.pendingDecision?.playerId===me?decision(v,l):turn?`<div class="turn-actions"><button class="roll-button" data-game="roll"><span>⚄</span><b>${tx(l,'投骰并移动','ROLL & MOVE')}</b></button>${specials.map(s=>`<button class="btn special" data-special="${s.kind}">${escapeHtml(l==='zh'?s.label:s.labelEn)}</button>`).join('')}</div>`:`<div class="waiting">${tx(l,`等待 ${turnPlayer?.name??''}…`,`Waiting for ${turnPlayer?.name??''}…`)}</div>`}</div>
  </div>`;
}

function decision(v:GameView,l:Locale){
  const d=v.pendingDecision!;
  return `<div class="decision"><b>${escapeHtml(l==='zh'?d.prompt:(d.promptEn??d.prompt))}</b><div class="choice-list">${d.options.map(o=>`<button class="btn choice" data-decide="${escapeAttr(o.value)}">${escapeHtml(l==='zh'?o.label:(o.labelEn??o.label))}</button>`).join('')}${d.optional?`<button class="btn ghost" data-decide="skip">${tx(l,'本回合不使用','Skip this turn')}</button>`:''}</div></div>`;
}

function result(v:GameView,me:string,l:Locale){
  const first=v.finishers[0],second=v.finishers[1];
  return `<div class="result-card"><span class="eyebrow">${tx(l,`第 ${v.raceNumber+1} 局结束`,`Race ${v.raceNumber+1} complete`)}</span><h2>${tx(l,'冲线成绩','Finishers')}</h2><div class="podium"><div><span>🥇</span><b>${first?escapeHtml(v.players.find(p=>p.id===first)!.name):'—'}</b><small>+${[4,6,8,10][v.raceNumber]} ${tx(l,'分','points')}</small></div><div><span>🥈</span><b>${second?escapeHtml(v.players.find(p=>p.id===second)!.name):tx(l,'空缺','Unclaimed')}</b><small>${second?`+${[2,3,4,5][v.raceNumber]} ${tx(l,'分','points')}`:tx(l,'无人获得银花','No silver prize')}</small></div></div>${me===v.hostId?`<button class="btn primary" data-game="continue">${tx(l,'继续下一局','Next race')}</button>`:`<div class="waiting">${tx(l,'等待房主继续…','Waiting for the host…')}</div>`}</div>`;
}

function gameOver(v:GameView,l:Locale){
  const top=Math.max(...v.players.map(p=>p.score));
  const winners=v.players.filter(p=>p.score===top);
  return `<div class="result-card final"><span class="eyebrow">${tx(l,'四局比赛完成','All four races complete')}</span><h1>${winners.map(p=>escapeHtml(p.name)).join(l==='zh'?'、':' & ')}<br><em>${tx(l,'赢得比赛！','wins!')}</em></h1><div class="final-scores">${[...v.players].sort((a,b)=>b.score-a.score).map((p,i)=>`<div><span>${i+1}</span><b>${escapeHtml(p.name)}</b><strong>${p.score} ${tx(l,'分','pts')}</strong></div>`).join('')}</div><button class="btn secondary" data-action="leave">${tx(l,'返回首页','Back to home')}</button></div>`;
}

function racerCard(id:string,enabled:boolean,action:string,l:Locale){
  const r=RACER_BY_ID[id];
  return `<button class="racer-card" style="--racer:${r.color}" data-card="${enabled?action:''}" ${enabled?'':'disabled'}><span class="racer-art"><img src="${racerImage(id)}" alt="${escapeHtml(name(r,l))}"><i>${escapeHtml(name(r,l))}</i></span><b>${escapeHtml(name(r,l))}</b><p>${escapeHtml(powerText(r,l))}</p><span class="card-cta">${tx(l,'点按选择','TAP TO PICK')}</span></button>`;
}

function playerChip(v:GameView,id:string,l:Locale){
  const p=v.players.find(x=>x.id===id)!;
  const racer=v.racers.find(x=>x.playerId===id);
  const def=racer?RACER_BY_ID[racer.racerId]:null;
  return `<div class="player-chip ${id===v.turnPlayerId?'turn':''} ${p.connected?'':'offline'}" style="--player:${p.color}">${def?`<img src="${racerImage(def.id)}" alt="">`:'<i></i>'}<span><b>${escapeHtml(p.name)}</b>${def?`<small>${escapeHtml(name(def,l))}</small>`:''}</span><strong>${p.score}</strong></div>`;
}

function diceTheater(v:GameView,l:Locale){
  const player=v.players.find(p=>p.id===v.lastRollPlayerId)!;
  const racer=v.racers.find(r=>r.playerId===v.lastRollPlayerId);
  const def=racer?RACER_BY_ID[racer.racerId]:null;
  return `<div class="dice-theater" style="--player:${player?.color??'#fff'}"><div class="dice-spotlight"></div><div class="die" data-value="${v.lastRoll}">${pips(v.lastRoll!)}</div><div class="dice-call"><span>${escapeHtml(player?.name??'')}</span><b>${v.lastRoll} ${tx(l,'点','')}</b><small>${def?escapeHtml(name(def,l)):''}</small></div></div>`;
}

function revealTheater(v:GameView,l:Locale,index:number){
  const current=v.racers[index%v.racers.length];
  const p=v.players.find(x=>x.id===current.playerId)!;
  const r=RACER_BY_ID[current.racerId];
  return `<div class="reveal-theater"><div class="reveal-kicker">${tx(l,`第 ${v.raceNumber+1} 局 · 全员揭晓`,`Race ${v.raceNumber+1} · Racer Reveal`)}</div><div class="reveal-focus" style="--racer:${r.color};--player:${p.color}"><div class="reveal-card"><img src="${racerImage(r.id)}" alt="${escapeHtml(name(r,l))}"><i>${escapeHtml(p.name)}</i></div><div class="reveal-copy"><span>${escapeHtml(p.name)} ${tx(l,'派出','reveals')}</span><h2>${escapeHtml(name(r,l))}</h2><p>${escapeHtml(powerText(r,l))}</p></div></div><div class="reveal-roster">${v.racers.map((x,i)=>{const d=RACER_BY_ID[x.racerId];const owner=v.players.find(p=>p.id===x.playerId)!;return`<div class="${i===index%v.racers.length?'active':''}" style="--player:${owner.color}"><img src="${racerImage(d.id)}" alt=""><span>${escapeHtml(owner.name)}</span></div>`;}).join('')}</div></div>`;
}

function settings(l:Locale){return `<div class="modal-backdrop" data-action="close-settings"><section class="settings-card" role="dialog" aria-modal="true"><button class="modal-close" data-action="close-settings">×</button><span class="eyebrow">${tx(l,'游戏设置','GAME SETTINGS')}</span><h2>${tx(l,'语言 / Language','Language / 语言')}</h2><p>${tx(l,'语言只影响你自己的手机，可在比赛中随时切换。','Language is saved on this device and can be changed during a match.')}</p><div class="language-grid"><button class="language-choice ${l==='zh'?'active':''}" data-locale="zh"><b>中文</b><small>角色能力中文翻译</small></button><button class="language-choice ${l==='en'?'active':''}" data-locale="en"><b>English</b><small>Original rulebook text</small></button></div></section></div>`;}

export function quickRules(l:Locale,compact=false){return `<details class="quick-rules ${compact?'compact':''}" ${compact?'':'open'}><summary>${tx(l,'60 秒快速规则','Rules in 60 seconds')}</summary><ol><li><b>${tx(l,'选秀','Draft')}</b><span>${tx(l,'分两轮从公开角色中蛇形选秀，每人得到 4 名角色。','Snake-draft face-up racers in two rounds; each player gets 4.')}</span></li><li><b>${tx(l,'出赛','Reveal')}</b><span>${tx(l,'每局秘密选 1 名未用角色，所有人同时揭晓。','Secretly choose one unused racer, then reveal together.')}</span></li><li><b>${tx(l,'行动','Turns')}</b><span>${tx(l,'轮到你时掷骰并逐格移动；角色能力会改变比赛。','Roll and move space by space; racer powers bend the rules.')}</span></li><li><b>${tx(l,'冲线','Finish')}</b><span>${tx(l,'第二名冲线后本局立刻结束，前两名得分。','The race ends as soon as 2nd place finishes; both score.')}</span></li><li><b>${tx(l,'获胜','Win')}</b><span>${tx(l,'共 4 局，奖励逐局提高；总分最高者获胜。','Play 4 races with rising prizes. Highest total score wins.')}</span></li></ol><p>${tx(l,'狂野里程：星星 +1 分、石头会绊倒、箭头会继续推动棋子。','Wild Mile: stars score +1, rocks trip, and arrows keep moving your piece.')}</p></details>`;}

function pips(value:number){return Array.from({length:value},()=>'<i></i>').join('');}
function name(r:(typeof RACER_BY_ID)[string],l:Locale){return l==='zh'?r.nameZh:r.name;}
function powerText(r:(typeof RACER_BY_ID)[string],l:Locale){return l==='zh'?r.powerZh:r.power;}
function tx(l:Locale,zh:string,en:string){return l==='zh'?zh:en;}
function racerImage(id:string){return`${import.meta.env.BASE_URL}racers/${id}.webp`;}

function bind(root:HTMLElement,h:UiHandlers){
  root.querySelector<HTMLElement>('.settings-card')?.addEventListener('click',event=>event.stopPropagation());
  root.querySelectorAll<HTMLElement>('[data-action="copy"]').forEach(x=>x.onclick=h.copyInvite);
  root.querySelectorAll<HTMLElement>('[data-action="add-bot"]').forEach(x=>x.onclick=h.addBot);
  root.querySelectorAll<HTMLElement>('[data-action="remove-bot"]').forEach(x=>x.onclick=h.removeBot);
  root.querySelectorAll<HTMLElement>('[data-action="leave"]').forEach(x=>x.onclick=h.leave);
  root.querySelectorAll<HTMLElement>('[data-action="settings"]').forEach(x=>x.onclick=h.openSettings);
  root.querySelectorAll<HTMLElement>('[data-action="close-settings"]').forEach(x=>x.onclick=h.closeSettings);
  root.querySelectorAll<HTMLElement>('[data-action="log"]').forEach(x=>x.onclick=h.toggleLog);
  root.querySelectorAll<HTMLElement>('[data-locale]').forEach(x=>x.onclick=()=>h.setLocale(x.dataset.locale as Locale));
  root.querySelectorAll<HTMLElement>('[data-game]').forEach(x=>x.onclick=()=>{const a=x.dataset.game;if(a==='start')setTimeout(()=>h.dispatch({type:'START_GAME'}),0);if(a==='roll')h.dispatch({type:'ROLL'});if(a==='continue')h.dispatch({type:'CONTINUE'});});
  root.querySelectorAll<HTMLElement>('[data-card]').forEach(x=>x.onclick=()=>{const [kind,id]=(x.dataset.card||'').split(':');if(kind==='draft')h.dispatch({type:'DRAFT',racerId:id});if(kind==='select')h.dispatch({type:'SELECT_RACER',racerId:id});});
  root.querySelectorAll<HTMLElement>('[data-special]').forEach(x=>x.onclick=()=>h.dispatch({type:'USE_SPECIAL',kind:x.dataset.special as never}));
  root.querySelectorAll<HTMLElement>('[data-decide]').forEach(x=>x.onclick=()=>h.dispatch({type:'DECIDE',value:x.dataset.decide!}));
}

function escapeHtml(s:string){return s.replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]!));}
function escapeAttr(s:string){return escapeHtml(s);}

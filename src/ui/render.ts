import { RACER_BY_ID } from '../game/racers';
import { WILD_ARROWS, WILD_ROCKS, WILD_STARS, availableSpecials, currentDrafter, getRacerPowerId, racersPerPlayer, selectionComplete, type FinishChance } from '../game/engine';
import type { GameAction, GameView, LogEntry } from '../game/types';

export type Locale = 'zh' | 'en';
export interface DiceGesture { x:number; y:number; power:number; twist:number }

export interface UiState {
  locale: Locale;
  settingsOpen: boolean;
  logOpen: boolean;
  showRollFx: boolean;
  showReveal: boolean;
  revealIndex: number;
  revealRemainingMs: number;
  motionLocked: boolean;
  activeEffect: LogEntry | null;
  effectQueueLength: number;
  diceGesture: DiceGesture;
  presentedRacerId: string | null;
  finishChance: FinishChance;
  finishDrama: FinishChance | null;
  soundEnabled: boolean;
  autoAdvance: boolean;
  inspectRacerId: string | null;
  inspectSpace: number | null;
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
  rollDice:(gesture:DiceGesture)=>void;
  toggleSound:()=>void;
  toggleAutoAdvance:()=>void;
  skipReveal:()=>void;
  closeInspector:()=>void;
  confirmMovement:()=>void;
}

export function renderGame(root:HTMLElement,view:GameView,h:UiHandlers,ui:UiState,status=''){
  const me=view.players.find(p=>p.id===view.viewerId)!;
  const l=ui.locale;
  const order=playerOrder(view);
  const presentedRacer=view.racers.find(r=>r.id===ui.presentedRacerId);
  const presentedPlayerId=presentedRacer?.playerId??view.turnPlayerId;
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
      <section class="score-strip turn-order-strip" aria-label="${tx(l,'玩家、行动顺序与得分','Players, turn order, and scores')}">${order.map((id,index)=>playerChip(view,id,l,index,presentedPlayerId)).join('')}</section>
      <section class="stage ${['lobby','draft','select'].includes(view.phase)?'panel-stage':''}">${stageContent(view,me.id,l,ui.motionLocked,ui.presentedRacerId,ui.finishChance)}</section>
      ${['race','raceResult','gameOver'].includes(view.phase)?`<canvas id="track-canvas" aria-label="${tx(l,'三维桌游赛道','3D board-game track')}"></canvas>`:''}
      <aside class="log-panel ${ui.logOpen?'open':''}">
        <div class="log-head"><b>${tx(l,'赛事播报','Race Log')}</b><button data-action="log" aria-label="${tx(l,'关闭','Close')}">×</button></div>
        <div class="log-scroll">${view.logs.slice(-18).reverse().map(x=>`<p class="log ${x.tone??''}">${escapeHtml(l==='zh'?x.text:(x.textEn??x.text))}</p>`).join('')}</div>
      </aside>
      ${view.phase==='race' && view.logs.length&&!ui.activeEffect?`<div class="live-caption ${view.logs.at(-1)?.tone??''}">${escapeHtml(l==='zh'?view.logs.at(-1)!.text:(view.logs.at(-1)!.textEn??view.logs.at(-1)!.text))}</div>`:''}
      ${ui.activeEffect?effectTheater(view,l,ui.activeEffect,ui.effectQueueLength):''}
      ${ui.showRollFx&&view.lastRoll&&view.lastRollPlayerId?diceTheater(view,l,ui.diceGesture,ui.finishDrama):''}
      ${ui.showReveal&&view.racers.length?revealTheater(view,l,ui.revealIndex,ui.revealRemainingMs):''}
      ${ui.inspectRacerId||ui.inspectSpace!==null?inspector(view,l,ui.inspectRacerId,ui.inspectSpace):''}
      ${ui.settingsOpen?settings(l,ui.soundEnabled,ui.autoAdvance):''}
      ${status?`<div class="toast">${escapeHtml(status)}</div>`:''}
    </main>`;
  bind(root,h);
}

function stageContent(v:GameView,me:string,l:Locale,motionLocked:boolean,presentedRacerId:string|null,finishChance:FinishChance){
  if(v.phase==='lobby')return lobby(v,me,l);
  if(v.phase==='draft')return draft(v,me,l);
  if(v.phase==='select')return selection(v,me,l);
  if(v.phase==='race')return raceHud(v,me,l,motionLocked,presentedRacerId,finishChance);
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
    <p class="subcopy">${racersPerPlayer(v)===2?tx(l,'官方 2 人规则：每轮翻开 8 名角色，按 ABBAABBA / BAABBAAB 选秀，最终每人得到 8 名。','Official 2-player rules: draft 8 face-up racers in ABBAABBA / BAABBAAB order, ending with 8 each.'):tx(l,'从桌面公开角色中选一张；每轮结束会翻开一组新角色。','Choose one face-up racer. A fresh group appears for the second draft round.')}</p>
    <div class="card-grid">${v.draftPool.map(id=>racerCard(id,mine,`draft:${id}`,l)).join('')}</div>
  </div>`;
}

function selection(v:GameView,me:string,l:Locale){
  const p=v.players.find(x=>x.id===me)!;
  const selected=[v.selected[me],v.selectedSecond[me]].filter((id):id is string=>Boolean(id)&&id!=='hidden');
  const needed=racersPerPlayer(v);
  const locked=selectionComplete(v,me);
  const ready=v.players.filter(x=>selectionComplete(v,x.id)).length;
  return `<div class="wide-panel select-panel">
    <span class="eyebrow">${tx(l,`第 ${v.raceNumber+1}/4 局 · ${v.raceNumber%2===0?'温和里程':'狂野里程'}`,`Race ${v.raceNumber+1}/4 · ${v.raceNumber%2===0?'Mild Mile':'Wild Mile'}`)}</span>
    <h2>${locked?tx(l,'已锁定，等待共同揭晓','Locked in—waiting for the reveal'):needed===2&&selected.length===1?tx(l,'再选择第二名角色','Choose your second racer'):tx(l,needed===2?'秘密选择两名角色':'秘密选择本局角色',needed===2?'Secretly choose two racers':'Secretly choose your racer')}</h2>
    <p class="subcopy">${tx(l,needed===2?'每名角色整场只能使用一次；两名角色会依次行动，顺序由你每轮决定。':'每名角色整场只能使用一次；所有人锁定后，会一起翻牌揭晓。',needed===2?'Each racer is single-use. Your two racers act one after the other in the order you choose each round.':'Each racer can be used only once. Everyone reveals together after locking in.')}</p>
    <div class="selection-status-grid">${v.players.map(x=>selectionStatus(v,x.id,l)).join('')}</div>
    ${selected.length?lockedPreview(selected,p.name,l,locked):''}
    ${locked?'':`<div class="card-grid hand">${p.hand.filter(id=>!p.used.includes(id)&&!selected.includes(id)).map(id=>racerCard(id,true,`select:${id}`,l)).join('')}</div>`}
    <div class="ready-meter"><i style="width:${ready/v.players.length*100}%"></i></div>
  </div>`;
}

function selectionStatus(v:GameView,id:string,l:Locale){
  const p=v.players.find(x=>x.id===id)!;
  const needed=racersPerPlayer(v);
  const count=[v.selected[id],v.selectedSecond[id]].filter(Boolean).length;
  const done=selectionComplete(v,id);
  const label=done?tx(l,`已锁定 ${needed}/${needed}`,`Ready ${needed}/${needed}`):count?tx(l,`已选 ${count}/${needed}`,`Picked ${count}/${needed}`):tx(l,'正在挑选…','Choosing…');
  return `<div class="selection-player ${done?'ready':count?'partial':'choosing'}" style="--player:${p.color}"><span class="player-avatar">${escapeHtml(playerInitial(p.name,p.isBot))}</span><span><b>${escapeHtml(p.name)}</b><small>${label}</small></span><i aria-hidden="true"></i></div>`;
}

function lockedPreview(ids:string[],playerName:string,l:Locale,locked:boolean){
  const racers=ids.map(id=>RACER_BY_ID[id]);
  return `<div class="locked-preview ${ids.length>1?'dual':''}" style="--racer:${racers[0].color}"><div class="selection-pulse"></div><div class="locked-arts">${racers.map(r=>`<img src="${racerImage(r.id)}" alt="${escapeHtml(name(r,l))}">`).join('')}</div><div><span>${tx(l,locked?'你的选择':'已选第一名',locked?'YOUR PICKS':'FIRST PICK')} · ${escapeHtml(playerName)}</span><h3>${racers.map(r=>escapeHtml(name(r,l))).join(' + ')}</h3><p>${racers.map(r=>escapeHtml(powerText(r,l))).join(' / ')}</p><small>${locked?tx(l,'其他玩家现在只能看见“已锁定”状态','Other players only see that you are ready'):tx(l,'再从下方选择一名不同角色','Choose one different racer below')}</small></div></div>`;
}

function raceHud(v:GameView,me:string,l:Locale,motionLocked:boolean,presentedRacerId:string|null,finishChance:FinishChance){
  const presentedRacer=v.racers.find(x=>x.id===presentedRacerId);
  const presentedPlayerId=presentedRacer?.playerId??v.turnPlayerId;
  const turn=presentedPlayerId===me;
  const specials=availableSpecials(v,me);
  const turnPlayer=v.players.find(p=>p.id===presentedPlayerId);
  const turnRacer=presentedRacer??v.racers.find(x=>x.id===v.turnRacerId);
  const turnDef=turnRacer?RACER_BY_ID[turnRacer.racerId]:null;
  const finishReady=finishChance.possible&&finishChance.racerId===v.turnRacerId;
  const finishHint=finishReady?tx(l,`🏁 冲线机会 · ${finishChance.exact?'需精确掷出':'掷出'} ${finishChance.successfulRolls.join('/')}`,`🏁 FINISH CHANCE · ${finishChance.exact?'exactly ':''}${finishChance.successfulRolls.join('/')}`):tx(l,'点按，或向上甩出骰子','Tap or flick upward');
  const gate=v.presentationGate;
  const gatePlayer=gate?v.players.find(p=>p.id===gate.playerId):null;
  const warpGate=gate?.kind==='warp';
  return `<div class="race-hud">
    <div class="race-badge">${tx(l,`第 ${v.raceNumber+1} 局 · ${v.track==='mild'?'温和里程':'狂野里程'}`,`Race ${v.raceNumber+1} · ${v.track==='mild'?'Mild Mile':'Wild Mile'}`)}</div>
    <div class="turn-banner" style="--player:${turnPlayer?.color??'#fff'}"><i></i><span>${turn?tx(l,'轮到你了','Your turn'):tx(l,`${turnPlayer?.name??''} 正在行动`,`${turnPlayer?.name??''} is moving`)}</span><b>${turnDef?escapeHtml(name(turnDef,l)):''}</b></div>
    ${actorCard(v,l,presentedRacerId)}
    ${operationStatus(v,l)}
    <div class="command-dock">${gate?gate.playerId===me?`<button class="move-confirm" data-confirm-move><span>${warpGate?'✦':'☝'}</span><b>${warpGate?tx(l,'点击棋子传回起点','Tap your piece to warp to Start'):tx(l,'点击棋盘上的棋子开始移动','Tap your piece on the board to move')}</b><small>${warpGate?tx(l,'西西弗斯掷出 6，本次不再主移动','Sisyphus rolled 6; the main move ends'):tx(l,'也可以点这里开始逐格移动','Or tap here to start')}</small></button>`:`<div class="waiting moving-wait"><i></i>${warpGate?tx(l,`${gatePlayer?.name??''} 正在传回起点…`,`${gatePlayer?.name??''} is warping to Start…`):tx(l,`${gatePlayer?.name??''} 正在推动棋子…`,`${gatePlayer?.name??''} is moving their piece…`)}</div>`:motionLocked?`<div class="waiting moving-wait"><i></i>${tx(l,'正在逐格移动 / 展示能力联动…','Showing movement / power chain…')}</div>`:v.pendingDecision?.playerId===me?decision(v,l):turn?`<div class="turn-actions"><button class="roll-button ${finishReady?'finish-ready':''}" data-game="roll" draggable="true"><span class="roll-die-icon">${finishReady?'🏁':'⚄'}</span><span><b>${finishReady?tx(l,'冲线投骰！','ROLL FOR THE FINISH!'):tx(l,'投骰并移动','ROLL & MOVE')}</b><small>${finishHint}</small></span></button>${specials.map(s=>`<button class="btn special" data-special="${s.kind}">${escapeHtml(l==='zh'?s.label:s.labelEn)}</button>`).join('')}</div>`:`<div class="waiting">${tx(l,`等待 ${turnPlayer?.name??''}…`,`Waiting for ${turnPlayer?.name??''}…`)}</div>`}</div>
    <div class="board-help">${tx(l,'点按棋子查看角色卡 · 长按格子查看效果','Tap a piece for its card · Hold a space for its effect')}</div>
  </div>`;
}

function operationStatus(v:GameView,l:Locale){
  if(v.presentationGate){const p=v.players.find(x=>x.id===v.presentationGate!.playerId),r=v.racers.find(x=>x.id===v.presentationGate!.racerId),warp=v.presentationGate.kind==='warp';return`<div class="operation-status moving"><span>${warp?'✦':'☝'}</span><b>${escapeHtml(p?.name??'')}</b><small>${warp?tx(l,`掷出 6，等待将${r?`「${name(RACER_BY_ID[r.racerId],l)}」`:''}传回起点`,`rolled 6 and is about to warp back to Start`):tx(l,`已掷骰，等待推动${r?`「${name(RACER_BY_ID[r.racerId],l)}」`:''}`,`rolled and is about to move the piece`)}</small></div>`;}
  if(v.pendingDecision){const p=v.players.find(x=>x.id===v.pendingDecision!.playerId);return`<div class="operation-status deciding"><span>${v.pendingDecision.kind==='recover-trip'?'💫':'◆'}</span><b>${escapeHtml(p?.name??'')}</b><small>${escapeHtml(l==='zh'?v.pendingDecision.prompt:v.pendingDecision.promptEn)}</small></div>`;}
  const p=v.players.find(x=>x.id===v.turnPlayerId);const skills=v.turnPlayerId?availableSpecials(v,v.turnPlayerId):[];
  return`<div class="operation-status ready"><span>◎</span><b>${escapeHtml(p?.name??'')}</b><small>${skills.length?tx(l,`可使用：${skills.map(x=>x.label).join(' / ')}，或直接投骰`,`May use ${skills.map(x=>x.labelEn).join(' / ')}, or roll`):tx(l,'准备投骰','Ready to roll')}</small></div>`;
}

function actorCard(v:GameView,l:Locale,presentedRacerId:string|null){
  const presentedRacer=v.racers.find(r=>r.id===presentedRacerId);
  const player=v.players.find(p=>p.id===(presentedRacer?.playerId??v.turnPlayerId));
  if(!player)return'';
  const racer=presentedRacer??v.racers.find(r=>r.id===v.turnRacerId);
  if(!racer){
    const owned=v.racers.filter(r=>r.playerId===player.id&&!r.finished&&!r.eliminated);
    return `<article class="actor-card choosing" style="--player:${player.color}"><span class="player-avatar large">${escapeHtml(playerInitial(player.name,player.isBot))}</span><div><span class="actor-kicker">${tx(l,'当前玩家','ACTIVE PLAYER')}</span><h3>${escapeHtml(player.name)}</h3><p>${tx(l,'正在决定本轮两名角色的行动顺序','is choosing which of their two racers acts first')}</p><div class="actor-options">${owned.map(r=>`<img src="${racerImage(r.racerId)}" alt="${escapeHtml(name(RACER_BY_ID[r.racerId],l))}">`).join('')}</div></div></article>`;
  }
  const def=RACER_BY_ID[racer.racerId];
  const effective=RACER_BY_ID[getRacerPowerId(v,racer)]??def;
  const copied=effective.id!==def.id;
  const movingGate=v.presentationGate?.racerId===racer.id?v.presentationGate:null;
  const queued=(racer.id!==v.turnRacerId&&v.racers.find(r=>r.id===v.turnRacerId&&r.playerId===player.id))
    ??v.turnRacerQueue.map(id=>v.racers.find(r=>r.id===id)).find(Boolean);
  return `<article class="actor-card ${racer.tripped?'is-tripped':''}" style="--player:${player.color};--racer:${def.color}">
    <div class="actor-portrait"><img src="${racerImage(def.id)}" alt="${escapeHtml(name(def,l))}"><span>${movingGate?.kind==='warp'?tx(l,'传回起点','WARP TO START'):movingGate?tx(l,`前往第 ${movingGate.to} 格`,`TO SPACE ${movingGate.to}`):tx(l,`第 ${racer.position} 格`,`SPACE ${racer.position}`)}</span></div>
    <div class="actor-copy"><div class="actor-owner"><span class="player-avatar">${escapeHtml(playerInitial(player.name,player.isBot))}</span><span><small>${tx(l,'当前行动者','NOW ACTING')}</small><b>${escapeHtml(player.name)}</b></span></div><h3>${escapeHtml(name(def,l))}</h3><p>${escapeHtml(powerText(effective,l))}</p>${copied?`<small class="copied-power">${tx(l,'当前复制','Currently copying')} · ${escapeHtml(name(effective,l))}</small>`:''}</div>
    <div class="actor-locator"><span>${racer.tripped?'💫':'◎'}</span><b>${racer.tripped?tx(l,'当前已绊倒','Currently tripped'):tx(l,'棋盘同色光圈','Matching board ring')}</b>${queued?`<small>${tx(l,'随后行动','Then')} · ${escapeHtml(name(RACER_BY_ID[queued.racerId],l))}</small>`:''}</div>
  </article>`;
}

function decision(v:GameView,l:Locale){
  const d=v.pendingDecision!;
  return `<div class="decision"><b>${escapeHtml(l==='zh'?d.prompt:(d.promptEn??d.prompt))}</b><div class="choice-list">${d.options.map(o=>`<button class="btn choice" data-decide="${escapeAttr(o.value)}">${escapeHtml(l==='zh'?o.label:(o.labelEn??o.label))}</button>`).join('')}${d.optional?`<button class="btn ghost" data-decide="skip">${tx(l,'本回合不使用','Skip this turn')}</button>`:''}</div></div>`;
}

function result(v:GameView,me:string,l:Locale){
  const first=v.racers.find(r=>r.id===v.finishers[0]),second=v.racers.find(r=>r.id===v.finishers[1]);
  const label=(r:typeof first)=>r?`${v.players.find(p=>p.id===r.playerId)?.name??''} · ${name(RACER_BY_ID[r.racerId],l)}`:'—';
  return `<div class="result-card"><span class="eyebrow">${tx(l,`第 ${v.raceNumber+1} 局结束`,`Race ${v.raceNumber+1} complete`)}</span><h2>${tx(l,'冲线成绩','Finishers')}</h2><div class="podium"><div><span>🥇</span><b>${escapeHtml(label(first))}</b><small>+${[4,6,8,10][v.raceNumber]} ${tx(l,'分','points')}</small></div><div><span>🥈</span><b>${second?escapeHtml(label(second)):tx(l,'空缺','Unclaimed')}</b><small>${second?`+${[2,3,4,5][v.raceNumber]} ${tx(l,'分','points')}`:tx(l,'无人获得银花','No silver prize')}</small></div></div>${me===v.hostId?`<button class="btn primary" data-game="continue">${tx(l,'继续下一局','Next race')}</button>`:`<div class="waiting">${tx(l,'等待房主继续…','Waiting for the host…')}</div>`}</div>`;
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

function playerChip(v:GameView,id:string,l:Locale,orderIndex:number,activePlayerId:string|null){
  const p=v.players.find(x=>x.id===id)!;
  const racers=v.racers.filter(x=>x.playerId===id);
  const activeIndex=v.turnOrder.indexOf(activePlayerId??'');
  const delta=activeIndex<0?orderIndex:(orderIndex-activeIndex+Math.max(1,v.turnOrder.length))%Math.max(1,v.turnOrder.length);
  const orderLabel=v.phase==='race'?(delta===0?tx(l,'行动中','NOW'):delta===1?tx(l,'下一位','NEXT'):`+${delta}`):String(orderIndex+1);
  return `<div class="player-chip ${id===activePlayerId?'turn':''} ${p.connected?'':'offline'}" style="--player:${p.color}"><span class="turn-seq">${orderLabel}</span><span class="player-avatar">${escapeHtml(playerInitial(p.name,p.isBot))}</span><span class="player-summary"><b>${escapeHtml(p.name)}</b><small>${racers.length?racers.map(r=>escapeHtml(name(RACER_BY_ID[r.racerId],l))).join(' + '):p.isBot?tx(l,'AI 电脑','AI player'):tx(l,'已连接','Connected')}</small></span>${racers.length?`<span class="chip-racers">${racers.map(r=>`<img src="${racerImage(r.racerId)}" alt="">`).join('')}</span>`:''}<strong><small>${tx(l,'分','PTS')}</small>${p.score}</strong></div>`;
}

function diceTheater(v:GameView,l:Locale,gesture:DiceGesture,finishDrama:FinishChance|null){
  const player=v.players.find(p=>p.id===v.lastRollPlayerId)!;
  const racer=v.racers.find(r=>r.id===v.lastRollRacerId);
  const def=racer?RACER_BY_ID[racer.racerId]:null;
  const value=v.lastRoll??1;
  const body=dieBody(v);
  const finishMade=Boolean(finishDrama&&racer?.finished);
  const finishChanceHit=Boolean(finishDrama&&!finishMade&&finishDrama.successfulRolls.includes(value));
  const x=Math.max(-180,Math.min(180,gesture.x)),y=Math.max(-220,Math.min(-35,gesture.y));
  const outcomeText=finishMade?tx(l,'冲线成功！','FINISH!'):finishChanceHit?tx(l,'关键点数！等待选择…','CRITICAL ROLL! CHOOSE…'):tx(l,'还差一点！','SO CLOSE!');
  return `<div class="dice-theater ${finishDrama?'finish-drama':''} ${finishMade?'finish-made':finishChanceHit?'finish-chance-hit':'finish-missed'}" style="--player:${player?.color??'#fff'};--die-body:${body};--throw-x:${x}px;--throw-y:${y}px;--throw-power:${Math.max(.55,Math.min(1.35,gesture.power))};--throw-twist:${gesture.twist}deg">${finishDrama?`<div class="finish-suspense"><span>🏁 ${tx(l,'冲线投骰','ROLL FOR THE FINISH')}</span><b>${tx(l,'全场屏息…','EVERYONE HOLD YOUR BREATH…')}</b><small>${tx(l,`可冲线点数：${finishDrama.successfulRolls.join('/')}`,`Winning rolls: ${finishDrama.successfulRolls.join('/')}`)}</small></div>`:''}<div class="dice-spotlight"></div><div class="dice-cube" data-value="${value}">${[1,2,3,4,5,6].map(dieFace).join('')}</div><div class="dice-result" data-face="${value}"><b>${value}</b></div><div class="dice-call"><span>${escapeHtml(player?.name??'')}</span><b>${value} ${tx(l,'点','')}</b><small>${def?escapeHtml(name(def,l)):''}</small></div>${finishDrama?`<div class="finish-outcome">${outcomeText}</div>`:''}</div>`;
}

function effectTheater(v:GameView,l:Locale,event:LogEntry,queueLength:number){
  const racer=v.racers.find(r=>r.id===event.sourceRacerId);
  if(!racer)return'';
  const player=v.players.find(p=>p.id===racer.playerId)!;
  const def=RACER_BY_ID[racer.racerId];
  const label=event.effectKind==='track'?tx(l,'跑道效果','TRACK EFFECT'):event.effectKind==='finish'?tx(l,'冲线结算','FINISH'):event.effectKind==='decision'?tx(l,'玩家操作','PLAYER CHOICE'):tx(l,'角色能力联动','POWER CHAIN');
  return `<div class="effect-theater ${event.tone??''}" style="--player:${player.color};--racer:${def.color}"><img src="${racerImage(def.id)}" alt=""><div><span>${label}</span><b>${escapeHtml(player.name)} · ${escapeHtml(name(def,l))}</b><p>${escapeHtml(l==='zh'?event.text:event.textEn)}</p></div><aside><i>◎</i><small>${tx(l,'棋盘正在高亮','Highlighted on board')}</small>${queueLength?`<em>+${queueLength}</em>`:''}</aside></div>`;
}

function revealTheater(v:GameView,l:Locale,index:number,remainingMs:number){
  const current=v.racers[index%v.racers.length];
  const p=v.players.find(x=>x.id===current.playerId)!;
  const r=RACER_BY_ID[current.racerId];
  const seconds=Math.max(0,Math.ceil(remainingMs/1000));
  return `<div class="reveal-theater"><div class="reveal-kicker">${tx(l,`第 ${v.raceNumber+1} 局 · 全员揭晓 · ${index+1}/${v.racers.length}`,`Race ${v.raceNumber+1} · Racer Reveal · ${index+1}/${v.racers.length}`)}</div><div class="reveal-focus" style="--racer:${r.color};--player:${p.color}"><div class="reveal-card"><img src="${racerImage(r.id)}" alt="${escapeHtml(name(r,l))}"><i>${escapeHtml(p.name)}</i></div><div class="reveal-copy"><span>${escapeHtml(p.name)} ${tx(l,'派出','reveals')}</span><h2>${escapeHtml(name(r,l))}</h2><p>${escapeHtml(powerText(r,l))}</p></div></div><div class="reveal-controls"><button data-reveal-next>${tx(l,'我看完了，继续','Got it — continue')}</button><small>${tx(l,`${seconds} 秒后自动继续`,`Auto-continue in ${seconds}s`)}</small><i style="--remaining:${Math.max(0,Math.min(1,remainingMs/7000))}"></i></div><div class="reveal-roster">${v.racers.map((x,i)=>{const d=RACER_BY_ID[x.racerId];const owner=v.players.find(p=>p.id===x.playerId)!;return`<div class="${i===index%v.racers.length?'active':''}" style="--player:${owner.color}"><img src="${racerImage(d.id)}" alt=""><span>${escapeHtml(owner.name)}</span></div>`;}).join('')}</div></div>`;
}

function settings(l:Locale,soundEnabled:boolean,autoAdvance:boolean){return `<div class="modal-backdrop" data-action="close-settings"><section class="settings-card" role="dialog" aria-modal="true"><button class="modal-close" data-action="close-settings">×</button><span class="eyebrow">${tx(l,'游戏设置','GAME SETTINGS')}</span><h2>${tx(l,'语言 / Language','Language / 语言')}</h2><p>${tx(l,'这些设置只影响你自己的手机，可在比赛中随时切换。','These settings are saved on this device and can be changed during a match.')}</p><div class="language-grid"><button class="language-choice ${l==='zh'?'active':''}" data-locale="zh"><b>中文</b><small>角色能力中文翻译</small></button><button class="language-choice ${l==='en'?'active':''}" data-locale="en"><b>English</b><small>Original rulebook text</small></button></div><button class="sound-choice ${soundEnabled?'active':''}" data-sound><span>${soundEnabled?'🔊':'🔇'}</span><span><b>${tx(l,'冲线期待音效','Finish suspense sound')}</b><small>${soundEnabled?tx(l,'已开启','On'):tx(l,'已关闭','Off')}</small></span><i aria-hidden="true"></i></button><button class="sound-choice ${autoAdvance?'active':''}" data-auto><span>${autoAdvance?'⚡':'☝'}</span><span><b>${tx(l,'自动跳过辅助操作','Auto-skip helper actions')}</b><small>${autoAdvance?tx(l,'快速揭晓、自动推棋和扶起','Fast reveal, auto-move and stand up'):tx(l,'由玩家点击完成，更有桌游感','Tap to complete them for a tabletop feel')}</small></span><i aria-hidden="true"></i></button></section></div>`;}

function inspector(v:GameView,l:Locale,racerStateId:string|null,space:number|null){
  if(racerStateId){
    const racer=v.racers.find(r=>r.id===racerStateId);if(!racer)return'';const player=v.players.find(p=>p.id===racer.playerId)!;const def=RACER_BY_ID[racer.racerId];const effective=RACER_BY_ID[getRacerPowerId(v,racer)]??def;
    return`<div class="inspect-backdrop" data-action="close-inspector"><section class="inspect-sheet" role="dialog" aria-modal="true" style="--player:${player.color};--racer:${def.color}"><button class="modal-close" data-action="close-inspector">×</button><img src="${racerImage(def.id)}" alt="${escapeHtml(name(def,l))}"><div><span>${escapeHtml(player.name)} · ${tx(l,`第 ${racer.position} 格`,`SPACE ${racer.position}`)}</span><h2>${escapeHtml(name(def,l))}</h2><p>${escapeHtml(powerText(effective,l))}</p>${effective.id!==def.id?`<small>${tx(l,'复制能力','Copied power')} · ${escapeHtml(name(effective,l))}</small>`:''}<div class="inspect-tags"><b>${racer.tripped?tx(l,'💫 已绊倒','💫 TRIPPED'):tx(l,'✓ 站立','✓ UPRIGHT')}</b>${racer.finished?`<b>${tx(l,`第 ${racer.finished} 名冲线`,`FINISHED #${racer.finished}`)}</b>`:''}</div></div></section></div>`;
  }
  if(space===null)return'';const info=spaceInfo(v,space,l);
  return`<div class="inspect-backdrop" data-action="close-inspector"><section class="inspect-sheet space-sheet" role="dialog" aria-modal="true" style="--racer:${info.color}"><button class="modal-close" data-action="close-inspector">×</button><strong>${info.icon}</strong><div><span>${tx(l,`跑道第 ${space} 格`,`TRACK SPACE ${space}`)}</span><h2>${escapeHtml(info.title)}</h2><p>${escapeHtml(info.body)}</p><small>${tx(l,'长按其他格子可以继续检查地图','Hold another space to inspect it')}</small></div></section></div>`;
}

function spaceInfo(v:GameView,space:number,l:Locale){
  if(space===0)return{icon:'START',title:tx(l,'起点','Start'),body:tx(l,'所有角色从这里开始比赛。','Every racer begins here.'),color:'#55d5ee'};
  if(space===30)return{icon:'🏁',title:tx(l,'终点','Finish'),body:tx(l,'第二名角色冲线后，本局立即结束。','The race ends when the second racer finishes.'),color:'#ffd52a'};
  if(v.track==='wild'&&WILD_STARS.has(space))return{icon:'★1',title:tx(l,'星星奖励格','Star space'),body:tx(l,'停在这里时，玩家立即获得 1 分铜星。','Stop here to gain 1 bronze-star point.'),color:'#ffd52a'};
  if(v.track==='wild'&&WILD_ROCKS.has(space))return{icon:'TRIP!',title:tx(l,'石头陷阱','Rock trap'),body:tx(l,'停在这里会绊倒；该角色下次轮到时扶起并跳过主移动。','Stopping here trips the racer. On its next turn, stand it up and skip the main move.'),color:'#f04cab'};
  if(v.track==='wild'&&WILD_ARROWS[space]){const amount=WILD_ARROWS[space];return{icon:`${amount>0?'➜':'←'}${Math.abs(amount)}`,title:tx(l,'箭头格','Arrow space'),body:tx(l,`停下后沿箭头${amount>0?'前进':'后退'} ${Math.abs(amount)} 格；这算一次独立移动，会继续触发沿途与落格效果。`,`Move ${Math.abs(amount)} space${Math.abs(amount)===1?'':'s'} ${amount>0?'forward':'back'} as a separate move, still triggering passed and stopped effects.`),color:'#55d5ee'};}
  return{icon:String(space),title:tx(l,'普通跑道格','Normal space'),body:tx(l,'这里没有额外跑道效果；角色仍可能触发彼此的能力。','This space has no extra track effect, though racer powers may still trigger.'),color:'#fff8e8'};
}

export function quickRules(l:Locale,compact=false){return `<details class="quick-rules ${compact?'compact':''}" ${compact?'':'open'}><summary>${tx(l,'60 秒快速规则','Rules in 60 seconds')}</summary><ol><li><b>${tx(l,'选秀','Draft')}</b><span>${tx(l,'3–4 人每人选 4 名；2 人按官方变体每人选 8 名。','Draft 4 racers each with 3–4 players; the official 2-player mode drafts 8 each.')}</span></li><li><b>${tx(l,'出赛','Reveal')}</b><span>${tx(l,'3–4 人每局秘密选 1 名；2 人每局秘密选 2 名，始终保持 4 名角色在场。','Secretly choose 1 racer each with 3–4 players, or 2 each in a 2-player game so 4 racers are always on track.')}</span></li><li><b>${tx(l,'行动','Turns')}</b><span>${tx(l,'轮到你时掷骰并逐格移动；2 人局可决定自己的两名角色谁先行动。','Roll and move space by space; in a 2-player game, choose which of your two racers acts first.')}</span></li><li><b>${tx(l,'冲线','Finish')}</b><span>${tx(l,'第二名冲线后本局立刻结束，前两名得分。','The race ends as soon as 2nd place finishes; both score.')}</span></li><li><b>${tx(l,'获胜','Win')}</b><span>${tx(l,'共 4 局，温和与狂野交替；总分最高者获胜。','Play 4 races, alternating Mild and Wild. Highest total score wins.')}</span></li></ol><p>${tx(l,'狂野跑道：星星停留得 1 分；石头使角色绊倒；箭头产生一次独立移动，并继续触发沿途能力与落格效果。','Wild track: stars score 1, rocks trip, and arrows create a separate move that still triggers movement and stopping effects.')}</p></details>`;}

function dieFace(value:number){return`<span class="die-face face-${value}" data-face="${value}"><b>${value}</b></span>`;}
function dieBody(v:GameView){
  const bodies=['#fff7e8','#cbb5ff','#ffab55','#9fe7ff','#fff086','#ffaddb'];
  const owner=Math.max(0,v.players.findIndex(p=>p.id===v.lastRollPlayerId));
  return bodies[(owner*2+v.rollSeq)%bodies.length];
}
function name(r:(typeof RACER_BY_ID)[string],l:Locale){return l==='zh'?r.nameZh:r.name;}
function powerText(r:(typeof RACER_BY_ID)[string],l:Locale){return l==='zh'?r.powerZh:r.power;}
function tx(l:Locale,zh:string,en:string){return l==='zh'?zh:en;}
function racerImage(id:string){return`${import.meta.env.BASE_URL}racers/${id}.webp`;}
function playerInitial(name:string,isBot=false){return isBot?'AI':Array.from(name.trim())[0]?.toUpperCase()||'?';}
function playerOrder(v:GameView){return v.turnOrder.length?[...v.turnOrder]:v.players.map(p=>p.id);}

function bind(root:HTMLElement,h:UiHandlers){
  root.querySelector<HTMLElement>('.settings-card')?.addEventListener('click',event=>event.stopPropagation());
  root.querySelector<HTMLElement>('.inspect-sheet')?.addEventListener('click',event=>event.stopPropagation());
  root.querySelectorAll<HTMLElement>('[data-action="copy"]').forEach(x=>x.onclick=h.copyInvite);
  root.querySelectorAll<HTMLElement>('[data-action="add-bot"]').forEach(x=>x.onclick=h.addBot);
  root.querySelectorAll<HTMLElement>('[data-action="remove-bot"]').forEach(x=>x.onclick=h.removeBot);
  root.querySelectorAll<HTMLElement>('[data-action="leave"]').forEach(x=>x.onclick=h.leave);
  root.querySelectorAll<HTMLElement>('[data-action="settings"]').forEach(x=>x.onclick=h.openSettings);
  root.querySelectorAll<HTMLElement>('[data-action="close-settings"]').forEach(x=>x.onclick=h.closeSettings);
  root.querySelectorAll<HTMLElement>('[data-action="log"]').forEach(x=>x.onclick=h.toggleLog);
  root.querySelectorAll<HTMLElement>('[data-locale]').forEach(x=>x.onclick=()=>h.setLocale(x.dataset.locale as Locale));
  root.querySelectorAll<HTMLElement>('[data-sound]').forEach(x=>x.onclick=h.toggleSound);
  root.querySelectorAll<HTMLElement>('[data-auto]').forEach(x=>x.onclick=h.toggleAutoAdvance);
  root.querySelectorAll<HTMLElement>('[data-reveal-next]').forEach(x=>x.onclick=h.skipReveal);
  root.querySelectorAll<HTMLElement>('[data-action="close-inspector"]').forEach(x=>x.onclick=h.closeInspector);
  root.querySelectorAll<HTMLElement>('[data-confirm-move]').forEach(x=>x.onclick=h.confirmMovement);
  root.querySelectorAll<HTMLElement>('[data-game]').forEach(x=>x.onclick=()=>{const a=x.dataset.game;if(a==='start')setTimeout(()=>h.dispatch({type:'START_GAME'}),0);if(a==='continue')h.dispatch({type:'CONTINUE'});});
  const roll=root.querySelector<HTMLButtonElement>('.roll-button');if(roll)bindRollGesture(roll,h);
  root.querySelectorAll<HTMLButtonElement>('[data-card]').forEach(x=>x.onclick=()=>{if(!x.dataset.card||x.classList.contains('is-picking'))return;const [kind,id]=x.dataset.card.split(':');x.classList.add('is-picking');x.closest('.card-grid')?.classList.add('is-resolving');x.closest('.wide-panel')?.setAttribute('aria-busy','true');x.parentElement?.querySelectorAll<HTMLButtonElement>('.racer-card').forEach(card=>card.disabled=true);window.setTimeout(()=>{if(kind==='draft')h.dispatch({type:'DRAFT',racerId:id});if(kind==='select')h.dispatch({type:'SELECT_RACER',racerId:id});},260);});
  root.querySelectorAll<HTMLElement>('[data-special]').forEach(x=>x.onclick=()=>h.dispatch({type:'USE_SPECIAL',kind:x.dataset.special as never}));
  root.querySelectorAll<HTMLElement>('[data-decide]').forEach(x=>x.onclick=()=>h.dispatch({type:'DECIDE',value:x.dataset.decide!}));
}

function bindRollGesture(button:HTMLButtonElement,h:UiHandlers){
  let startX=0,startY=0,startAt=0,dragging=false,handled=false,htmlDragging=false;
  button.onpointerdown=event=>{dragging=true;startX=event.clientX;startY=event.clientY;startAt=performance.now();button.setPointerCapture(event.pointerId);button.classList.add('is-grabbed');};
  const launch=(event:PointerEvent)=>{if(!dragging)return;dragging=false;handled=true;button.classList.remove('is-grabbed');button.style.transform='';const elapsed=Math.max(90,performance.now()-startAt),dx=event.clientX-startX,dy=event.clientY-startY,distance=Math.hypot(dx,dy);h.rollDice({x:dx*1.4,y:dy<-12?dy*1.8:-80,power:Math.max(.6,Math.min(1.35,distance/elapsed*1.8+.62)),twist:dx*.9+(dy<0?-120:80)});};
  button.onpointermove=event=>{if(!dragging)return;const dx=event.clientX-startX,dy=event.clientY-startY;button.style.transform=`translate(${dx*.28}px,${Math.min(12,dy*.28)}px) rotate(${dx*.05}deg)`;if(dy<-54&&Math.hypot(dx,dy)>58)launch(event);};
  button.onpointerup=launch;
  button.onpointercancel=()=>{dragging=false;button.classList.remove('is-grabbed');button.style.transform='';};
  button.ondragstart=event=>{htmlDragging=true;startX=event.clientX;startY=event.clientY;startAt=performance.now();button.classList.add('is-grabbed');};
  button.ondragend=event=>{if(!htmlDragging)return;htmlDragging=false;dragging=true;launch(event as unknown as PointerEvent);};
  button.onclick=()=>{if(handled){handled=false;return;}h.rollDice({x:28,y:-90,power:.75,twist:-150});};
}

function escapeHtml(s:string){return s.replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]!));}
function escapeAttr(s:string){return escapeHtml(s);}

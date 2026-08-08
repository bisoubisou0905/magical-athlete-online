import { RACER_BY_ID } from '../game/racers';
import { availableSpecials, currentDrafter } from '../game/engine';
import type { GameAction, GameView } from '../game/types';

export interface UiHandlers { dispatch:(a:GameAction)=>void; copyInvite:()=>void; addBot:()=>void; removeBot:()=>void; leave:()=>void; }

export function renderGame(root:HTMLElement,view:GameView,h:UiHandlers,status=''){
  const me=view.players.find(p=>p.id===view.viewerId)!;
  root.innerHTML=`
    <main class="game-shell">
      <header class="topbar">
        <button class="brand" data-action="leave"><span class="brand-dot"></span>魔法运动会</button>
        <button class="room-pill" data-action="copy">房间 ${view.roomCode} · 复制邀请</button>
      </header>
      <section class="score-strip">${view.players.map(p=>playerChip(p.id,p.name,p.score,p.color,p.connected,p.id===view.turnPlayerId)).join('')}</section>
      <section class="stage ${view.phase==='lobby'||view.phase==='draft'||view.phase==='select'?'panel-stage':''}">
        ${stageContent(view,me.id)}
      </section>
      ${view.phase==='race'||view.phase==='raceResult'||view.phase==='gameOver'?'<canvas id="track-canvas" aria-label="三维赛道"></canvas>':''}
      <aside class="log-panel"><div class="log-title">赛事播报</div><div class="log-scroll">${view.logs.slice(-9).reverse().map(l=>`<p class="log ${l.tone??''}">${escapeHtml(l.text)}</p>`).join('')}</div></aside>
      ${status?`<div class="toast">${escapeHtml(status)}</div>`:''}
    </main>`;
  bind(root,view,h);
}

function stageContent(v:GameView,me:string){
  if(v.phase==='lobby')return lobby(v,me);
  if(v.phase==='draft')return draft(v,me);
  if(v.phase==='select')return selection(v,me);
  if(v.phase==='race')return raceHud(v,me);
  if(v.phase==='raceResult')return result(v,me);
  return gameOver(v);
}

function lobby(v:GameView,me:string){const host=me===v.hostId;const bots=v.players.filter(p=>p.isBot).length;return`<div class="center-panel"><span class="eyebrow">2–4 人动态房间</span><h1>召集你的<br><em>混乱跑团</em></h1><div class="room-code">${v.roomCode}</div><p>真人与电脑可自由组合，达到 2 名选手即可开始。房主负责规则判定，请保持页面打开。</p><div class="lobby-list">${v.players.map((p,i)=>`<div class="lobby-seat ${p.connected?'ready':''}"><span>${i+1}</span><b>${escapeHtml(p.name)}</b><small>${p.isBot?'AI 电脑':'已连接'}</small></div>`).join('')}${Array.from({length:4-v.players.length},(_,i)=>`<div class="lobby-seat"><span>${v.players.length+i+1}</span><b>等待选手…</b><small>空位</small></div>`).join('')}</div>${host?`<div class="action-row"><button class="btn secondary" data-action="add-bot" ${v.players.length>=4?'disabled':''}>+ 添加 AI</button><button class="btn secondary" data-action="remove-bot" ${bots===0?'disabled':''}>− 移除 AI</button><button class="btn primary" data-game='start' ${v.players.length<2?'disabled':''}>以 ${v.players.length} 人开始</button></div>`:'<div class="waiting">等待房主开始比赛…</div>'}</div>`;}

function draft(v:GameView,me:string){const drafter=currentDrafter(v);const mine=drafter===me;return`<div class="wide-panel"><span class="eyebrow">蛇形选秀 · ${v.draftIndex+1}/${v.draftOrder.length}</span><h2>${mine?'轮到你招募！':`等待 ${escapeHtml(v.players.find(p=>p.id===drafter)?.name??'')} 选择`}</h2><div class="card-grid">${v.draftPool.map(id=>racerCard(id,mine,`draft:${id}`)).join('')}</div></div>`;}

function selection(v:GameView,me:string){const p=v.players.find(x=>x.id===me)!;const locked=Boolean(v.selected[me]);return`<div class="wide-panel"><span class="eyebrow">第 ${v.raceNumber+1}/4 局 · ${v.raceNumber%2===0?'温和里程':'狂野里程'}</span><h2>${locked?'角色已锁定，等待其他玩家…':'秘密选择本局角色'}</h2><p class="subcopy">每名角色整场只能使用一次；后面的比赛奖励更高。</p><div class="card-grid hand">${p.hand.filter(id=>!p.used.includes(id)).map(id=>racerCard(id,!locked,`select:${id}`)).join('')}</div><div class="ready-dots">${v.players.map(x=>`<span class="${v.selected[x.id]?'on':''}">${escapeHtml(x.name)}</span>`).join('')}</div></div>`;}

function raceHud(v:GameView,me:string){const r=v.racers.find(x=>x.playerId===me);const turn=v.turnPlayerId===me;const def=r?RACER_BY_ID[r.racerId]:null;const specials=availableSpecials(v,me);return`<div class="race-hud"><div class="race-badge">第 ${v.raceNumber+1} 局 · ${v.track==='mild'?'温和':'狂野'}</div><div class="my-racer" style="--racer:${def?.color}">${r?`<img class="racer-icon" src="${racerImage(r.racerId)}" alt="${escapeHtml(def?.nameZh??'角色')}">`:''}<div><b>${def?.nameZh??''}</b><small>${def?.powerZh??''}</small></div></div>${v.pendingDecision?.playerId===me?decision(v):turn?`<div class="turn-actions"><button class="roll-button" data-game="roll"><span>${v.lastRoll??'⚄'}</span>掷骰移动</button>${specials.map(s=>`<button class="btn special" data-special="${s.kind}">${s.label}</button>`).join('')}</div>`:`<div class="waiting">等待 ${escapeHtml(v.players.find(p=>p.id===v.turnPlayerId)?.name??'')} 行动…</div>`}</div>`;}

function decision(v:GameView){const d=v.pendingDecision!;return`<div class="decision"><b>${escapeHtml(d.prompt)}</b><div class="choice-list">${d.options.map(o=>`<button class="btn choice" data-decide="${o.value}">${escapeHtml(o.label)}</button>`).join('')}${d.optional?'<button class="btn ghost" data-decide="skip">暂不使用</button>':''}</div></div>`;}

function result(v:GameView,me:string){const first=v.finishers[0],second=v.finishers[1];return`<div class="result-card"><span class="eyebrow">第 ${v.raceNumber+1} 局结束</span><h2>冲线成绩</h2><div class="podium"><div><span>🥇</span><b>${first?escapeHtml(v.players.find(p=>p.id===first)!.name):'—'}</b><small>+${[4,6,8,10][v.raceNumber]} 分</small></div><div><span>🥈</span><b>${second?escapeHtml(v.players.find(p=>p.id===second)!.name):'空缺'}</b><small>${second?`+${[2,3,4,5][v.raceNumber]} 分`:'无人获得银花'}</small></div></div>${me===v.hostId?'<button class="btn primary" data-game="continue">继续</button>':'<div class="waiting">等待房主继续…</div>'}</div>`;}

function gameOver(v:GameView){const top=Math.max(...v.players.map(p=>p.score));const winners=v.players.filter(p=>p.score===top);return`<div class="result-card final"><span class="eyebrow">四局比赛完成</span><h1>${winners.map(p=>escapeHtml(p.name)).join('、')}<br><em>赢得比赛！</em></h1><div class="final-scores">${[...v.players].sort((a,b)=>b.score-a.score).map((p,i)=>`<div><span>${i+1}</span><b>${escapeHtml(p.name)}</b><strong>${p.score} 分</strong></div>`).join('')}</div><button class="btn secondary" data-action="leave">返回首页</button></div>`;}

function racerCard(id:string,enabled:boolean,action:string){const r=RACER_BY_ID[id];return`<button class="racer-card" style="--racer:${r.color}" data-card="${enabled?action:''}" ${enabled?'':'disabled'}><span class="racer-art"><img src="${racerImage(id)}" alt="${escapeHtml(r.nameZh)}"></span><b>${r.nameZh}</b><small>${r.name}</small><p>${r.powerZh}</p></button>`;}
function playerChip(id:string,name:string,score:number,color:string,connected:boolean,turn:boolean){return`<div class="player-chip ${turn?'turn':''} ${connected?'':'offline'}" style="--player:${color}"><i></i><span>${escapeHtml(name)}</span><b>${score}</b></div>`;}
function racerImage(id:string){return`${import.meta.env.BASE_URL}racers/${id}.webp`;}

function bind(root:HTMLElement,v:GameView,h:UiHandlers){
  root.querySelectorAll<HTMLElement>('[data-action="copy"]').forEach(x=>x.onclick=h.copyInvite);root.querySelectorAll<HTMLElement>('[data-action="add-bot"]').forEach(x=>x.onclick=h.addBot);root.querySelectorAll<HTMLElement>('[data-action="remove-bot"]').forEach(x=>x.onclick=h.removeBot);root.querySelectorAll<HTMLElement>('[data-action="leave"]').forEach(x=>x.onclick=h.leave);
  root.querySelectorAll<HTMLElement>('[data-game]').forEach(x=>x.onclick=()=>{const a=x.dataset.game;if(a==='start')setTimeout(()=>h.dispatch({type:'START_GAME'}),0);if(a==='roll')h.dispatch({type:'ROLL'});if(a==='continue')h.dispatch({type:'CONTINUE'});});
  root.querySelectorAll<HTMLElement>('[data-card]').forEach(x=>x.onclick=()=>{const [kind,id]=(x.dataset.card||'').split(':');if(kind==='draft')h.dispatch({type:'DRAFT',racerId:id});if(kind==='select')h.dispatch({type:'SELECT_RACER',racerId:id});});
  root.querySelectorAll<HTMLElement>('[data-special]').forEach(x=>x.onclick=()=>h.dispatch({type:'USE_SPECIAL',kind:x.dataset.special as never}));root.querySelectorAll<HTMLElement>('[data-decide]').forEach(x=>x.onclick=()=>h.dispatch({type:'DECIDE',value:x.dataset.decide!}));
}
function escapeHtml(s:string){return s.replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]!));}

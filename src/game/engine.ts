import { RACERS, RACER_BY_ID } from './racers';
import type { DecisionKind, GameAction, GameState, PlayerState, RacerState, TrackKind } from './types';

export const TRACK_LENGTH = 30;
const PLAYER_COLORS = ['#ff4b2b', '#55d5ee', '#f04cab', '#ffd52a'];
const GOLD = [4, 6, 8, 10];
const SILVER = [2, 3, 4, 5];
const WILD_STARS = new Set([4, 14, 24]);
const WILD_ROCKS = new Set([8, 22]);
const WILD_ARROWS: Record<number, number> = { 5: 2, 11: -2, 17: 3, 26: -3 };

export function createGame(roomCode: string, hostId: string, hostName: string, seed = Date.now() >>> 0): GameState {
  return {
    roomCode, hostId, phase: 'lobby',
    players: [createPlayer(hostId, hostName, 0)],
    draftPool: [], draftOrder: [], draftIndex: 0,
    raceNumber: 0, track: 'mild', selected: {}, racers: [],
    turnPlayerId: null, turnOrder: [], finishers: [], previousLastPlayerId: null,
    winnersByRace: [], logs: [], pendingDecision: null, lastRoll: null,
    nextLogId: 1, rngSeed: seed || 1, demoMode: false, prediction: {}, skippedTurns: {}
  };
}

export function createPlayer(id: string, name: string, index: number, isBot = false): PlayerState {
  return { id, name: name.trim().slice(0, 16) || `选手 ${index + 1}`, color: PLAYER_COLORS[index], hand: [], used: [], score: 0, connected: true, isBot };
}

export function addPlayer(state: GameState, id: string, name: string, isBot = false): GameState {
  const s = clone(state);
  if (s.phase !== 'lobby' || s.players.length >= 4 || s.players.some(p => p.id === id)) return s;
  s.players.push(createPlayer(id, name, s.players.length, isBot));
  addLog(s, `${name} 加入了房间`);
  return s;
}

export function addDemoBots(state: GameState): GameState {
  let s = clone(state);
  const names = ['小火花', '蓝旋风', '骰子王'];
  while (s.players.length < 4) s = addPlayer(s, `bot-${s.players.length}`, names[s.players.length - 1], true);
  s.demoMode = true;
  return s;
}

export function addBot(state: GameState): GameState {
  if (state.phase !== 'lobby' || state.players.length >= 4) return state;
  const used = new Set(state.players.filter(p => p.isBot).map(p => p.name));
  const names = ['小火花', '蓝旋风', '骰子王', '魔法豆'];
  const name = names.find(n => !used.has(n)) ?? `电脑 ${state.players.length}`;
  const id = `bot-${crypto.randomUUID()}`;
  const s = addPlayer(state, id, name, true);
  s.demoMode = true;
  return s;
}

export function removeBot(state: GameState): GameState {
  const s = clone(state);
  if (s.phase !== 'lobby') return state;
  const index = s.players.findLastIndex(p => p.isBot);
  if (index < 0) return state;
  const [bot] = s.players.splice(index, 1);
  s.players.forEach((p, i) => p.color = PLAYER_COLORS[i]);
  addLog(s, `${bot.name} 离开了房间`);
  s.demoMode = s.players.some(p => p.isBot);
  return s;
}

export function applyAction(state: GameState, playerId: string, action: GameAction): GameState {
  const s = clone(state);
  const player = s.players.find(p => p.id === playerId);
  if (!player) return state;

  if (action.type === 'START_GAME') {
    if (playerId !== s.hostId || s.phase !== 'lobby' || s.players.length < 2 || s.players.length > 4) return state;
    startDraft(s);
    return s;
  }
  if (action.type === 'DRAFT') {
    if (s.phase !== 'draft' || currentDrafter(s) !== playerId || !s.draftPool.includes(action.racerId)) return state;
    player.hand.push(action.racerId);
    s.draftPool = s.draftPool.filter(id => id !== action.racerId);
    addLog(s, `${player.name} 招募了 ${RACER_BY_ID[action.racerId].nameZh}`, 'power');
    s.draftIndex++;
    if (s.draftIndex >= s.draftOrder.length) beginSelection(s);
    return s;
  }
  if (action.type === 'SELECT_RACER') {
    if (s.phase !== 'select' || s.selected[playerId] || !player.hand.includes(action.racerId) || player.used.includes(action.racerId)) return state;
    s.selected[playerId] = action.racerId;
    addLog(s, `${player.name} 已锁定本局角色`);
    if (s.players.every(p => s.selected[p.id])) beginRace(s);
    return s;
  }
  if (action.type === 'CONTINUE') {
    if (s.phase !== 'raceResult' || playerId !== s.hostId) return state;
    continueAfterRace(s);
    return s;
  }
  if (s.phase !== 'race' || s.turnPlayerId !== playerId) return state;

  if (action.type === 'DECIDE') {
    if (!s.pendingDecision || s.pendingDecision.playerId !== playerId) return state;
    resolveDecision(s, action.value);
    return s;
  }
  if (s.pendingDecision) return state;
  if (action.type === 'USE_SPECIAL') {
    openSpecial(s, playerId, action.kind);
    return s;
  }
  if (action.type === 'ROLL') {
    beginMainMove(s);
    return s;
  }
  return state;
}

export function currentDrafter(s: GameState): string | null { return s.draftOrder[s.draftIndex] ?? null; }

function startDraft(s: GameState) {
  const ids = shuffle(s, RACERS.map(r => r.id));
  const count = s.players.length;
  const start = rand(s, count);
  const clockwise = rotate(s.players.map(p => p.id), start);
  const secondStart = rotate(s.players.map(p => p.id), (start + 1) % count);
  s.draftPool = ids.slice(0, count * 4);
  s.draftOrder = [...clockwise, ...clockwise.slice().reverse(), ...secondStart, ...secondStart.slice().reverse()];
  s.draftIndex = 0;
  s.phase = 'draft';
  addLog(s, `选秀开始，${nameOf(s, clockwise[0])} 首选`, 'score');
}

function beginSelection(s: GameState) {
  s.phase = 'select';
  s.selected = Object.fromEntries(s.players.map(p => [p.id, null]));
  addLog(s, '选秀完成！所有选手秘密选择第一局角色。', 'score');
}

function beginRace(s: GameState) {
  s.phase = 'race';
  s.track = (s.raceNumber % 2 === 0 ? 'mild' : 'wild') as TrackKind;
  s.racers = s.players.map(p => ({
    playerId: p.id, racerId: s.selected[p.id]!, position: 0, tripped: false, finished: null,
    eliminated: false, lastTurnStart: 0, firstTurn: true, rerolls: 0
  }));
  s.finishers = [];
  s.pendingDecision = null;
  s.lastRoll = null;
  s.prediction = {};
  s.skippedTurns = {};

  for (const r of s.racers) {
    const p = playerFor(s, r);
    p.used.push(r.racerId);
    if (r.racerId === 'sisyphus') { p.score += 4; power(s, r, `${p.name} 的西西弗斯赛前获得 4 分`); }
    if (r.racerId === 'egg') {
      const used = new Set(s.racers.map(x => x.racerId));
      const candidates = shuffle(s, RACERS.map(x => x.id).filter(id => !used.has(id) && id !== 'egg')).slice(0, 3);
      r.powerOverride = candidates[rand(s, candidates.length)];
      power(s, r, `${p.name} 的蛋孵出了 ${RACER_BY_ID[r.powerOverride].nameZh} 能力`);
    }
    if (r.racerId === 'twin' && s.winnersByRace.length) {
      const winnerPlayer = s.players.find(x => x.id === s.winnersByRace[s.winnersByRace.length - 1]);
      const previousWinnerRacer = winnerPlayer?.used[s.raceNumber - 1];
      if (previousWinnerRacer) {
        r.powerOverride = previousWinnerRacer;
        power(s, r, `${p.name} 的双生子复制了 ${RACER_BY_ID[previousWinnerRacer].nameZh}`);
      }
    }
  }

  const first = s.previousLastPlayerId && s.players.some(p => p.id === s.previousLastPlayerId)
    ? s.previousLastPlayerId : s.players[rand(s, s.players.length)].id;
  const base = s.players.map(p => p.id);
  s.turnOrder = rotate(base, base.indexOf(first));
  s.turnPlayerId = s.turnOrder[0];
  addLog(s, `第 ${s.raceNumber + 1} 局开始：${s.track === 'mild' ? '温和里程' : '狂野里程'}！`, 'score');
  announceRacers(s);
  startTurn(s);
}

function announceRacers(s: GameState) {
  for (const r of s.racers) addLog(s, `${nameOf(s, r.playerId)} 派出 ${RACER_BY_ID[r.racerId].nameZh}`, 'power');
}

function beginMainMove(s: GameState) {
  const r = currentRacer(s);
  if (!r) return;
  if (hasPower(s, r, 'genius') && s.prediction[turnKey(s, r)] === undefined) {
    s.pendingDecision = { playerId: r.playerId, kind:'genius-predict', prompt:'天才预测这次会掷出几点？', options:[1,2,3,4,5,6].map(n=>({value:String(n),label:`${n} 点`})), optional:false };
    return;
  }
  if (hasPower(s, r, 'mastermind') && r.firstTurn && s.prediction[`mastermind:${r.playerId}`] === undefined) {
    s.pendingDecision = { playerId:r.playerId, kind:'mastermind-predict', prompt:'幕后主脑预测谁会赢得本局？', options:s.racers.map(x=>({value:x.playerId,label:`${nameOf(s,x.playerId)} · ${RACER_BY_ID[x.racerId].nameZh}`})), optional:false };
    return;
  }
  rollForMove(s, r);
}

function rollForMove(s: GameState, r: RacerState) {
  const roll = rand(s, 6) + 1;
  s.lastRoll = roll;
  addLog(s, `${nameOf(s, r.playerId)} 掷出 ${roll}`);

  if (roll === 1) {
    for (const worm of activeRacers(s).filter(x => x.playerId !== r.playerId && hasPower(s,x,'inchworm'))) {
      power(s, worm, `${nameOf(s,worm.playerId)} 的尺蠖扭动 1 格，${nameOf(s,r.playerId)} 跳过本次移动`);
      moveRacer(s, worm, 1, 'power');
      s.skippedTurns[`roll:${r.playerId}`] = 1;
    }
    const skipper = activeRacers(s).find(x => hasPower(s,x,'skipper'));
    if (skipper) s.skippedTurns.nextPlayer = skipper.playerId as unknown as number;
  }
  if (roll === 6) {
    for (const lackey of activeRacers(s).filter(x => x.playerId !== r.playerId && hasPower(s,x,'lackey'))) {
      power(s, lackey, `${nameOf(s,lackey.playerId)} 的侍从抢先移动 2 格`);
      moveRacer(s, lackey, 2, 'power');
    }
  }
  if (s.phase !== 'race') return;

  if (hasPower(s,r,'magician') && r.rerolls < 2) {
    s.pendingDecision = { playerId:r.playerId, kind:'magician-reroll', prompt:`魔术师掷出 ${roll}，要重掷吗？`, options:[{value:'reroll',label:'重掷'},{value:'keep',label:'使用此点数'}], optional:false, roll };
    return;
  }
  const dice = activeRacers(s).find(x => hasPower(s,x,'dicemonger'));
  if (dice && r.rerolls === 0 && !hasPower(s,r,'magician')) {
    s.pendingDecision = { playerId:r.playerId, kind:'dicemonger-reroll', prompt:`掷出 ${roll}，要使用骰子商人的一次重掷吗？`, options:[{value:'reroll',label:'重掷'},{value:'keep',label:'保留'}], optional:false, roll };
    return;
  }
  if (hasPower(s,r,'rocket-scientist')) {
    s.pendingDecision = { playerId:r.playerId, kind:'rocket-double', prompt:`火箭科学家可将 ${roll} 加倍并在移动后绊倒`, options:[{value:'double',label:`冲刺 ${roll*2} 格`},{value:'normal',label:`普通移动 ${roll} 格`}], optional:false, roll };
    return;
  }
  resolveRoll(s, r, roll);
}

function resolveRoll(s: GameState, r: RacerState, roll: number, rocketDouble = false) {
  if (s.skippedTurns[`roll:${r.playerId}`]) {
    delete s.skippedTurns[`roll:${r.playerId}`];
    power(s, r, `${RACER_BY_ID[r.racerId].nameZh} 的主移动被跳过`);
    endTurn(s, r);
    return;
  }
  if (hasPower(s,r,'sisyphus') && roll === 6) {
    r.position = 0;
    playerFor(s,r).score = Math.max(0, playerFor(s,r).score - 1);
    power(s,r,`${nameOf(s,r.playerId)} 的西西弗斯回到起点并失去 1 分`);
    endTurn(s,r);
    return;
  }

  let amount = rocketDouble ? roll * 2 : roll;
  if (hasPower(s,r,'alchemist') && roll <= 2) { amount = 4; power(s,r,'炼金术士把点数转化为 4'); }
  if (hasPower(s,r,'blimp')) amount += r.position < 16 ? 3 : -1;
  if (hasPower(s,r,'hare')) amount += 2;
  if (otherHasPower(s,r,'gunk')) amount -= 1;
  for (const coach of activeRacers(s).filter(x => hasPower(s,x,'coach') && x.position === r.position)) amount += 1;
  if (hasPower(s,r,'party-animal')) amount += activeRacers(s).filter(x => x.playerId !== r.playerId && x.position === r.position).length;
  amount = Math.max(0, amount);

  const predicted = s.prediction[turnKey(s,r)];
  if (hasPower(s,r,'genius') && predicted === roll) s.skippedTurns.extraTurn = r.playerId as unknown as number;
  moveRacer(s, r, amount, 'main');
  if (rocketDouble && !r.finished && !r.eliminated) { r.tripped = true; power(s,r,'火箭冲刺后绊倒了'); }
  endTurn(s,r);
}

function startTurn(s: GameState) {
  const r = currentRacer(s);
  if (!r || s.phase !== 'race') return;
  r.lastTurnStart = r.position;
  r.rerolls = 0;
  s.lastRoll = null;
  s.pendingDecision = null;
  addLog(s, `轮到 ${nameOf(s,r.playerId)} · ${RACER_BY_ID[r.racerId].nameZh}`);

  if (r.tripped) {
    r.tripped = false;
    power(s,r,`${nameOf(s,r.playerId)} 从绊倒中恢复，跳过主移动`);
    endTurn(s,r);
    return;
  }
  if (hasPower(s,r,'hare')) {
    const lead = Math.max(...activeRacers(s).map(x=>x.position));
    if (r.position === lead && activeRacers(s).filter(x=>x.position===lead).length===1) {
      power(s,r,'野兔因独自领先而骄傲，跳过主移动');
      endTurn(s,r); return;
    }
  }
  if (hasPower(s,r,'lovable-loser')) {
    const last = Math.min(...activeRacers(s).map(x=>x.position));
    if (r.position === last && activeRacers(s).filter(x=>x.position===last).length===1) {
      playerFor(s,r).score += 1; power(s,r,`${nameOf(s,r.playerId)} 独自末位，获得 1 分`);
    }
  }
  if (hasPower(s,r,'cheerleader')) {
    const last = Math.min(...activeRacers(s).map(x=>x.position));
    const tails = activeRacers(s).filter(x=>x.position===last);
    power(s,r,'啦啦队为末位选手加油');
    for (const tail of tails) moveRacer(s,tail,2,'power');
    if (s.phase === 'race') moveRacer(s,r,1,'power');
  }
  if (hasPower(s,r,'party-animal') && s.phase === 'race') {
    power(s,r,'派对动物把所有人吸向自己');
    const target = r.position;
    for (const other of activeRacers(s).filter(x=>x.playerId!==r.playerId)) {
      const dir = Math.sign(target - other.position);
      if (dir) moveRacer(s,other,dir,'power');
    }
  }
}

function openSpecial(s: GameState, playerId: string, kind: DecisionKind) {
  const r = currentRacer(s); if (!r || r.playerId !== playerId) return;
  if (kind === 'flip-flop' && hasPower(s,r,'flip-flop')) {
    s.pendingDecision = { playerId, kind, prompt:'选择要互换位置的角色', options:activeRacers(s).filter(x=>x.playerId!==playerId).map(x=>({value:x.playerId,label:`${nameOf(s,x.playerId)} · 第 ${x.position} 格`})), optional:true };
  } else if (kind === 'hypnotist' && hasPower(s,r,'hypnotist')) {
    s.pendingDecision = { playerId, kind, prompt:'选择要催眠传送到你身边的角色', options:activeRacers(s).filter(x=>x.playerId!==playerId).map(x=>({value:x.playerId,label:nameOf(s,x.playerId)})), optional:true };
  } else if (kind === 'third-wheel' && hasPower(s,r,'third-wheel')) {
    const positions = [...new Set(activeRacers(s).map(x=>x.position))].filter(pos=>activeRacers(s).filter(x=>x.position===pos).length===2);
    s.pendingDecision = { playerId, kind, prompt:'选择恰好有两人的位置', options:positions.map(pos=>({value:String(pos),label:`第 ${pos} 格`})), optional:true };
  } else if (kind === 'rocket-double' && hasPower(s,r,'legs')) {
    power(s,r,'大长腿固定移动 5 格'); moveRacer(s,r,5,'main'); endTurn(s,r);
  }
}

function resolveDecision(s: GameState, value: string) {
  const d = s.pendingDecision!;
  const r = currentRacer(s); if (!r) return;
  s.pendingDecision = null;
  if (value === 'skip') return;
  if (d.kind === 'genius-predict') { s.prediction[turnKey(s,r)] = Number(value); power(s,r,`天才预测 ${value} 点`); rollForMove(s,r); }
  else if (d.kind === 'mastermind-predict') { s.prediction[`mastermind:${r.playerId}`] = value; power(s,r,`幕后主脑预测 ${nameOf(s,value)} 获胜`); rollForMove(s,r); }
  else if (d.kind === 'flip-flop') {
    const target = racerByPlayer(s,value); if (!target) return;
    [r.position,target.position]=[target.position,r.position]; power(s,r,`换位怪与 ${nameOf(s,value)} 交换位置`); checkStopEffects(s,r,0); endTurn(s,r);
  } else if (d.kind === 'hypnotist') {
    const target=racerByPlayer(s,value); if (!target) return;
    target.position=r.position; power(s,r,`催眠师把 ${nameOf(s,value)} 传送到身边`); checkStopEffects(s,target,0);
  } else if (d.kind === 'third-wheel') {
    r.position=Number(value); power(s,r,`第三轮传送到第 ${value} 格`); checkStopEffects(s,r,0);
  } else if (d.kind === 'magician-reroll' || d.kind === 'dicemonger-reroll') {
    if (value === 'reroll') {
      r.rerolls++;
      if (d.kind === 'dicemonger-reroll') {
        const dice=activeRacers(s).find(x=>hasPower(s,x,'dicemonger'));
        if (dice && dice.playerId!==r.playerId) { power(s,dice,'骰子商人促成重掷并移动 1 格'); moveRacer(s,dice,1,'power'); }
      } else power(s,r,'魔术师重掷骰子');
      rollForMove(s,r);
    } else resolveRoll(s,r,d.roll!);
  } else if (d.kind === 'rocket-double') resolveRoll(s,r,d.roll!,value==='double');
}

function moveRacer(s: GameState, r: RacerState, amount: number, cause: 'main'|'power'|'track', depth=0) {
  if (depth > 18 || amount === 0 || r.finished || r.eliminated || s.phase !== 'race') return;
  const start = r.position;
  let destination = start;
  const direction = Math.sign(amount);
  for (let i=0;i<Math.abs(amount);i++) {
    destination += direction;
    if (direction > 0 && hasPower(s,r,'leaptoad')) {
      while (activeRacers(s).some(x=>x.playerId!==r.playerId && x.position===destination)) destination++;
    }
  }
  destination = Math.max(0,destination);
  if (destination > TRACK_LENGTH && otherHasPower(s,r,'stickler')) {
    power(s,r,`${nameOf(s,r.playerId)} 因较真者要求精确冲线，原地不动`); return;
  }

  const sameHuge = activeRacers(s).find(x=>x.playerId!==r.playerId && hasPower(s,x,'huge-baby') && x.position===destination && destination!==0);
  if (sameHuge) { destination=Math.max(0,sameHuge.position-1); power(s,sameHuge,`${nameOf(s,r.playerId)} 被巨婴挡在后一格`); }
  r.position = destination;
  addLog(s, `${nameOf(s,r.playerId)} ${cause==='main'?'主移动':'移动'} ${Math.abs(destination-start)} 格 → ${Math.min(destination,TRACK_LENGTH)}`);

  if (cause !== 'track') {
    for (const fish of activeRacers(s).filter(x=>x.playerId!==r.playerId && hasPower(s,x,'suckerfish') && x.position===start)) {
      fish.position=destination; power(s,fish,`${nameOf(s,fish.playerId)} 的吸盘鱼跟随移动`); checkStopEffects(s,fish,depth+1);
    }
  }
  if (direction > 0) {
    for (const passed of activeRacers(s).filter(x=>x.playerId!==r.playerId && x.position>start && x.position<destination)) {
      if (hasPower(s,passed,'banana')) { r.tripped=true; power(s,passed,`${nameOf(s,r.playerId)} 超过香蕉并绊倒`); }
      if (hasPower(s,r,'centaur')) { power(s,r,`半人马踢退 ${nameOf(s,passed.playerId)} 2 格`); moveRacer(s,passed,-2,'power',depth+1); }
    }
  }
  if (destination >= TRACK_LENGTH) { finishRacer(s,r); return; }
  checkStopEffects(s,r,depth+1);
}

function checkStopEffects(s: GameState, r: RacerState, depth: number) {
  if (depth > 18 || r.finished || r.eliminated || s.phase !== 'race') return;
  if (s.track === 'wild') {
    if (WILD_ROCKS.has(r.position)) { r.tripped=true; addLog(s,`${nameOf(s,r.playerId)} 停在石头上，绊倒了`,'warning'); }
    if (WILD_STARS.has(r.position)) { playerFor(s,r).score+=1; addLog(s,`${nameOf(s,r.playerId)} 拾取星星，获得 1 分`,'score'); }
    const arrow=WILD_ARROWS[r.position]; if (arrow) { addLog(s,`箭头推动 ${nameOf(s,r.playerId)} ${arrow>0?'前进':'后退'} ${Math.abs(arrow)} 格`,'power'); moveRacer(s,r,arrow,'track',depth+1); return; }
  }
  for (const baba of activeRacers(s).filter(x=>x.playerId!==r.playerId && hasPower(s,x,'baba-yaga') && x.position===r.position)) { r.tripped=true; power(s,baba,`${nameOf(s,r.playerId)} 被芭芭雅嘎绊倒`); }
  if (hasPower(s,r,'baba-yaga')) for (const other of activeRacers(s).filter(x=>x.playerId!==r.playerId && x.position===r.position)) { other.tripped=true; power(s,r,`${nameOf(s,other.playerId)} 被芭芭雅嘎绊倒`); }
  const occupants=activeRacers(s).filter(x=>x.position===r.position);
  if (hasPower(s,r,'mouth') && occupants.length===2) {
    const victim=occupants.find(x=>x.playerId!==r.playerId)!; victim.eliminated=true; power(s,r,`${nameOf(s,victim.playerId)} 被大嘴淘汰！`); checkRaceEndBySurvivors(s); return;
  }
  if (occupants.length===2) for (const romantic of activeRacers(s).filter(x=>hasPower(s,x,'romantic'))) { power(s,romantic,'浪漫家见证两人同格，移动 2'); moveRacer(s,romantic,2,'power',depth+1); }
  for (const duelist of occupants.filter(x=>hasPower(s,x,'duelist'))) {
    const foe=occupants.find(x=>x.playerId!==duelist.playerId); if (!foe) continue;
    const a=rand(s,6)+1,b=rand(s,6)+1; const winner=a>=b?duelist:foe;
    power(s,duelist,`决斗！${nameOf(s,duelist.playerId)} ${a} : ${b} ${nameOf(s,foe.playerId)}，${nameOf(s,winner.playerId)} 前进 2`);
    moveRacer(s,winner,2,'power',depth+1);
  }
}

function finishRacer(s: GameState, r: RacerState) {
  if (r.finished) return;
  r.position=TRACK_LENGTH; r.finished=s.finishers.length+1; s.finishers.push(r.playerId);
  addLog(s,`${nameOf(s,r.playerId)} 第 ${r.finished} 名冲线！`,'score');
  if (r.finished===1) {
    const predicted=s.racers.find(x=>hasPower(s,x,'mastermind') && s.prediction[`mastermind:${x.playerId}`]===r.playerId && !x.finished && !x.eliminated);
    if (predicted) { predicted.finished=2; predicted.position=TRACK_LENGTH; s.finishers.push(predicted.playerId); power(s,predicted,`幕后主脑预测正确，获得第 2 名！`); }
  }
  if (s.finishers.length>=2) endRace(s);
}

function checkRaceEndBySurvivors(s: GameState) {
  const survivors=activeRacers(s);
  if (survivors.length===1 && !s.finishers.length) finishRacer(s,survivors[0]);
  if (survivors.length===0 || (s.finishers.length===1 && survivors.length===0)) endRace(s);
}

function endRace(s: GameState) {
  if (s.phase!=='race') return;
  const first=s.finishers[0], second=s.finishers[1];
  if (first) { playerById(s,first).score+=GOLD[s.raceNumber]; s.winnersByRace.push(first); addLog(s,`${nameOf(s,first)} 获得 ${GOLD[s.raceNumber]} 分金杯`,'score'); }
  if (second) { playerById(s,second).score+=SILVER[s.raceNumber]; addLog(s,`${nameOf(s,second)} 获得 ${SILVER[s.raceNumber]} 分银花`,'score'); }
  const ranked=s.racers.filter(r=>!r.finished).sort((a,b)=>a.position-b.position || Number(b.eliminated)-Number(a.eliminated));
  s.previousLastPlayerId=ranked[0]?.playerId ?? second ?? first ?? s.players[0].id;
  s.phase='raceResult'; s.turnPlayerId=null; s.pendingDecision=null;
}

function continueAfterRace(s: GameState) {
  s.raceNumber++;
  if (s.raceNumber>=4) { s.phase='gameOver'; addLog(s,`游戏结束！${leaders(s).map(p=>p.name).join('、')} 获胜！`,'score'); return; }
  s.phase='select'; s.selected=Object.fromEntries(s.players.map(p=>[p.id,null])); s.racers=[]; s.finishers=[];
  addLog(s,`请选择第 ${s.raceNumber+1} 局角色`,'score');
}

function endTurn(s: GameState, r: RacerState) {
  if (s.phase!=='race') return;
  for (const heckler of activeRacers(s).filter(x=>x.playerId!==r.playerId && hasPower(s,x,'heckler'))) if (Math.abs(r.position-r.lastTurnStart)<=1) { power(s,heckler,`起哄者因 ${nameOf(s,r.playerId)} 几乎没动而前进 2`); moveRacer(s,heckler,2,'power'); }
  r.firstTurn=false;
  delete s.prediction[turnKey(s,r)];
  if (s.phase!=='race') return;
  let next:string;
  const extra=s.skippedTurns.extraTurn as unknown as string | undefined;
  const forced=s.skippedTurns.nextPlayer as unknown as string | undefined;
  if (extra===r.playerId) { next=r.playerId; delete s.skippedTurns.extraTurn; addLog(s,'天才预测正确，立即再行动一次！','power'); }
  else if (forced && activeRacers(s).some(x=>x.playerId===forced)) { next=forced; delete s.skippedTurns.nextPlayer; addLog(s,`${nameOf(s,forced)} 的插队者下一个行动`,'power'); }
  else next=nextActivePlayer(s,r.playerId);
  s.turnPlayerId=next; startTurn(s);
}

function power(s:GameState,r:RacerState,text:string) {
  addLog(s,text,'power');
  for (const scooch of activeRacers(s).filter(x=>x.playerId!==r.playerId && hasPower(s,x,'scoocher'))) {
    addLog(s,`${nameOf(s,scooch.playerId)} 的蹭步者前进 1`,'power');
    moveRacer(s,scooch,1,'power',16);
  }
}

export function availableSpecials(s:GameState,playerId:string): Array<{kind:DecisionKind;label:string}> {
  if (s.phase!=='race'||s.turnPlayerId!==playerId||s.pendingDecision) return [];
  const r=currentRacer(s); if(!r) return [];
  const out:Array<{kind:DecisionKind;label:string}>=[];
  if(hasPower(s,r,'flip-flop')) out.push({kind:'flip-flop',label:'换位（代替主移动）'});
  if(hasPower(s,r,'hypnotist')) out.push({kind:'hypnotist',label:'催眠传送'});
  if(hasPower(s,r,'third-wheel')) out.push({kind:'third-wheel',label:'传送到双人格'});
  if(hasPower(s,r,'legs')) out.push({kind:'rocket-double',label:'固定移动 5 格'});
  return out;
}

export function getRacerPowerId(s:GameState,r:RacerState):string {
  if(r.powerOverride) return r.powerOverride;
  if(r.racerId==='copycat') {
    const lead=activeRacers(s).filter(x=>x.playerId!==r.playerId).sort((a,b)=>b.position-a.position)[0];
    return lead?.racerId==='copycat' ? 'copycat' : (lead?.powerOverride ?? lead?.racerId ?? 'copycat');
  }
  return r.racerId;
}

function hasPower(s:GameState,r:RacerState,id:string){return r.racerId===id||getRacerPowerId(s,r)===id;}
function otherHasPower(s:GameState,r:RacerState,id:string){return activeRacers(s).some(x=>x.playerId!==r.playerId&&hasPower(s,x,id));}
function activeRacers(s:GameState){return s.racers.filter(r=>!r.finished&&!r.eliminated);}
function currentRacer(s:GameState){return s.racers.find(r=>r.playerId===s.turnPlayerId&&!r.finished&&!r.eliminated);}
function racerByPlayer(s:GameState,id:string){return s.racers.find(r=>r.playerId===id);}
function playerFor(s:GameState,r:RacerState){return playerById(s,r.playerId);}
function playerById(s:GameState,id:string){return s.players.find(p=>p.id===id)!;}
function nameOf(s:GameState,id:string){return playerById(s,id)?.name??'未知选手';}
function turnKey(s:GameState,r:RacerState){return `genius:${s.raceNumber}:${r.playerId}`;}
function nextActivePlayer(s:GameState,from:string){const idx=s.turnOrder.indexOf(from); for(let i=1;i<=s.turnOrder.length;i++){const id=s.turnOrder[(idx+i)%s.turnOrder.length];if(activeRacers(s).some(r=>r.playerId===id))return id;}return from;}
function leaders(s:GameState){const top=Math.max(...s.players.map(p=>p.score));return s.players.filter(p=>p.score===top);}
function rotate<T>(a:T[],n:number){return [...a.slice(n),...a.slice(0,n)];}
function rand(s:GameState,max:number){s.rngSeed=(Math.imul(s.rngSeed,1664525)+1013904223)>>>0;return s.rngSeed%max;}
function shuffle<T>(s:GameState,a:T[]){const out=[...a];for(let i=out.length-1;i>0;i--){const j=rand(s,i+1);[out[i],out[j]]=[out[j],out[i]];}return out;}
function addLog(s:GameState,text:string,tone:'normal'|'power'|'score'|'warning'='normal'){s.logs.push({id:s.nextLogId++,text,tone});if(s.logs.length>80)s.logs.shift();}
function clone<T>(v:T):T{return structuredClone(v);}

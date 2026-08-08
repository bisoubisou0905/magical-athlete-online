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
    draftPool: [], draftOrder: [], draftIndex: 0, draftDeck: [], draftRound: 0,
    raceNumber: 0, track: 'mild', selected: {}, racers: [],
    turnPlayerId: null, turnOrder: [], finishers: [], previousLastPlayerId: null,
    winnersByRace: [], logs: [], pendingDecision: null, lastRoll: null, lastRollPlayerId: null, rollSeq: 0,
    nextLogId: 1, rngSeed: seed || 1, demoMode: false, prediction: {}, skippedTurns: {}, turnFlags: {}, eliminationOrder: []
  };
}

export function createPlayer(id: string, name: string, index: number, isBot = false): PlayerState {
  return { id, name: name.trim().slice(0, 16) || `选手 ${index + 1}`, color: PLAYER_COLORS[index], hand: [], used: [], score: 0, connected: true, isBot };
}

export function addPlayer(state: GameState, id: string, name: string, isBot = false): GameState {
  const s = clone(state);
  if (s.phase !== 'lobby' || s.players.length >= 4 || s.players.some(p => p.id === id)) return s;
  s.players.push(createPlayer(id, name, s.players.length, isBot));
  addLog(s, `${name} 加入了房间`, 'normal', `${name} joined the room`);
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
  addLog(s, `${bot.name} 离开了房间`, 'normal', `${bot.name} left the room`);
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
    const picked = RACER_BY_ID[action.racerId];
    addLog(s, `${player.name} 招募了 ${picked.nameZh}`, 'power', `${player.name} drafted ${picked.name}`);
    s.draftIndex++;
    const roundLength = s.players.length * 2;
    if (s.draftIndex === roundLength && s.draftDeck.length) {
      s.draftRound = 1;
      s.draftPool = s.draftDeck.splice(0, roundLength);
      addLog(s, '第二轮选秀开始，翻开一组新角色。', 'score', 'Draft round two begins with a fresh group of racers.');
    } else if (s.draftIndex >= s.draftOrder.length) beginSelection(s);
    return s;
  }
  if (action.type === 'SELECT_RACER') {
    if (s.phase !== 'select' || s.selected[playerId] || !player.hand.includes(action.racerId) || player.used.includes(action.racerId)) return state;
    s.selected[playerId] = action.racerId;
    addLog(s, `${player.name} 已锁定本局角色`, 'normal', `${player.name} locked in a racer`);
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
  const startPlayer = rollOff(s, s.players.map(p => p.id), '决定首轮选秀顺位', 'for the first draft pick');
  const start = s.players.findIndex(p => p.id === startPlayer);
  const clockwise = rotate(s.players.map(p => p.id), start);
  const secondStart = rotate(s.players.map(p => p.id), (start + 1) % count);
  const faceUp = count * 2;
  s.draftPool = ids.slice(0, faceUp);
  s.draftDeck = ids.slice(faceUp, faceUp * 2);
  s.draftOrder = [...clockwise, ...clockwise.slice().reverse(), ...secondStart, ...secondStart.slice().reverse()];
  s.draftIndex = 0;
  s.draftRound = 0;
  s.phase = 'draft';
  addLog(s, `选秀开始，${nameOf(s, clockwise[0])} 首选`, 'score', `The draft begins. ${nameOf(s, clockwise[0])} picks first.`);
}

function beginSelection(s: GameState) {
  s.phase = 'select';
  s.selected = Object.fromEntries(s.players.map(p => [p.id, null]));
  addLog(s, '选秀完成！所有选手秘密选择第一局角色。', 'score', 'The draft is complete. Secretly choose a racer for Race 1.');
}

function beginRace(s: GameState) {
  s.phase = 'race';
  s.track = (s.raceNumber % 2 === 0 ? 'mild' : 'wild') as TrackKind;
  s.racers = s.players.map(p => ({
    playerId: p.id, racerId: s.selected[p.id]!, position: 0, tripped: false, finished: null,
    eliminated: false, lastTurnStart: 0, firstTurn: true, rerolls: 0, dicemongerUsed: false
  }));
  s.finishers = [];
  s.pendingDecision = null;
  s.lastRoll = null;
  s.lastRollPlayerId = null;
  s.prediction = {};
  s.skippedTurns = {};
  s.turnFlags = {};
  s.eliminationOrder = [];

  const setupQueue:Array<{playerId:string;kind:'egg-copy'|'twin-copy';options:string[]}> = [];
  for (const r of s.racers) {
    const p = playerFor(s, r);
    p.used.push(r.racerId);
    if (r.racerId === 'sisyphus') { p.score += 4; power(s, r, `${p.name} 的西西弗斯赛前获得 4 分`, `${p.name}'s Sisyphus gains 4 points before the race`); }
    if (r.racerId === 'egg') {
      const used = new Set(s.racers.map(x => x.racerId));
      const candidates = shuffle(s, RACERS.map(x => x.id).filter(id => !used.has(id) && id !== 'egg')).slice(0, 3);
      setupQueue.push({playerId:r.playerId,kind:'egg-copy',options:candidates});
    }
    if (r.racerId === 'twin' && s.winnersByRace.length) {
      const previousWinners=[...new Set(s.winnersByRace.map((winnerId,raceIndex)=>s.players.find(x=>x.id===winnerId)?.used[raceIndex]).filter((id):id is string=>Boolean(id)))];
      if(previousWinners.length) setupQueue.push({playerId:r.playerId,kind:'twin-copy',options:previousWinners});
    }
  }

  const first = s.previousLastPlayerId && s.players.some(p => p.id === s.previousLastPlayerId)
    ? s.previousLastPlayerId : rollOff(s, s.players.map(p => p.id), '决定第一局起始玩家', 'for the first turn');
  const base = s.players.map(p => p.id);
  s.turnOrder = rotate(base, base.indexOf(first));
  s.turnPlayerId = s.turnOrder[0];
  addLog(s, `第 ${s.raceNumber + 1} 局开始：${s.track === 'mild' ? '温和里程' : '狂野里程'}！`, 'score', `Race ${s.raceNumber + 1} begins on the ${s.track === 'mild' ? 'Mild' : 'Wild'} Mile!`);
  announceRacers(s);
  s.prediction.setupQueue=JSON.stringify(setupQueue);
  continueRaceSetup(s);
}

function continueRaceSetup(s:GameState){
  const queue=JSON.parse(String(s.prediction.setupQueue??'[]')) as Array<{playerId:string;kind:'egg-copy'|'twin-copy';options:string[]}>;
  const next=queue.shift();
  s.prediction.setupQueue=JSON.stringify(queue);
  if(!next){delete s.prediction.setupQueue;s.turnPlayerId=s.turnOrder[0];startTurn(s);return;}
  const racer=racerByPlayer(s,next.playerId)!;
  s.turnPlayerId=next.playerId;
  s.pendingDecision={
    playerId:next.playerId,kind:next.kind,
    prompt:next.kind==='egg-copy'?'蛋展示了 3 名角色，请选择本局获得的能力。':'双生子要复制哪一名此前冠军的能力？',
    promptEn:next.kind==='egg-copy'?'Egg drew 3 racers. Choose a power for this race.':'Which previous winner should Twin copy?',
    options:next.options.map(id=>({value:id,label:`${RACER_BY_ID[id].nameZh} · ${RACER_BY_ID[id].powerZh}`,labelEn:`${RACER_BY_ID[id].name} · ${RACER_BY_ID[id].power}`})),optional:false
  };
  addLog(s,`${nameOf(s,next.playerId)} 正在为 ${RACER_BY_ID[racer.racerId].nameZh} 选择能力`,'power',`${nameOf(s,next.playerId)} is choosing a power for ${RACER_BY_ID[racer.racerId].name}`);
}

function announceRacers(s: GameState) {
  for (const r of s.racers) addLog(s, `${nameOf(s, r.playerId)} 派出 ${RACER_BY_ID[r.racerId].nameZh}`, 'power', `${nameOf(s, r.playerId)} reveals ${RACER_BY_ID[r.racerId].name}`);
}

function beginMainMove(s: GameState) {
  const r = currentRacer(s);
  if (!r) return;
  if (hasPower(s, r, 'genius') && s.prediction[turnKey(s, r)] === undefined) {
    s.pendingDecision = {
      playerId: r.playerId, kind:'genius-predict', prompt:'天才预测这次会掷出几点？', promptEn:'What will Genius roll for this main move?',
      options:[1,2,3,4,5,6].map(n=>({value:String(n),label:`${n} 点`,labelEn:String(n)})), optional:false
    };
    return;
  }
  if (hasPower(s, r, 'mastermind') && r.firstTurn && s.prediction[`mastermind:${r.playerId}`] === undefined) {
    s.pendingDecision = {
      playerId:r.playerId, kind:'mastermind-predict', prompt:'幕后主脑预测谁会赢得本局？', promptEn:'Who will win this race?',
      options:s.racers.map(x=>({value:x.playerId,label:`${nameOf(s,x.playerId)} · ${RACER_BY_ID[x.racerId].nameZh}`,labelEn:`${nameOf(s,x.playerId)} · ${RACER_BY_ID[x.racerId].name}`})), optional:false
    };
    return;
  }
  rollForMove(s, r);
}

function rollForMove(s: GameState, r: RacerState) {
  const roll = rand(s, 6) + 1;
  s.lastRoll = roll;
  s.lastRollPlayerId = r.playerId;
  s.rollSeq++;
  addLog(s, `${nameOf(s, r.playerId)} 掷出 ${roll}`, 'normal', `${nameOf(s, r.playerId)} rolled ${roll}`);

  if (hasPower(s,r,'magician') && r.rerolls < 2) {
    s.pendingDecision = {
      playerId:r.playerId, kind:'magician-reroll', prompt:`魔术师掷出 ${roll}，要重掷吗？`, promptEn:`Magician rolled ${roll}. Reroll?`,
      options:[{value:'reroll',label:'重掷',labelEn:'Reroll'},{value:'keep',label:'使用此点数',labelEn:'Keep this roll'}], optional:false, roll
    };
    return;
  }
  offerDicemongerOrResolve(s, r, roll);
}

function offerDicemongerOrResolve(s: GameState, r: RacerState, roll: number) {
  const dice = activeRacers(s).find(x => hasPower(s,x,'dicemonger'));
  if (dice && !r.dicemongerUsed) {
    s.pendingDecision = {
      playerId:r.playerId, kind:'dicemonger-reroll', prompt:`掷出 ${roll}，要使用骰子商人的一次重掷吗？`, promptEn:`You rolled ${roll}. Use Dicemonger's reroll?`,
      options:[{value:'reroll',label:'重掷',labelEn:'Reroll'},{value:'keep',label:'保留',labelEn:'Keep'}], optional:false, roll
    };
    return;
  }
  finalizeKeptRoll(s, r, roll);
}

function finalizeKeptRoll(s: GameState, r: RacerState, roll: number) {
  // A discarded roll never happened: roll-triggered powers resolve only after all rerolls finish.
  if (roll === 1) {
    for (const worm of activeRacers(s).filter(x => x.playerId !== r.playerId && hasPower(s,x,'inchworm'))) {
      power(s, worm, `${nameOf(s,worm.playerId)} 的尺蠖扭动 1 格，${nameOf(s,r.playerId)} 跳过本次移动`, `${nameOf(s,worm.playerId)}'s Inchworm moves 1; ${nameOf(s,r.playerId)} skips the move`);
      moveRacer(s, worm, 1, 'power');
      s.skippedTurns[`roll:${r.playerId}`] = 1;
    }
    const skipper = activeRacers(s).find(x => hasPower(s,x,'skipper'));
    if (skipper) s.skippedTurns.nextPlayer = skipper.playerId as unknown as number;
  }
  if (roll === 6) {
    for (const lackey of activeRacers(s).filter(x => x.playerId !== r.playerId && hasPower(s,x,'lackey'))) {
      power(s, lackey, `${nameOf(s,lackey.playerId)} 的侍从抢先移动 2 格`, `${nameOf(s,lackey.playerId)}'s Lackey moves 2 before the roller`);
      moveRacer(s, lackey, 2, 'power');
    }
  }
  if (s.phase !== 'race') return;
  if (s.skippedTurns[`roll:${r.playerId}`]) {
    resolveRoll(s, r, roll);
    return;
  }
  if (hasPower(s,r,'alchemist') && roll <= 2) {
    s.pendingDecision = {
      playerId:r.playerId, kind:'alchemist-four', prompt:`炼金术士可将 ${roll} 改为移动 4 格`, promptEn:`Alchemist can turn ${roll} into a move of 4.`,
      options:[{value:'four',label:'移动 4 格',labelEn:'Move 4'},{value:'normal',label:`保留 ${roll} 格`,labelEn:`Keep ${roll}`}], optional:false, roll
    };
    return;
  }
  if (hasPower(s,r,'rocket-scientist')) {
    s.pendingDecision = {
      playerId:r.playerId, kind:'rocket-double', prompt:`火箭科学家可将 ${roll} 加倍并在移动后绊倒`, promptEn:`Rocket Scientist can double ${roll}, then trip.`,
      options:[{value:'double',label:`冲刺 ${roll*2} 格`,labelEn:`Rocket ${roll*2}`},{value:'normal',label:`普通移动 ${roll} 格`,labelEn:`Move ${roll}`}], optional:false, roll
    };
    return;
  }
  resolveRoll(s, r, roll);
}

function resolveRoll(s: GameState, r: RacerState, roll: number, rocketDouble = false, amountOverride?: number) {
  if (s.skippedTurns[`roll:${r.playerId}`]) {
    delete s.skippedTurns[`roll:${r.playerId}`];
    power(s, r, `${RACER_BY_ID[r.racerId].nameZh} 的主移动被跳过`, `${RACER_BY_ID[r.racerId].name}'s main move is skipped`);
    endTurn(s, r);
    return;
  }
  if (hasPower(s,r,'sisyphus') && roll === 6) {
    r.position = 0;
    playerFor(s,r).score = Math.max(0, playerFor(s,r).score - 1);
    power(s,r,`${nameOf(s,r.playerId)} 的西西弗斯回到起点并失去 1 分，然后继续主移动`, `${nameOf(s,r.playerId)}'s Sisyphus warps to Start, loses 1 point, then continues the main move`);
    checkStopEffects(s, r, 0);
    if (s.phase !== 'race' || r.finished || r.eliminated) return;
  }

  let amount = amountOverride ?? (rocketDouble ? roll * 2 : roll);
  if (hasPower(s,r,'blimp')) amount += r.lastTurnStart < 16 ? 3 : -1;
  if (hasPower(s,r,'hare')) amount += 2;
  if (otherHasPower(s,r,'gunk')) amount -= 1;
  for (const coach of activeRacers(s).filter(x => hasPower(s,x,'coach') && x.position === r.position)) amount += 1;
  if (hasPower(s,r,'party-animal')) amount += activeRacers(s).filter(x => x.playerId !== r.playerId && x.position === r.position).length;
  amount = Math.max(0, amount);

  const predicted = s.prediction[turnKey(s,r)];
  if (hasPower(s,r,'genius') && predicted === roll) s.skippedTurns.extraTurn = r.playerId as unknown as number;
  moveRacer(s, r, amount, 'main');
  if (rocketDouble && !r.finished && !r.eliminated) { r.tripped = true; power(s,r,'火箭冲刺后绊倒了','The rocket sprint ends in a trip'); }
  endTurn(s,r);
}

function startTurn(s: GameState) {
  const r = currentRacer(s);
  if (!r || s.phase !== 'race') return;
  r.lastTurnStart = r.position;
  r.rerolls = 0;
  r.dicemongerUsed = false;
  s.turnFlags = {};
  s.pendingDecision = null;
  addLog(s, `轮到 ${nameOf(s,r.playerId)} · ${RACER_BY_ID[r.racerId].nameZh}`, 'normal', `${nameOf(s,r.playerId)} · ${RACER_BY_ID[r.racerId].name}'s turn`);

  if (r.tripped) {
    r.tripped = false;
    power(s,r,`${nameOf(s,r.playerId)} 从绊倒中恢复，跳过主移动`, `${nameOf(s,r.playerId)} recovers from a trip and skips the main move`);
    endTurn(s,r);
    return;
  }
  if (hasPower(s,r,'hare')) {
    const lead = Math.max(...activeRacers(s).map(x=>x.position));
    if (r.position === lead && activeRacers(s).filter(x=>x.position===lead).length===1) {
      power(s,r,'野兔因独自领先而骄傲，跳过主移动','Hare is alone in the lead and skips the main move');
      endTurn(s,r); return;
    }
  }
  if (hasPower(s,r,'lovable-loser')) {
    const last = Math.min(...activeRacers(s).map(x=>x.position));
    if (r.position === last && activeRacers(s).filter(x=>x.position===last).length===1) {
      playerFor(s,r).score += 1; power(s,r,`${nameOf(s,r.playerId)} 独自末位，获得 1 分`, `${nameOf(s,r.playerId)} is alone in last and gains 1 point`);
    }
  }
  if (hasPower(s,r,'party-animal') && s.phase === 'race') {
    power(s,r,'派对动物把所有人吸向自己','Party Animal pulls every racer 1 space toward itself');
    const target = r.position;
    for (const other of activeRacers(s).filter(x=>x.playerId!==r.playerId)) {
      const dir = Math.sign(target - other.position);
      if (dir) moveRacer(s,other,dir,'power');
    }
  }
}

function openSpecial(s: GameState, playerId: string, kind: DecisionKind) {
  const r = currentRacer(s); if (!r || r.playerId !== playerId) return;
  if (s.turnFlags[kind]) return;
  s.turnFlags[kind] = true;
  if (kind === 'flip-flop' && hasPower(s,r,'flip-flop')) {
    s.pendingDecision = { playerId, kind, prompt:'选择要互换位置的角色', promptEn:'Choose a racer to swap spaces with.', options:activeRacers(s).filter(x=>x.playerId!==playerId).map(x=>({value:x.playerId,label:`${nameOf(s,x.playerId)} · 第 ${x.position} 格`,labelEn:`${nameOf(s,x.playerId)} · Space ${x.position}`})), optional:true };
  } else if (kind === 'hypnotist' && hasPower(s,r,'hypnotist')) {
    s.pendingDecision = { playerId, kind, prompt:'选择要催眠传送到你身边的角色', promptEn:'Choose a racer to warp to your space.', options:activeRacers(s).filter(x=>x.playerId!==playerId).map(x=>({value:x.playerId,label:nameOf(s,x.playerId),labelEn:nameOf(s,x.playerId)})), optional:true };
  } else if (kind === 'third-wheel' && hasPower(s,r,'third-wheel')) {
    const positions = [...new Set(activeRacers(s).map(x=>x.position))].filter(pos=>activeRacers(s).filter(x=>x.position===pos).length===2);
    s.pendingDecision = { playerId, kind, prompt:'选择恰好有两人的位置', promptEn:'Choose a space with exactly 2 racers.', options:positions.map(pos=>({value:String(pos),label:`第 ${pos} 格`,labelEn:`Space ${pos}`})), optional:true };
  } else if (kind === 'cheerleader' && hasPower(s,r,'cheerleader')) {
    const last = Math.min(...activeRacers(s).map(x=>x.position));
    const tails = activeRacers(s).filter(x=>x.position===last);
    power(s,r,'啦啦队为所有末位角色加油','Cheerleader cheers for every racer tied for last');
    for (const tail of tails) moveRacer(s,tail,2,'power');
    if (s.phase === 'race' && !r.finished && !r.eliminated) moveRacer(s,r,1,'power');
  } else if (kind === 'rocket-double' && hasPower(s,r,'legs')) {
    power(s,r,'大长腿固定移动 5 格','Legs skips the roll and moves 5'); moveRacer(s,r,5,'main'); endTurn(s,r);
  } else {
    delete s.turnFlags[kind];
  }
}

function resolveDecision(s: GameState, value: string) {
  const d = s.pendingDecision!;
  const r = currentRacer(s); if (!r) return;
  s.pendingDecision = null;
  if (value === 'skip') return;
  if (d.kind === 'genius-predict') { s.prediction[turnKey(s,r)] = Number(value); power(s,r,`天才预测 ${value} 点`,`Genius predicts ${value}`); rollForMove(s,r); }
  else if (d.kind === 'mastermind-predict') { s.prediction[`mastermind:${r.playerId}`] = value; power(s,r,`幕后主脑预测 ${nameOf(s,value)} 获胜`,`Mastermind predicts ${nameOf(s,value)} will win`); rollForMove(s,r); }
  else if (d.kind === 'flip-flop') {
    const target = racerByPlayer(s,value); if (!target) return;
    [r.position,target.position]=[target.position,r.position]; power(s,r,`换位怪与 ${nameOf(s,value)} 交换位置`,`Flip Flop swaps spaces with ${nameOf(s,value)}`); checkStopEffects(s,r,0); endTurn(s,r);
  } else if (d.kind === 'hypnotist') {
    const target=racerByPlayer(s,value); if (!target) return;
    target.position=r.position; power(s,r,`催眠师把 ${nameOf(s,value)} 传送到身边`,`Hypnotist warps ${nameOf(s,value)} to its space`); checkStopEffects(s,target,0);
  } else if (d.kind === 'third-wheel') {
    r.position=Number(value); power(s,r,`第三轮传送到第 ${value} 格`,`Third Wheel warps to space ${value}`); checkStopEffects(s,r,0);
  } else if (d.kind === 'magician-reroll') {
    if (value === 'reroll') {
      r.rerolls++;
      power(s,r,'魔术师重掷骰子','Magician rerolls the die');
      rollForMove(s,r);
    } else offerDicemongerOrResolve(s,r,d.roll!);
  } else if (d.kind === 'dicemonger-reroll') {
    r.dicemongerUsed = true;
    if (value === 'reroll') {
      const dice=activeRacers(s).find(x=>hasPower(s,x,'dicemonger'));
      if (dice && dice.playerId!==r.playerId) { power(s,dice,'骰子商人促成重掷并移动 1 格','Dicemonger causes a reroll and moves 1'); moveRacer(s,dice,1,'power'); }
      if (s.phase === 'race') rollForMove(s,r);
    } else finalizeKeptRoll(s,r,d.roll!);
  } else if (d.kind === 'alchemist-four') {
    if (value === 'four') power(s,r,'炼金术士把主移动转化为 4 格','Alchemist turns the main move into 4');
    resolveRoll(s,r,d.roll!,false,value === 'four' ? 4 : undefined);
  } else if (d.kind === 'egg-copy' || d.kind === 'twin-copy') {
    if(!RACER_BY_ID[value])return;
    r.powerOverride=value;
    const owner=nameOf(s,r.playerId),source=RACER_BY_ID[value];
    power(s,r,`${owner} 的${d.kind==='egg-copy'?'蛋':'双生子'}获得了${source.nameZh}的能力`,`${owner}'s ${d.kind==='egg-copy'?'Egg':'Twin'} copied ${source.name}`);
    if(value==='sisyphus'){playerFor(s,r).score+=4;power(s,r,'复制的西西弗斯能力在赛前获得 4 分','The copied Sisyphus power gains 4 points before the race');}
    continueRaceSetup(s);
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
    power(s,r,`${nameOf(s,r.playerId)} 因较真者要求精确冲线，原地不动`,`${nameOf(s,r.playerId)} cannot cross because Stickler requires an exact move`); return;
  }

  const sameHuge = activeRacers(s).find(x=>x.playerId!==r.playerId && hasPower(s,x,'huge-baby') && x.position===destination && destination!==0);
  if (sameHuge) { destination=Math.max(0,sameHuge.position-1); power(s,sameHuge,`${nameOf(s,r.playerId)} 被巨婴挡在后一格`,`${nameOf(s,r.playerId)} is stopped one space behind Huge Baby`); }
  r.position = destination;
  addLog(s, `${nameOf(s,r.playerId)} ${cause==='main'?'主移动':'移动'} ${Math.abs(destination-start)} 格 → ${Math.min(destination,TRACK_LENGTH)}`, 'normal', `${nameOf(s,r.playerId)} ${cause==='main'?'main ':''}moves ${Math.abs(destination-start)} → Space ${Math.min(destination,TRACK_LENGTH)}`);

  if (cause !== 'track') {
    for (const fish of activeRacers(s).filter(x=>x.playerId!==r.playerId && hasPower(s,x,'suckerfish') && x.position===start)) {
      fish.position=destination; power(s,fish,`${nameOf(s,fish.playerId)} 的吸盘鱼跟随移动`,`${nameOf(s,fish.playerId)}'s Suckerfish follows the move`); checkStopEffects(s,fish,depth+1);
    }
  }
  if (direction > 0) {
    for (const passed of activeRacers(s).filter(x=>x.playerId!==r.playerId && x.position>start && x.position<destination)) {
      if (hasPower(s,passed,'banana')) { r.tripped=true; power(s,passed,`${nameOf(s,r.playerId)} 超过香蕉并绊倒`,`${nameOf(s,r.playerId)} passes Banana and trips`); }
      if (hasPower(s,r,'centaur')) { power(s,r,`半人马踢退 ${nameOf(s,passed.playerId)} 2 格`,`Centaur kicks ${nameOf(s,passed.playerId)} back 2`); moveRacer(s,passed,-2,'power',depth+1); }
    }
  }
  if (destination >= TRACK_LENGTH) { finishRacer(s,r); return; }
  checkStopEffects(s,r,depth+1);
}

function checkStopEffects(s: GameState, r: RacerState, depth: number) {
  if (depth > 18 || r.finished || r.eliminated || s.phase !== 'race') return;
  if (s.track === 'wild') {
    if (WILD_ROCKS.has(r.position)) { r.tripped=true; addLog(s,`${nameOf(s,r.playerId)} 停在石头上，绊倒了`,'warning',`${nameOf(s,r.playerId)} stops on a rock and trips`); }
    if (WILD_STARS.has(r.position)) { playerFor(s,r).score+=1; addLog(s,`${nameOf(s,r.playerId)} 拾取星星，获得 1 分`,'score',`${nameOf(s,r.playerId)} collects a star and gains 1 point`); }
    const arrow=WILD_ARROWS[r.position]; if (arrow) { addLog(s,`箭头推动 ${nameOf(s,r.playerId)} ${arrow>0?'前进':'后退'} ${Math.abs(arrow)} 格`,'power',`An arrow moves ${nameOf(s,r.playerId)} ${arrow>0?'forward':'back'} ${Math.abs(arrow)}`); moveRacer(s,r,arrow,'track',depth+1); return; }
  }
  for (const baba of activeRacers(s).filter(x=>x.playerId!==r.playerId && hasPower(s,x,'baba-yaga') && x.position===r.position)) { r.tripped=true; power(s,baba,`${nameOf(s,r.playerId)} 被芭芭雅嘎绊倒`,`${nameOf(s,r.playerId)} is tripped by Baba Yaga`); }
  if (hasPower(s,r,'baba-yaga')) for (const other of activeRacers(s).filter(x=>x.playerId!==r.playerId && x.position===r.position)) { other.tripped=true; power(s,r,`${nameOf(s,other.playerId)} 被芭芭雅嘎绊倒`,`${nameOf(s,other.playerId)} is tripped by Baba Yaga`); }
  const occupants=activeRacers(s).filter(x=>x.position===r.position);
  if (hasPower(s,r,'mouth') && occupants.length===2) {
    const victim=occupants.find(x=>x.playerId!==r.playerId)!; victim.eliminated=true; s.eliminationOrder.push(victim.playerId); power(s,r,`${nameOf(s,victim.playerId)} 被大嘴淘汰！`,`${nameOf(s,victim.playerId)} is eliminated by M.O.U.T.H.!`); checkRaceEndBySurvivors(s); return;
  }
  if (occupants.length===2) for (const romantic of activeRacers(s).filter(x=>hasPower(s,x,'romantic'))) { power(s,romantic,'浪漫家见证两人同格，移动 2','Romantic sees a pair sharing a space and moves 2'); moveRacer(s,romantic,2,'power',depth+1); }
  for (const duelist of occupants.filter(x=>hasPower(s,x,'duelist'))) {
    const foe=occupants.find(x=>x.playerId!==duelist.playerId); if (!foe) continue;
    const a=rand(s,6)+1,b=rand(s,6)+1; const winner=a>=b?duelist:foe;
    power(s,duelist,`决斗！${nameOf(s,duelist.playerId)} ${a} : ${b} ${nameOf(s,foe.playerId)}，${nameOf(s,winner.playerId)} 前进 2`,`Duel! ${nameOf(s,duelist.playerId)} ${a} : ${b} ${nameOf(s,foe.playerId)}. ${nameOf(s,winner.playerId)} moves 2`);
    moveRacer(s,winner,2,'power',depth+1);
  }
}

function finishRacer(s: GameState, r: RacerState) {
  if (r.finished) return;
  r.position=TRACK_LENGTH; r.finished=s.finishers.length+1; s.finishers.push(r.playerId);
  addLog(s,`${nameOf(s,r.playerId)} 第 ${r.finished} 名冲线！`,'score',`${nameOf(s,r.playerId)} finishes in place ${r.finished}!`);
  if (r.finished===1) {
    const predicted=s.racers.find(x=>hasPower(s,x,'mastermind') && s.prediction[`mastermind:${x.playerId}`]===r.playerId && !x.eliminated && (!x.finished || x===r));
    if (predicted) {
      if (predicted !== r) { predicted.finished=2; predicted.position=TRACK_LENGTH; }
      s.finishers.push(predicted.playerId);
      power(s,predicted,`幕后主脑预测正确，获得第 2 名！`,`Mastermind predicted correctly and takes 2nd place!`);
    }
  }
  if (s.finishers.length>=2 || activeRacers(s).length===0) endRace(s);
}

function checkRaceEndBySurvivors(s: GameState) {
  const survivors=activeRacers(s);
  // The last racer still has to reach the finish. If nobody remains after a placement,
  // the race ends without awarding any unavailable lower placement.
  if (survivors.length===0) endRace(s);
}

function endRace(s: GameState) {
  if (s.phase!=='race') return;
  const first=s.finishers[0], second=s.finishers[1];
  if (first) { playerById(s,first).score+=GOLD[s.raceNumber]; s.winnersByRace.push(first); addLog(s,`${nameOf(s,first)} 获得 ${GOLD[s.raceNumber]} 分金杯`,'score',`${nameOf(s,first)} gains the ${GOLD[s.raceNumber]}-point gold prize`); }
  if (second) { playerById(s,second).score+=SILVER[s.raceNumber]; addLog(s,`${nameOf(s,second)} 获得 ${SILVER[s.raceNumber]} 分银花`,'score',`${nameOf(s,second)} gains the ${SILVER[s.raceNumber]}-point silver prize`); }
  const ranked=s.racers.filter(r=>!r.finished).sort((a,b)=>a.position-b.position || Number(b.eliminated)-Number(a.eliminated));
  s.previousLastPlayerId=s.eliminationOrder[0] ?? ranked[0]?.playerId ?? second ?? first ?? s.players[0].id;
  s.phase='raceResult'; s.turnPlayerId=null; s.pendingDecision=null;
}

function continueAfterRace(s: GameState) {
  s.raceNumber++;
  if (s.raceNumber>=4) { s.phase='gameOver'; addLog(s,`游戏结束！${leaders(s).map(p=>p.name).join('、')} 获胜！`,'score',`Game over! ${leaders(s).map(p=>p.name).join(' & ')} wins!`); return; }
  s.phase='select'; s.selected=Object.fromEntries(s.players.map(p=>[p.id,null])); s.racers=[]; s.finishers=[];
  addLog(s,`请选择第 ${s.raceNumber+1} 局角色`,'score',`Choose a racer for Race ${s.raceNumber+1}`);
}

function endTurn(s: GameState, r: RacerState) {
  if (s.phase!=='race') return;
  for (const heckler of activeRacers(s).filter(x=>x.playerId!==r.playerId && hasPower(s,x,'heckler'))) if (Math.abs(r.position-r.lastTurnStart)<=1) { power(s,heckler,`起哄者因 ${nameOf(s,r.playerId)} 几乎没动而前进 2`,`Heckler moves 2 because ${nameOf(s,r.playerId)} ended within 1 space of the start position`); moveRacer(s,heckler,2,'power'); }
  r.firstTurn=false;
  delete s.prediction[turnKey(s,r)];
  if (s.phase!=='race') return;
  let next:string;
  const extra=s.skippedTurns.extraTurn as unknown as string | undefined;
  const forced=s.skippedTurns.nextPlayer as unknown as string | undefined;
  if (extra===r.playerId) { next=r.playerId; delete s.skippedTurns.extraTurn; addLog(s,'天才预测正确，立即再行动一次！','power','Genius predicted correctly and takes another turn!'); }
  else if (forced && activeRacers(s).some(x=>x.playerId===forced)) { next=forced; delete s.skippedTurns.nextPlayer; addLog(s,`${nameOf(s,forced)} 的插队者下一个行动`,'power',`${nameOf(s,forced)}'s Skipper goes next`); }
  else next=nextActivePlayer(s,r.playerId);
  s.turnPlayerId=next; startTurn(s);
}

function power(s:GameState,r:RacerState,text:string,textEn=text) {
  addLog(s,text,'power',textEn);
  for (const scooch of activeRacers(s).filter(x=>x.playerId!==r.playerId && hasPower(s,x,'scoocher'))) {
    addLog(s,`${nameOf(s,scooch.playerId)} 的蹭步者前进 1`,'power',`${nameOf(s,scooch.playerId)}'s Scoocher moves 1`);
    moveRacer(s,scooch,1,'power',16);
  }
}

export function availableSpecials(s:GameState,playerId:string): Array<{kind:DecisionKind;label:string;labelEn:string}> {
  if (s.phase!=='race'||s.turnPlayerId!==playerId||s.pendingDecision) return [];
  const r=currentRacer(s); if(!r) return [];
  const out:Array<{kind:DecisionKind;label:string;labelEn:string}>=[];
  if(hasPower(s,r,'flip-flop')&&!s.turnFlags['flip-flop']) out.push({kind:'flip-flop',label:'换位（代替主移动）',labelEn:'Swap instead of moving'});
  if(hasPower(s,r,'hypnotist')&&!s.turnFlags.hypnotist) out.push({kind:'hypnotist',label:'催眠传送',labelEn:'Hypnotic warp'});
  if(hasPower(s,r,'third-wheel')&&!s.turnFlags['third-wheel']) out.push({kind:'third-wheel',label:'传送到双人格',labelEn:'Warp to a pair'});
  if(hasPower(s,r,'cheerleader')&&!s.turnFlags.cheerleader) out.push({kind:'cheerleader',label:'为末位加油',labelEn:'Cheer for last place'});
  if(hasPower(s,r,'legs')&&!s.turnFlags['rocket-double']) out.push({kind:'rocket-double',label:'固定移动 5 格',labelEn:'Move exactly 5'});
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

function hasPower(s:GameState,r:RacerState,id:string){return getRacerPowerId(s,r)===id;}
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
function rollOff(s:GameState,playerIds:string[],reasonZh:string,reasonEn:string){
  for(let attempt=0;attempt<12;attempt++){
    const rolls=playerIds.map(id=>({id,roll:rand(s,6)+1}));
    addLog(s,`${reasonZh}：${rolls.map(x=>`${nameOf(s,x.id)} ${x.roll}`).join('，')}`,'normal',`Roll-off ${reasonEn}: ${rolls.map(x=>`${nameOf(s,x.id)} ${x.roll}`).join(', ')}`);
    for(let value=6;value>=1;value--){const atValue=rolls.filter(x=>x.roll===value);if(atValue.length===1)return atValue[0].id;}
  }
  return playerIds[0];
}
function addLog(s:GameState,text:string,tone:'normal'|'power'|'score'|'warning'='normal',textEn=text){s.logs.push({id:s.nextLogId++,text,textEn,tone});if(s.logs.length>80)s.logs.shift();}
function clone<T>(v:T):T{return structuredClone(v);}

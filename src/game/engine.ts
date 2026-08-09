import { RACERS, RACER_BY_ID } from './racers';
import type { DecisionKind, GameAction, GameState, LogEntry, PlayerState, RacerState, TrackKind } from './types';

export const TRACK_LENGTH = 30;
const PLAYER_COLORS = ['#ff4b2b', '#55d5ee', '#f04cab', '#ffd52a'];
const GOLD = [4, 6, 8, 10];
const SILVER = [2, 3, 4, 5];
export const WILD_STARS = new Set([1, 13]);
export const WILD_ROCKS = new Set([5, 17, 26]);
export const WILD_ARROWS: Record<number, number> = { 7: 3, 11: 1, 16: -4, 23: 2, 24: -2 };

export interface FinishChance {
  possible: boolean;
  racerId: string | null;
  distance: number;
  exact: boolean;
  successfulRolls: number[];
  maximumDestination: number;
}

/**
 * Presentation-only forecast for the next main-move die. It mirrors the
 * movement modifiers that can be chosen after a roll without consuming RNG.
 */
export function getFinishChance(s:GameState,racerId=s.turnRacerId):FinishChance {
  const r=racerId?s.racers.find(x=>x.id===racerId):undefined;
  const empty={possible:false,racerId:racerId??null,distance:r?Math.max(0,TRACK_LENGTH-r.position):TRACK_LENGTH,exact:false,successfulRolls:[],maximumDestination:r?.position??0};
  if(s.phase!=='race'||!r||r.finished||r.eliminated||r.position>=TRACK_LENGTH)return empty;

  let modifier=0;
  if(hasPower(s,r,'blimp'))modifier+=r.lastTurnStart<15?3:-1;
  if(hasPower(s,r,'hare'))modifier+=2;
  if(otherHasPower(s,r,'gunk'))modifier-=1;
  modifier+=activeRacers(s).filter(x=>hasPower(s,x,'coach')&&x.position===r.position).length;
  if(hasPower(s,r,'party-animal'))modifier+=activeRacers(s).filter(x=>x.id!==r.id&&x.position===r.position).length;

  const exact=otherHasPower(s,r,'stickler');
  const successfulRolls:number[]=[];
  let maximumDestination=r.position;
  for(let roll=1;roll<=6;roll++){
    const baseMoves=[roll];
    if(hasPower(s,r,'alchemist')&&roll<=2)baseMoves.push(4);
    if(hasPower(s,r,'rocket-scientist'))baseMoves.push(roll*2);
    const sisyphusReset=hasPower(s,r,'sisyphus')&&roll===6;
    const origin=sisyphusReset?0:r.position;
    for(const base of new Set(baseMoves)){
      const amount=sisyphusReset?0:Math.max(0,base+modifier);
      let destination=origin;
      for(let step=0;step<amount;step++){
        destination++;
        if(hasPower(s,r,'leaptoad'))while(activeRacers(s).some(x=>x.id!==r.id&&x.position===destination))destination++;
      }
      maximumDestination=Math.max(maximumDestination,destination);
      if(exact?destination===TRACK_LENGTH:destination>=TRACK_LENGTH){successfulRolls.push(roll);break;}
    }
  }
  return {possible:successfulRolls.length>0,racerId:r.id,distance:TRACK_LENGTH-r.position,exact,successfulRolls,maximumDestination};
}

export function createGame(roomCode: string, hostId: string, hostName: string, seed = Date.now() >>> 0): GameState {
  return {
    roomCode, hostId, phase: 'lobby',
    players: [createPlayer(hostId, hostName, 0)],
    draftPool: [], draftOrder: [], draftIndex: 0, draftDeck: [], draftRound: 0,
    raceNumber: 0, track: 'mild', selected: {}, selectedSecond: {}, racers: [],
    turnPlayerId: null, turnRacerId: null, turnRacerQueue: [], turnOrder: [], finishers: [], raceStartPlayerId: null, raceStartScores: {},
    winnersByRace: [], logs: [], pendingDecision: null, lastRoll: null, lastRollPlayerId: null, lastRollRacerId: null, rollSeq: 0,
    nextLogId: 1, rngSeed: seed || 1, demoMode: false, prediction: {}, skippedTurns: {}, turnFlags: {}, eliminationOrder: [], presentationGate: null
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
  s.presentationGate??=null;
  const player = s.players.find(p => p.id === playerId);
  if (!player) return state;

  if (action.type === 'ACK_PRESENTATION') {
    if (!s.presentationGate || s.presentationGate.playerId !== playerId || s.presentationGate.id !== action.id) return state;
    s.presentationGate = null;
    return s;
  }
  if (s.presentationGate) return state;

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
    const roundLength = draftRoundLength(s);
    if (s.draftIndex === roundLength && s.draftDeck.length) {
      s.draftRound = 1;
      s.draftPool = s.draftDeck.splice(0, roundLength);
      addLog(s, '第二轮选秀开始，翻开一组新角色。', 'score', 'Draft round two begins with a fresh group of racers.');
    } else if (s.draftIndex >= s.draftOrder.length) beginSelection(s);
    return s;
  }
  if (action.type === 'SELECT_RACER') {
    if (s.phase !== 'select' || selectionComplete(s,playerId) || !player.hand.includes(action.racerId) || player.used.includes(action.racerId)) return state;
    if (!s.selected[playerId]) {
      s.selected[playerId] = action.racerId;
      if (racersPerPlayer(s)===2) addLog(s, `${player.name} 已选择第一名角色`, 'normal', `${player.name} chose the first racer`);
    } else {
      if (s.selected[playerId]===action.racerId) return state;
      s.selectedSecond[playerId] = action.racerId;
    }
    if (selectionComplete(s,playerId)) addLog(s, `${player.name} 已锁定本局角色`, 'normal', `${player.name} locked in for this race`);
    if (s.players.every(p => selectionComplete(s,p.id))) beginRace(s);
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
    const gateAfterDecision=['genius-predict','mastermind-predict','magician-reroll','dicemonger-reroll','alchemist-four','rocket-double'].includes(s.pendingDecision.kind);
    resolveDecision(s, action.value);
    return gateAfterDecision?attachMovementGate(state,s):s;
  }
  if (s.pendingDecision) return state;
  if (action.type === 'USE_SPECIAL') {
    openSpecial(s, playerId, action.kind);
    return s;
  }
  if (action.type === 'ROLL') {
    beginMainMove(s);
    return attachMovementGate(state,s);
  }
  return state;
}

function attachMovementGate(before:GameState,after:GameState){
  const racerId=after.lastRollRacerId;
  if(!racerId||after.presentationGate)return after;
  const prior=before.racers.find(r=>r.id===racerId),next=after.racers.find(r=>r.id===racerId);
  if(!prior||!next||prior.position===next.position)return after;
  const isSisyphusWarp=hasPower(after,next,'sisyphus')&&after.lastRoll===6&&next.position===0;
  after.presentationGate={id:after.rollSeq,kind:isSisyphusWarp?'warp':'move',playerId:next.playerId,racerId,from:prior.position,to:next.position};
  return after;
}

export function currentDrafter(s: GameState): string | null { return s.draftOrder[s.draftIndex] ?? null; }

function startDraft(s: GameState) {
  const ids = shuffle(s, RACERS.map(r => r.id));
  const count = s.players.length;
  const startPlayer = rollOff(s, s.players.map(p => p.id), '决定首轮选秀顺位', 'for the first draft pick');
  const start = s.players.findIndex(p => p.id === startPlayer);
  const clockwise = rotate(s.players.map(p => p.id), start);
  const secondStart = rotate(s.players.map(p => p.id), (start + 1) % count);
  const faceUp = count===2 ? 8 : count * 2;
  s.draftPool = ids.slice(0, faceUp);
  s.draftDeck = ids.slice(faceUp, faceUp * 2);
  if(count===2){
    const [a,b]=clockwise;
    s.draftOrder=[a,b,b,a,a,b,b,a,b,a,a,b,b,a,a,b];
  }else{
    s.draftOrder = [...clockwise, ...clockwise.slice().reverse(), ...secondStart, ...secondStart.slice().reverse()];
  }
  s.draftIndex = 0;
  s.draftRound = 0;
  s.phase = 'draft';
  addLog(s, `选秀开始，${nameOf(s, clockwise[0])} 首选`, 'score', `The draft begins. ${nameOf(s, clockwise[0])} picks first.`);
}

function beginSelection(s: GameState) {
  s.phase = 'select';
  s.selected = Object.fromEntries(s.players.map(p => [p.id, null]));
  s.selectedSecond = Object.fromEntries(s.players.map(p => [p.id, null]));
  addLog(s, racersPerPlayer(s)===2?'选秀完成！每位玩家秘密选择两名角色参加第一局。':'选秀完成！所有选手秘密选择第一局角色。', 'score', racersPerPlayer(s)===2?'The draft is complete. Secretly choose two racers for Race 1.':'The draft is complete. Secretly choose a racer for Race 1.');
}

function beginRace(s: GameState) {
  s.phase = 'race';
  s.track = (s.raceNumber % 2 === 0 ? 'mild' : 'wild') as TrackKind;
  s.racers = s.players.flatMap(p => [s.selected[p.id],s.selectedSecond[p.id]].filter((id):id is string=>Boolean(id)).map((racerId,index) => ({
    id:`${p.id}:${index}`,playerId: p.id, racerId, position: 0, tripped: false, finished: null,
    eliminated: false, lastTurnStart: 0, firstTurn: true, rerolls: 0, dicemongerUsed: false
  })));
  s.finishers = [];
  s.pendingDecision = null;
  s.lastRoll = null;
  s.lastRollPlayerId = null;
  s.lastRollRacerId = null;
  s.prediction = {};
  s.skippedTurns = {};
  s.turnFlags = {};
  s.turnRacerQueue = [];
  s.eliminationOrder = [];
  const previousRaceGains=Object.fromEntries(s.players.map(p=>[p.id,p.score-(s.raceStartScores[p.id]??p.score)]));
  s.raceStartScores=Object.fromEntries(s.players.map(p=>[p.id,p.score]));

  const setupQueue:Array<{racerStateId:string;kind:'egg-copy'|'twin-copy';options:string[]}> = [];
  for (const r of s.racers) {
    const p = playerFor(s, r);
    p.used.push(r.racerId);
    if (r.racerId === 'sisyphus') { p.score += 4; power(s, r, `${p.name} 的西西弗斯赛前获得 4 分`, `${p.name}'s Sisyphus gains 4 points before the race`); }
    if (r.racerId === 'egg') {
      const used = new Set(s.racers.map(x => x.racerId));
      const candidates = shuffle(s, RACERS.map(x => x.id).filter(id => !used.has(id) && id !== 'egg')).slice(0, 3);
      setupQueue.push({racerStateId:r.id,kind:'egg-copy',options:candidates});
    }
    if (r.racerId === 'twin' && s.winnersByRace.length) {
      const previousWinners=[...new Set(s.winnersByRace)];
      if(previousWinners.length) setupQueue.push({racerStateId:r.id,kind:'twin-copy',options:previousWinners});
    }
  }

  let first:string;
  if(s.raceNumber===0||!s.raceStartPlayerId) first=rollOff(s,s.players.map(p=>p.id),'决定第一局起始玩家','for the first turn');
  else if(s.players.length===2){
    const gains=s.players.map(p=>({id:p.id,gain:previousRaceGains[p.id]??0}));
    first=gains[0].gain===gains[1].gain?rollOff(s,s.players.map(p=>p.id),'上局得分相同，决定下一局先手','after tied race points'):gains.sort((a,b)=>a.gain-b.gain)[0].id;
  }else{
    const previousIndex=s.players.findIndex(p=>p.id===s.raceStartPlayerId);
    first=s.players[(previousIndex+1+s.players.length)%s.players.length].id;
  }
  s.raceStartPlayerId=first;
  const base = s.players.map(p => p.id);
  s.turnOrder = rotate(base, base.indexOf(first));
  s.turnPlayerId = s.turnOrder[0];
  s.turnRacerId = null;
  addLog(s, `第 ${s.raceNumber + 1} 局开始：${s.track === 'mild' ? '温和里程' : '狂野里程'}！`, 'score', `Race ${s.raceNumber + 1} begins on the ${s.track === 'mild' ? 'Mild' : 'Wild'} Mile!`);
  announceRacers(s);
  s.prediction.setupQueue=JSON.stringify(setupQueue);
  continueRaceSetup(s);
}

function continueRaceSetup(s:GameState){
  const queue=JSON.parse(String(s.prediction.setupQueue??'[]')) as Array<{racerStateId:string;kind:'egg-copy'|'twin-copy';options:string[]}>;
  const next=queue.shift();
  s.prediction.setupQueue=JSON.stringify(queue);
  if(!next){delete s.prediction.setupQueue;s.turnPlayerId=s.turnOrder[0];beginPlayerTurn(s);return;}
  const racer=racerById(s,next.racerStateId)!;
  s.turnPlayerId=racer.playerId;
  s.turnRacerId=racer.id;
  s.pendingDecision={
    playerId:racer.playerId,kind:next.kind,
    prompt:next.kind==='egg-copy'?'蛋展示了 3 名角色，请选择本局获得的能力。':'双生子要复制哪一名此前冠军的能力？',
    promptEn:next.kind==='egg-copy'?'Egg drew 3 racers. Choose a power for this race.':'Which previous winner should Twin copy?',
    options:next.options.map(id=>({value:id,label:`${RACER_BY_ID[id].nameZh} · ${RACER_BY_ID[id].powerZh}`,labelEn:`${RACER_BY_ID[id].name} · ${RACER_BY_ID[id].power}`})),optional:next.kind==='twin-copy'
  };
  addLog(s,`${nameOf(s,racer.playerId)} 正在为 ${RACER_BY_ID[racer.racerId].nameZh} 选择能力`,'power',`${nameOf(s,racer.playerId)} is choosing a power for ${RACER_BY_ID[racer.racerId].name}`);
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
  if (hasPower(s, r, 'mastermind') && r.firstTurn && s.prediction[`mastermind:${r.id}`] === undefined) {
    s.pendingDecision = {
      playerId:r.playerId, kind:'mastermind-predict', prompt:'幕后主脑预测谁会赢得本局？', promptEn:'Who will win this race?',
      options:s.racers.map(x=>({value:x.id,label:racerNameOf(s,x),labelEn:racerNameOf(s,x,'en')})), optional:false
    };
    return;
  }
  rollForMove(s, r);
}

function rollForMove(s: GameState, r: RacerState) {
  const roll = rand(s, 6) + 1;
  s.lastRoll = roll;
  s.lastRollPlayerId = r.playerId;
  s.lastRollRacerId = r.id;
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
    for (const worm of activeRacers(s).filter(x => x.id !== r.id && hasPower(s,x,'inchworm'))) {
      power(s, worm, `${nameOf(s,worm.playerId)} 的尺蠖扭动 1 格，${nameOf(s,r.playerId)} 跳过本次移动`, `${nameOf(s,worm.playerId)}'s Inchworm moves 1; ${nameOf(s,r.playerId)} skips the move`,r);
      moveRacer(s, worm, 1, 'power');
      s.skippedTurns[`roll:${r.id}`] = 1;
    }
    const skipper = activeRacers(s).find(x => hasPower(s,x,'skipper'));
    if (skipper) s.skippedTurns.nextRacer = skipper.id as unknown as number;
  }
  if (roll === 6) {
    for (const lackey of activeRacers(s).filter(x => x.id !== r.id && hasPower(s,x,'lackey'))) {
      power(s, lackey, `${nameOf(s,lackey.playerId)} 的侍从抢先移动 2 格`, `${nameOf(s,lackey.playerId)}'s Lackey moves 2 before the roller`,r);
      moveRacer(s, lackey, 2, 'power');
    }
  }
  if (s.phase !== 'race') return;
  if (s.skippedTurns[`roll:${r.id}`]) {
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
  if (s.skippedTurns[`roll:${r.id}`]) {
    delete s.skippedTurns[`roll:${r.id}`];
    power(s, r, `${RACER_BY_ID[r.racerId].nameZh} 的主移动被跳过`, `${RACER_BY_ID[r.racerId].name}'s main move is skipped`);
    endTurn(s, r);
    return;
  }
  if (hasPower(s,r,'sisyphus') && roll === 6) {
    r.position = 0;
    playerFor(s,r).score = Math.max(0, playerFor(s,r).score - 1);
    power(s,r,`${nameOf(s,r.playerId)} 的西西弗斯回到起点并失去 1 分，本次主移动结束`, `${nameOf(s,r.playerId)}'s Sisyphus warps to Start, loses 1 point, and ends the main move`);
    checkStopEffects(s, r, 0);
    if (s.phase === 'race' && !r.finished && !r.eliminated) endTurn(s,r);
    return;
  }

  let amount = amountOverride ?? (rocketDouble ? roll * 2 : roll);
  // Space 15 is the rounded lower-right space: the second corner itself.
  // Blimp receives +3 only before that corner, and -1 on or after it.
  if (hasPower(s,r,'blimp')) {
    const modifier=r.lastTurnStart < 15 ? 3 : -1;amount+=modifier;
    describePower(s,r,modifier,modifier>0?'飞艇在第二拐角前，主移动 +3':'飞艇越过第二拐角，主移动 -1',modifier>0?'Blimp is before the second corner: main move +3':'Blimp is past the second corner: main move -1');
  }
  if (hasPower(s,r,'hare')) { amount += 2;describePower(s,r,2,'野兔的主移动 +2','Hare adds 2 to its main move'); }
  const gunk=activeRacers(s).find(x=>x.id!==r.id&&hasPower(s,x,'gunk'));
  if (gunk) { amount -= 1;describePower(s,gunk,-1,`${racerNameOf(s,r)} 受黏液影响，主移动 -1`,`${racerNameOf(s,r,'en')} is slowed by Gunk: main move -1`,r); }
  for (const coach of activeRacers(s).filter(x => hasPower(s,x,'coach') && x.position === r.position)) {
    amount += 1;describePower(s,coach,1,`${racerNameOf(s,r)} 与教练同格，主移动 +1`,`${racerNameOf(s,r,'en')} shares a space with Coach: main move +1`,r);
  }
  if (hasPower(s,r,'party-animal')) {
    const guests=activeRacers(s).filter(x => x.id !== r.id && x.position === r.position).length;
    if(guests){amount+=guests;describePower(s,r,guests,`派对动物与 ${guests} 名角色同格，主移动 +${guests}`,`Party Animal shares its space with ${guests} racer${guests===1?'':'s'}: main move +${guests}`);}
  }
  amount = Math.max(0, amount);

  const predicted = s.prediction[turnKey(s,r)];
  if (hasPower(s,r,'genius') && predicted === roll) s.skippedTurns.extraTurn = r.id as unknown as number;
  moveRacer(s, r, amount, 'main');
  if (rocketDouble && !r.finished && !r.eliminated) { r.tripped = true; power(s,r,'火箭冲刺后绊倒了','The rocket sprint ends in a trip'); }
  endTurn(s,r);
}

function beginPlayerTurn(s:GameState){
  if(s.phase!=='race'||!s.turnPlayerId)return;
  const owned=activeRacers(s).filter(r=>r.playerId===s.turnPlayerId);
  if(!owned.length){
    const next=nextActivePlayer(s,s.turnPlayerId);
    if(next===s.turnPlayerId)return;
    s.turnPlayerId=next;beginPlayerTurn(s);return;
  }
  s.turnRacerQueue=[];
  s.turnRacerId=null;
  s.pendingDecision=null;
  if(owned.length>1){
    s.pendingDecision={
      playerId:s.turnPlayerId,kind:'two-player-order',
      prompt:'选择本轮先行动的角色；完成后另一名角色再行动。',
      promptEn:'Choose which racer acts first; your other racer acts afterward.',
      options:owned.map(r=>({value:r.id,label:`${RACER_BY_ID[r.racerId].nameZh} · 第 ${r.position} 格`,labelEn:`${RACER_BY_ID[r.racerId].name} · Space ${r.position}`})),optional:false
    };
    addLog(s,`${nameOf(s,s.turnPlayerId)} 正在选择两名角色的行动顺序`,'normal',`${nameOf(s,s.turnPlayerId)} is choosing the order of both racers`);
    return;
  }
  s.turnRacerId=owned[0].id;
  startRacerTurn(s);
}

function startRacerTurn(s: GameState) {
  const r = currentRacer(s);
  if (!r || s.phase !== 'race') return;
  if(isCopycatSource(r)){
    const leaders=leadRacers(s,r);
    const choiceKey=`copycat:${r.id}`;
    const selected=String(s.prediction[choiceKey]??'');
    if(leaders.length>1&&!leaders.some(x=>x.id===selected)){
      s.pendingDecision={
        playerId:r.playerId,kind:'copycat-leader',
        prompt:'多名角色并列领跑：选择模仿猫当前复制的能力。',
        promptEn:'The lead is tied. Choose which power Copycat copies.',
        options:leaders.map(x=>({value:x.id,label:`${RACER_BY_ID[x.racerId].nameZh} · ${RACER_BY_ID[getRacerPowerId(s,x)].powerZh}`,labelEn:`${RACER_BY_ID[x.racerId].name} · ${RACER_BY_ID[getRacerPowerId(s,x)].power}`})),optional:false
      };
      addLog(s,`${racerNameOf(s,r)} 正在并列领跑者中选择复制能力`,'power',`${racerNameOf(s,r,'en')} is choosing a power from the tied leaders`,{sourceRacerId:r.id,effectKind:'decision'});
      return;
    }
  }
  r.lastTurnStart = r.position;
  r.rerolls = 0;
  r.dicemongerUsed = false;
  s.turnFlags = {};
  s.pendingDecision = null;
  addLog(s, `轮到 ${nameOf(s,r.playerId)} · ${RACER_BY_ID[r.racerId].nameZh}`, 'normal', `${nameOf(s,r.playerId)} · ${RACER_BY_ID[r.racerId].name}'s turn`);

  if (r.tripped) {
    s.pendingDecision={
      playerId:r.playerId,kind:'recover-trip',
      prompt:`${RACER_BY_ID[r.racerId].nameZh} 绊倒了：扶起棋子并跳过本次主移动。`,
      promptEn:`${RACER_BY_ID[r.racerId].name} is down: stand the piece up and skip this main move.`,
      options:[{value:'recover',label:'扶起来',labelEn:'Stand up'}],optional:false
    };
    addLog(s,`${racerNameOf(s,r)} 绊倒在地，等待玩家扶起`,'warning',`${racerNameOf(s,r,'en')} is down and waits to be stood up`,{sourceRacerId:r.id,targetRacerId:r.id,effectKind:'decision'});
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
    for (const other of activeRacers(s).filter(x=>x.id!==r.id)) {
      const dir = Math.sign(target - other.position);
      if (dir) moveRacer(s,other,dir,'power');
      if(s.phase!=='race')return;
    }
  }
  if(r.finished||r.eliminated)endTurn(s,r);
}

function openSpecial(s: GameState, playerId: string, kind: DecisionKind) {
  const r = currentRacer(s); if (!r || r.playerId !== playerId) return;
  if (s.turnFlags[kind]) return;
  s.turnFlags[kind] = true;
  if (kind === 'flip-flop' && hasPower(s,r,'flip-flop')) {
    s.pendingDecision = { playerId, kind, prompt:'选择要互换位置的角色', promptEn:'Choose a racer to swap spaces with.', options:activeRacers(s).filter(x=>x.id!==r.id).map(x=>({value:x.id,label:`${racerNameOf(s,x)} · 第 ${x.position} 格`,labelEn:`${racerNameOf(s,x,'en')} · Space ${x.position}`})), optional:true };
  } else if (kind === 'hypnotist' && hasPower(s,r,'hypnotist')) {
    s.pendingDecision = { playerId, kind, prompt:'选择要催眠传送到你身边的角色', promptEn:'Choose a racer to warp to your space.', options:activeRacers(s).filter(x=>x.id!==r.id).map(x=>({value:x.id,label:racerNameOf(s,x),labelEn:racerNameOf(s,x,'en')})), optional:true };
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
    power(s,r,'大长腿跳过掷骰，将主移动基础值改为 5 格','Legs skips the roll and sets its main move to 5'); resolveRoll(s,r,0,false,5);
  } else {
    delete s.turnFlags[kind];
  }
}

function resolveDecision(s: GameState, value: string) {
  const d = s.pendingDecision!;
  if(d.kind==='two-player-order'){
    const chosen=racerById(s,value);
    if(!chosen||chosen.playerId!==d.playerId||chosen.finished||chosen.eliminated)return;
    const remaining=activeRacers(s).filter(r=>r.playerId===d.playerId&&r.id!==chosen.id);
    s.pendingDecision=null;
    addLog(s,`${nameOf(s,d.playerId)} 选择 ${RACER_BY_ID[chosen.racerId].nameZh} 先行动`,'normal',`${nameOf(s,d.playerId)} chooses ${RACER_BY_ID[chosen.racerId].name} to act first`,{sourceRacerId:chosen.id,effectKind:'decision'});
    s.turnRacerId=chosen.id;s.turnRacerQueue=remaining.map(r=>r.id);startRacerTurn(s);return;
  }
  if(d.kind==='copycat-leader'){
    const copycat=currentRacer(s),chosen=racerById(s,value);
    if(!copycat||!isCopycatSource(copycat)||!chosen||!leadRacers(s,copycat).some(x=>x.id===chosen.id))return;
    s.pendingDecision=null;s.prediction[`copycat:${copycat.id}`]=chosen.id;
    addLog(s,`${racerNameOf(s,copycat)} 复制 ${RACER_BY_ID[chosen.racerId].nameZh}`,'power',`${racerNameOf(s,copycat,'en')} copies ${RACER_BY_ID[chosen.racerId].name}`,{sourceRacerId:copycat.id,targetRacerId:chosen.id,effectKind:'decision'});
    startRacerTurn(s);return;
  }
  const r = currentRacer(s); if (!r) return;
  s.pendingDecision = null;
  if(d.kind==='recover-trip'){
    r.tripped=false;
    addLog(s,`${nameOf(s,r.playerId)} 扶起了 ${RACER_BY_ID[r.racerId].nameZh}，本次主移动跳过`,'warning',`${nameOf(s,r.playerId)} stands ${RACER_BY_ID[r.racerId].name} up and skips this main move`,{sourceRacerId:r.id,targetRacerId:r.id,effectKind:'decision'});
    endTurn(s,r);return;
  }
  const option=d.options.find(x=>x.value===value);
  const target=racerById(s,value);
  if(value==='skip')addLog(s,`${racerNameOf(s,r)} 选择暂不使用主动能力`,'normal',`${racerNameOf(s,r,'en')} declines the active power`,{sourceRacerId:r.id,effectKind:'decision'});
  else if(option)addLog(s,`${racerNameOf(s,r)} 选择：${option.label}`,'normal',`${racerNameOf(s,r,'en')} chooses: ${option.labelEn}`,{sourceRacerId:r.id,targetRacerId:target?.id,effectKind:'decision'});
  if (value === 'skip') {
    if(d.kind==='twin-copy'){
      s.turnFlags[`setup:${r.id}:twin`]=true;
      continueRaceSetup(s);
    }
    return;
  }
  if (d.kind === 'genius-predict') { s.prediction[turnKey(s,r)] = Number(value); power(s,r,`天才预测 ${value} 点`,`Genius predicts ${value}`); rollForMove(s,r); }
  else if (d.kind === 'mastermind-predict') { const predicted=racerById(s,value);if(!predicted)return;s.prediction[`mastermind:${r.id}`] = value; power(s,r,`幕后主脑预测 ${racerNameOf(s,predicted)} 获胜`,`Mastermind predicts ${racerNameOf(s,predicted,'en')} will win`,predicted); rollForMove(s,r); }
  else if (d.kind === 'flip-flop') {
    const target = racerById(s,value); if (!target) return;
    [r.position,target.position]=[target.position,r.position]; power(s,r,`换位怪与 ${racerNameOf(s,target)} 交换位置`,`Flip Flop swaps spaces with ${racerNameOf(s,target)}`,target); checkStopEffects(s,r,0); endTurn(s,r);
  } else if (d.kind === 'hypnotist') {
    const target=racerById(s,value); if (!target) return;
    target.position=r.position; power(s,r,`催眠师把 ${racerNameOf(s,target)} 传送到身边`,`Hypnotist warps ${racerNameOf(s,target)} to its space`,target); checkStopEffects(s,target,0);
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
      if (dice) {
        power(s,dice,dice.id===r.id?'骰子商人使用自己的重掷':'骰子商人促成重掷并移动 1 格',dice.id===r.id?'Dicemonger uses its own reroll':'Dicemonger causes a reroll and moves 1');
        if(dice.id!==r.id)moveRacer(s,dice,1,'power');
      }
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
    s.turnFlags[`setup:${r.id}:${d.kind==='egg-copy'?'egg':'twin'}`]=true;
    if(value==='egg'&&!s.turnFlags[`setup:${r.id}:egg`])queueCopiedSetup(s,r,'egg-copy');
    if(value==='twin'&&s.winnersByRace.length&&!s.turnFlags[`setup:${r.id}:twin`])queueCopiedSetup(s,r,'twin-copy');
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
    if (hasPower(s,r,'leaptoad')) {
      while (activeRacers(s).some(x=>x.id!==r.id && x.position===destination)) {
        destination+=direction;
        power(s,r,`跳蛙跳过一个被占据的格子`,`Leaptoad skips an occupied space`);
      }
    }
  }
  destination = Math.max(0,destination);
  const stickler=activeRacers(s).find(x=>x.id!==r.id&&hasPower(s,x,'stickler'));
  if (destination > TRACK_LENGTH && stickler) {
    power(s,stickler,`${nameOf(s,r.playerId)} 因较真者要求精确冲线，原地不动`,`${nameOf(s,r.playerId)} cannot cross because Stickler requires an exact move`,r); return;
  }

  const sameHuge = activeRacers(s).find(x=>x.id!==r.id && hasPower(s,x,'huge-baby') && x.position===destination && destination!==0);
  if (sameHuge) {
    destination=Math.max(0,sameHuge.position-1);
    const loopKey=`huge-loop:${sameHuge.id}:${r.id}`;
    const closesScoocherLoop=hasPower(s,r,'scoocher')&&destination===start&&s.turnFlags[loopKey];
    if(!closesScoocherLoop){s.turnFlags[loopKey]=true;power(s,sameHuge,`${nameOf(s,r.playerId)} 被巨婴挡在后一格`,`${nameOf(s,r.playerId)} is stopped one space behind Huge Baby`,r);}
    else addLog(s,'巨婴与蹭步者的循环完成一次后结束','power','The Huge Baby and Scoocher loop completes once and ends',{sourceRacerId:sameHuge.id,targetRacerId:r.id,effectKind:'ability'});
  }
  r.position = destination;
  if(hasPower(s,r,'huge-baby')&&destination!==0){
    const displaced=activeRacers(s).filter(x=>x.id!==r.id&&x.position===destination);
    for(const other of displaced){
      other.position=Math.max(0,destination-1);
      power(s,r,`巨婴把 ${racerNameOf(s,other)} 挤到后一格`,`Huge Baby puts ${racerNameOf(s,other,'en')} one space behind`,other);
      if(direction>0&&hasPower(s,other,'banana')&&start<destination&&other.position<=start){
        r.tripped=true;
        addLog(s,`${racerNameOf(s,r)} 超过香蕉并绊倒`,'warning',`${racerNameOf(s,r,'en')} passes Banana and trips`,{sourceRacerId:other.id,targetRacerId:r.id,effectKind:'ability'});
      }
      checkStopEffects(s,other,depth+1);
      if(s.phase!=='race')return;
    }
  }
  addLog(s, `${nameOf(s,r.playerId)} ${cause==='main'?'主移动':'移动'} ${Math.abs(destination-start)} 格 → ${Math.min(destination,TRACK_LENGTH)}`, 'normal', `${nameOf(s,r.playerId)} ${cause==='main'?'main ':''}moves ${Math.abs(destination-start)} → Space ${Math.min(destination,TRACK_LENGTH)}`, {sourceRacerId:r.id,effectKind:'move'});
  const followers=activeRacers(s).filter(x=>x.id!==r.id && hasPower(s,x,'suckerfish') && x.position===start);
  if (direction > 0) {
    for (const passed of activeRacers(s).filter(x=>x.id!==r.id && x.position>start && x.position<destination)) {
      if (hasPower(s,passed,'banana')) { r.tripped=true; addLog(s,`${nameOf(s,r.playerId)} 超过香蕉并绊倒`,'warning',`${nameOf(s,r.playerId)} passes Banana and trips`,{sourceRacerId:passed.id,targetRacerId:r.id,effectKind:'ability'}); }
      if (hasPower(s,r,'centaur')) { power(s,r,`半人马踢退 ${nameOf(s,passed.playerId)} 2 格`,`Centaur kicks ${nameOf(s,passed.playerId)} back 2`,passed); moveRacer(s,passed,-2,'power',depth+1); }
    }
  }
  if (destination >= TRACK_LENGTH) {
    finishRacer(s,r);
    if(s.phase!=='race')return;
  }
  for (const fish of followers.filter(x=>!x.finished&&!x.eliminated)) {
    fish.position=destination; power(s,fish,`${nameOf(s,fish.playerId)} 的吸盘鱼跟随移动`,`${nameOf(s,fish.playerId)}'s Suckerfish follows the move`,r);
    if(destination>=TRACK_LENGTH)finishRacer(s,fish);else checkStopEffects(s,fish,depth+1);
    if(s.phase!=='race')return;
  }
  if(r.finished)return;
  checkStopEffects(s,r,depth+1);
}

function checkStopEffects(s: GameState, r: RacerState, depth: number) {
  if (depth > 18 || r.finished || r.eliminated || s.phase !== 'race') return;
  if (s.track === 'wild') {
    if (WILD_ROCKS.has(r.position)) { r.tripped=true; addLog(s,`${nameOf(s,r.playerId)} 停在石头上，绊倒了`,'warning',`${nameOf(s,r.playerId)} stops on a rock and trips`,{sourceRacerId:r.id,targetRacerId:r.id,effectKind:'track'}); }
    if (WILD_STARS.has(r.position)) { playerFor(s,r).score+=1; addLog(s,`${nameOf(s,r.playerId)} 拾取星星，获得 1 分`,'score',`${nameOf(s,r.playerId)} collects a star and gains 1 point`,{sourceRacerId:r.id,effectKind:'track'}); }
    const arrow=WILD_ARROWS[r.position]; if (arrow) { addLog(s,`箭头推动 ${nameOf(s,r.playerId)} ${arrow>0?'前进':'后退'} ${Math.abs(arrow)} 格`,'power',`An arrow moves ${nameOf(s,r.playerId)} ${arrow>0?'forward':'back'} ${Math.abs(arrow)}`,{sourceRacerId:r.id,effectKind:'track'}); moveRacer(s,r,arrow,'track',depth+1); return; }
  }
  for (const baba of activeRacers(s).filter(x=>x.id!==r.id && hasPower(s,x,'baba-yaga') && x.position===r.position)) { r.tripped=true;addLog(s,`${racerNameOf(s,r)} 被芭芭雅嘎绊倒`,'warning',`${racerNameOf(s,r,'en')} is tripped by Baba Yaga`,{sourceRacerId:baba.id,targetRacerId:r.id,effectKind:'ability'}); }
  if (hasPower(s,r,'baba-yaga')) for (const other of activeRacers(s).filter(x=>x.id!==r.id && x.position===r.position)) { other.tripped=true;addLog(s,`${racerNameOf(s,other)} 被芭芭雅嘎绊倒`,'warning',`${racerNameOf(s,other,'en')} is tripped by Baba Yaga`,{sourceRacerId:r.id,targetRacerId:other.id,effectKind:'ability'}); }
  const occupants=activeRacers(s).filter(x=>x.position===r.position);
  if (hasPower(s,r,'mouth') && occupants.length===2) {
    const victim=occupants.find(x=>x.id!==r.id)!; victim.eliminated=true; s.eliminationOrder.push(victim.id); power(s,r,`${racerNameOf(s,victim)} 被大嘴淘汰！`,`${racerNameOf(s,victim,'en')} is eliminated by M.O.U.T.H.!`,victim); checkRaceEndBySurvivors(s); return;
  }
  if (occupants.length===2) for (const romantic of activeRacers(s).filter(x=>hasPower(s,x,'romantic'))) { power(s,romantic,'浪漫家见证两人同格，移动 2','Romantic sees a pair sharing a space and moves 2',r); moveRacer(s,romantic,2,'power',depth+1); }
  for (const duelist of occupants.filter(x=>hasPower(s,x,'duelist'))) {
    const foe=occupants.find(x=>x.id!==duelist.id); if (!foe) continue;
    const a=rand(s,6)+1,b=rand(s,6)+1; const winner=a>=b?duelist:foe;
    power(s,duelist,`决斗！${nameOf(s,duelist.playerId)} ${a} : ${b} ${nameOf(s,foe.playerId)}，${nameOf(s,winner.playerId)} 前进 2`,`Duel! ${nameOf(s,duelist.playerId)} ${a} : ${b} ${nameOf(s,foe.playerId)}. ${nameOf(s,winner.playerId)} moves 2`,foe);
    moveRacer(s,winner,2,'power',depth+1);
  }
}

function finishRacer(s: GameState, r: RacerState) {
  if (r.finished) return;
  r.position=TRACK_LENGTH; r.finished=s.finishers.length+1; s.finishers.push(r.id);
  addLog(s,`${racerNameOf(s,r)} 第 ${r.finished} 名冲线！`,'score',`${racerNameOf(s,r,'en')} finishes in place ${r.finished}!`,{sourceRacerId:r.id,effectKind:'finish'});
  if (r.finished===1) {
    const predicted=s.racers.find(x=>hasPower(s,x,'mastermind') && s.prediction[`mastermind:${x.id}`]===r.id && !x.eliminated && (!x.finished || x===r));
    if (predicted) {
      if (predicted !== r) { predicted.finished=2; predicted.position=TRACK_LENGTH; }
      s.finishers.push(predicted.id);
      power(s,predicted,`幕后主脑预测正确，获得第 2 名！`,`Mastermind predicted correctly and takes 2nd place!`);
    }
  }
  if (s.finishers.length>=2 || activeRacers(s).length===0) endRace(s);
}

function checkRaceEndBySurvivors(s: GameState) {
  const survivors=activeRacers(s);
  // M.O.U.T.H. ends the race as soon as only one racer remains; that survivor
  // immediately takes whichever placement is still available.
  if(survivors.length===1)finishRacer(s,survivors[0]);
  else if (survivors.length===0) endRace(s);
}

function endRace(s: GameState) {
  if (s.phase!=='race') return;
  const first=finishRacerByPlace(s,0), second=finishRacerByPlace(s,1);
  if (first) { playerFor(s,first).score+=GOLD[s.raceNumber]; s.winnersByRace.push(first.racerId); addLog(s,`${racerNameOf(s,first)} 获得 ${GOLD[s.raceNumber]} 分金杯`,'score',`${racerNameOf(s,first,'en')} gains the ${GOLD[s.raceNumber]}-point gold prize`,{sourceRacerId:first.id,effectKind:'finish'}); }
  if (second) { playerFor(s,second).score+=SILVER[s.raceNumber]; addLog(s,`${racerNameOf(s,second)} 获得 ${SILVER[s.raceNumber]} 分银花`,'score',`${racerNameOf(s,second,'en')} gains the ${SILVER[s.raceNumber]}-point silver prize`,{sourceRacerId:second.id,effectKind:'finish'}); }
  s.phase='raceResult'; s.turnPlayerId=null; s.turnRacerId=null;s.turnRacerQueue=[];s.pendingDecision=null;
}

function continueAfterRace(s: GameState) {
  s.raceNumber++;
  if (s.raceNumber>=4) { s.phase='gameOver'; addLog(s,`游戏结束！${leaders(s).map(p=>p.name).join('、')} 获胜！`,'score',`Game over! ${leaders(s).map(p=>p.name).join(' & ')} wins!`); return; }
  s.phase='select'; s.selected=Object.fromEntries(s.players.map(p=>[p.id,null]));s.selectedSecond=Object.fromEntries(s.players.map(p=>[p.id,null])); s.racers=[]; s.finishers=[];
  addLog(s,`请选择第 ${s.raceNumber+1} 局角色`,'score',`Choose a racer for Race ${s.raceNumber+1}`);
}

function endTurn(s: GameState, r: RacerState) {
  if (s.phase!=='race') return;
  for (const heckler of activeRacers(s).filter(x=>x.id!==r.id && hasPower(s,x,'heckler'))) if (Math.abs(r.position-r.lastTurnStart)<=1) { power(s,heckler,`起哄者因 ${racerNameOf(s,r)} 几乎没动而前进 2`,`Heckler moves 2 because ${racerNameOf(s,r,'en')} ended within 1 space of the start position`); moveRacer(s,heckler,2,'power'); }
  r.firstTurn=false;
  delete s.prediction[turnKey(s,r)];
  if (s.phase!=='race') return;
  const extra=s.skippedTurns.extraTurn as unknown as string | undefined;
  const forced=s.skippedTurns.nextRacer as unknown as string | undefined;
  const forcedRacer=forced?racerById(s,forced):undefined;
  if (forcedRacer&&!forcedRacer.finished&&!forcedRacer.eliminated) {
    delete s.skippedTurns.nextRacer;
    if(extra===r.id)delete s.skippedTurns.extraTurn;
    // In the official two-player variant, Skipper interrupts the chosen pair order;
    // it does not erase the other racer still waiting to act for that player.
    s.turnRacerQueue=s.turnRacerQueue.filter(id=>id!==forcedRacer.id);
    s.turnPlayerId=forcedRacer.playerId;s.turnRacerId=forcedRacer.id;addLog(s,`${racerNameOf(s,forcedRacer)} 下一个行动`,'power',`${racerNameOf(s,forcedRacer,'en')} goes next`,{sourceRacerId:forcedRacer.id,effectKind:'ability'});startRacerTurn(s);return;
  }
  if (extra===r.id) {
    delete s.skippedTurns.extraTurn;s.turnPlayerId=r.playerId;s.turnRacerId=r.id;addLog(s,'天才预测正确，立即再行动一次！','power','Genius predicted correctly and takes another turn!',{sourceRacerId:r.id,effectKind:'ability'});startRacerTurn(s);return;
  }
  const queued=s.turnRacerQueue.shift();
  const queuedRacer=queued?racerById(s,queued):undefined;
  if(queuedRacer&&!queuedRacer.finished&&!queuedRacer.eliminated){s.turnPlayerId=queuedRacer.playerId;s.turnRacerId=queuedRacer.id;startRacerTurn(s);return;}
  s.turnPlayerId=nextActivePlayer(s,r.playerId);s.turnRacerId=null;beginPlayerTurn(s);
}

function power(s:GameState,r:RacerState,text:string,textEn=text,target?:RacerState) {
  addLog(s,text,'power',textEn,{sourceRacerId:r.id,targetRacerId:target?.id,effectKind:'ability'});
  for (const scooch of activeRacers(s).filter(x=>x.id!==r.id && hasPower(s,x,'scoocher'))) {
    addLog(s,`${nameOf(s,scooch.playerId)} 的蹭步者前进 1`,'power',`${nameOf(s,scooch.playerId)}'s Scoocher moves 1`,{sourceRacerId:scooch.id,effectKind:'ability'});
    moveRacer(s,scooch,1,'power',16);
  }
}

function describePower(s:GameState,r:RacerState,modifier:number,text:string,textEn=text,target?:RacerState){
  addLog(s,text,'power',textEn,{sourceRacerId:r.id,targetRacerId:target?.id,effectKind:'modifier',modifier});
  triggerScoochers(s,r);
}

function triggerScoochers(s:GameState,r:RacerState){
  for (const scooch of activeRacers(s).filter(x=>x.id!==r.id && hasPower(s,x,'scoocher'))) {
    addLog(s,`${nameOf(s,scooch.playerId)} 的蹭步者前进 1`,'power',`${nameOf(s,scooch.playerId)}'s Scoocher moves 1`,{sourceRacerId:scooch.id,effectKind:'ability'});
    moveRacer(s,scooch,1,'power',16);
  }
}

function queueCopiedSetup(s:GameState,r:RacerState,kind:'egg-copy'|'twin-copy'){
  const queue=JSON.parse(String(s.prediction.setupQueue??'[]')) as Array<{racerStateId:string;kind:'egg-copy'|'twin-copy';options:string[]}>;
  const options=kind==='egg-copy'
    ? shuffle(s,RACERS.map(x=>x.id).filter(id=>id!=='egg'&&!s.racers.some(x=>x.racerId===id))).slice(0,3)
    : [...new Set(s.winnersByRace)];
  if(options.length)queue.unshift({racerStateId:r.id,kind,options});
  s.prediction.setupQueue=JSON.stringify(queue);
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
  const basePower=r.powerOverride??r.racerId;
  if(basePower==='copycat') {
    const leaders=leadRacers(s,r);
    const selected=String(s.prediction[`copycat:${r.id}`]??'');
    const lead=leaders.find(x=>x.id===selected)??leaders[0];
    return lead?.racerId==='copycat' ? 'copycat' : (lead?.powerOverride ?? lead?.racerId ?? 'copycat');
  }
  return basePower;
}

function isCopycatSource(r:RacerState){return (r.powerOverride??r.racerId)==='copycat';}

function leadRacers(s:GameState,copycat:RacerState){
  const candidates=activeRacers(s).filter(x=>x.id!==copycat.id);
  const lead=Math.max(-1,...candidates.map(x=>x.position));
  return candidates.filter(x=>x.position===lead);
}

function hasPower(s:GameState,r:RacerState,id:string){return getRacerPowerId(s,r)===id;}
function otherHasPower(s:GameState,r:RacerState,id:string){return activeRacers(s).some(x=>x.id!==r.id&&hasPower(s,x,id));}
function activeRacers(s:GameState){return s.racers.filter(r=>!r.finished&&!r.eliminated);}
function currentRacer(s:GameState){return s.racers.find(r=>r.id===s.turnRacerId&&!r.finished&&!r.eliminated);}
function racerById(s:GameState,id:string){return s.racers.find(r=>r.id===id);}
function playerFor(s:GameState,r:RacerState){return playerById(s,r.playerId);}
function playerById(s:GameState,id:string){return s.players.find(p=>p.id===id)!;}
function nameOf(s:GameState,id:string){return playerById(s,id)?.name??'未知选手';}
function racerNameOf(s:GameState,r:RacerState,locale:'zh'|'en'='zh'){return `${nameOf(s,r.playerId)} · ${locale==='zh'?RACER_BY_ID[r.racerId].nameZh:RACER_BY_ID[r.racerId].name}`;}
function turnKey(s:GameState,r:RacerState){return `genius:${s.raceNumber}:${r.id}`;}
function nextActivePlayer(s:GameState,from:string){const idx=s.turnOrder.indexOf(from); for(let i=1;i<=s.turnOrder.length;i++){const id=s.turnOrder[(idx+i)%s.turnOrder.length];if(activeRacers(s).some(r=>r.playerId===id))return id;}return from;}
function finishRacerByPlace(s:GameState,place:number){const id=s.finishers[place];return id?racerById(s,id):undefined;}
export function racersPerPlayer(s:Pick<GameState,'players'>){return s.players.length===2?2:1;}
export function selectionComplete(s:Pick<GameState,'players'|'selected'|'selectedSecond'>,playerId:string){return Boolean(s.selected[playerId]&&(racersPerPlayer(s)===1||s.selectedSecond[playerId]));}
function draftRoundLength(s:GameState){return s.players.length===2?8:s.players.length*2;}
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
function addLog(s:GameState,text:string,tone:'normal'|'power'|'score'|'warning'='normal',textEn=text,meta:Pick<LogEntry,'sourceRacerId'|'targetRacerId'|'effectKind'|'modifier'>={}){s.logs.push({id:s.nextLogId++,text,textEn,tone,...meta});if(s.logs.length>80)s.logs.shift();}
function clone<T>(v:T):T{return structuredClone(v);}

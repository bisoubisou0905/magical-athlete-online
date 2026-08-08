import { describe, expect, it } from 'vitest';
import { addPlayer, applyAction, createGame, currentDrafter } from './engine';
import { RACERS } from './racers';
import type { GameState } from './types';

function fourPlayerGame(seed=42){
  let s=createGame('TEST42','p1','甲',seed);
  s=addPlayer(s,'p2','乙');s=addPlayer(s,'p3','丙');s=addPlayer(s,'p4','丁');
  return s;
}

function finishDraft(s:GameState){
  s=applyAction(s,'p1',{type:'START_GAME'});
  while(s.phase==='draft')s=applyAction(s,currentDrafter(s)!,{type:'DRAFT',racerId:s.draftPool[0]});
  return s;
}

function chooseRacers(s:GameState){
  for(const p of s.players){const id=p.hand.find(x=>!p.used.includes(x))!;s=applyAction(s,p.id,{type:'SELECT_RACER',racerId:id});}
  return s;
}

function seedForRoll(target:number){
  for(let seed=1;seed<10000;seed++)if((((Math.imul(seed,1664525)+1013904223)>>>0)%6)+1===target)return seed;
  throw new Error('seed not found');
}

function raceState(ids:string[],positions:number[]=[]){
  let s=createGame('RULES','p1','甲',1);
  for(let i=1;i<ids.length;i++)s=addPlayer(s,`p${i+1}`,String.fromCharCode(30002+i));
  s.phase='race';s.track='mild';s.turnOrder=s.players.map(p=>p.id);s.turnPlayerId='p1';s.raceNumber=0;
  s.racers=ids.map((racerId,i)=>({playerId:`p${i+1}`,racerId,position:positions[i]??0,tripped:false,finished:null,eliminated:false,lastTurnStart:positions[i]??0,firstTurn:true,rerolls:0,dicemongerUsed:false}));
  return s;
}

describe('Magical Athlete rules engine',()=>{
  it('contains all 36 unique racers from the rulebook',()=>{
    expect(RACERS).toHaveLength(36);
    expect(new Set(RACERS.map(r=>r.id)).size).toBe(36);
  });

  it('runs two snake drafts and gives every player four racers',()=>{
    const s=finishDraft(fourPlayerGame());
    expect(s.phase).toBe('select');
    expect(s.players.map(p=>p.hand.length)).toEqual([4,4,4,4]);
    expect(new Set(s.players.flatMap(p=>p.hand)).size).toBe(16);
  });

  it.each([2,3,4])('supports a dynamic %i-player room',count=>{
    let s=createGame(`ROOM${count}`,'p1','选手1',100+count);
    for(let i=2;i<=count;i++)s=addPlayer(s,`p${i}`,`选手${i}`);
    s=applyAction(s,'p1',{type:'START_GAME'});
    expect(s.phase).toBe('draft');
    expect(s.draftIndex).toBe(0);
    expect(s.players.every(p=>p.hand.length===0)).toBe(true);
    expect(s.draftOrder).toHaveLength(count*4);
    expect(s.draftPool).toHaveLength(count*2);
    expect(s.draftDeck).toHaveLength(count*2);
    const firstGroup=new Set(s.draftPool);
    for(let pick=0;pick<count*2;pick++)s=applyAction(s,currentDrafter(s)!,{type:'DRAFT',racerId:s.draftPool[0]});
    expect(s.draftRound).toBe(1);
    expect(s.draftPool).toHaveLength(count*2);
    expect(s.draftPool.every(id=>!firstGroup.has(id))).toBe(true);
    while(s.phase==='draft')s=applyAction(s,currentDrafter(s)!,{type:'DRAFT',racerId:s.draftPool[0]});
    expect(s.players.every(p=>p.hand.length===4)).toBe(true);
  });

  it('does not trigger roll powers from a roll that Magician rerolls',()=>{
    let s=raceState(['magician','inchworm']);
    s.rngSeed=seedForRoll(1);
    s=applyAction(s,'p1',{type:'ROLL'});
    expect(s.pendingDecision?.kind).toBe('magician-reroll');
    expect(s.racers[1].position).toBe(0);
    expect(s.skippedTurns['roll:p1']).toBeUndefined();
  });

  it('lets Sisyphus continue the main move after warping on a 6',()=>{
    let s=raceState(['sisyphus','coach'],[10,2]);
    s.players[0].score=4;s.rngSeed=seedForRoll(6);
    s=applyAction(s,'p1',{type:'ROLL'});
    expect(s.racers[0].position).toBe(6);
    expect(s.players[0].score).toBe(3);
  });

  it('allows Mastermind to win both first and second by predicting itself',()=>{
    let s=raceState(['mastermind','coach'],[29,0]);
    s.rngSeed=seedForRoll(1);
    s=applyAction(s,'p1',{type:'ROLL'});
    s=applyAction(s,'p1',{type:'DECIDE',value:'p1'});
    expect(s.phase).toBe('raceResult');
    expect(s.finishers).toEqual(['p1','p1']);
    expect(s.players[0].score).toBe(6);
  });

  it('does not deadlock when M.O.U.T.H. eliminates the only other racer',()=>{
    let s=raceState(['mouth','coach'],[4,5]);
    s.rngSeed=seedForRoll(1);
    s=applyAction(s,'p1',{type:'ROLL'});
    expect(s.phase).toBe('race');
    expect(s.racers[1].eliminated).toBe(true);
    let guard=0;
    while(s.phase==='race'&&guard++<40)s=applyAction(s,'p1',{type:'ROLL'});
    expect(s.phase).toBe('raceResult');
    expect(s.finishers).toEqual(['p1']);
  });

  it('simulates four complete races without divergent or invalid state',()=>{
    let s=finishDraft(fourPlayerGame(91234));
    let actions=0;
    while(s.phase!=='gameOver'&&actions<5000){
      actions++;
      if(s.phase==='select'){s=chooseRacers(s);continue;}
      if(s.phase==='raceResult'){s=applyAction(s,s.hostId,{type:'CONTINUE'});continue;}
      if(s.phase==='race'){
        const id=s.turnPlayerId!;
        if(s.pendingDecision){
          const keep=s.pendingDecision.options.find(o=>o.value==='keep'||o.value==='normal');
          s=applyAction(s,id,{type:'DECIDE',value:(keep??s.pendingDecision.options[0]).value});
        }else s=applyAction(s,id,{type:'ROLL'});
      }
    }
    expect(actions).toBeLessThan(5000);
    expect(s.phase).toBe('gameOver');
    expect(s.raceNumber).toBe(4);
    expect(s.players.every(p=>p.used.length===4)).toBe(true);
    expect(s.players.every(p=>Number.isFinite(p.score)&&p.score>=0)).toBe(true);
  });

  it('finishes complete games across many deterministic seeds',()=>{
    for(let seed=1;seed<=12;seed++){
      let s=finishDraft(fourPlayerGame(seed));let actions=0;
      while(s.phase!=='gameOver'&&actions++<5000){
        if(s.phase==='select'){s=chooseRacers(s);continue;}
        if(s.phase==='raceResult'){s=applyAction(s,s.hostId,{type:'CONTINUE'});continue;}
        const id=s.turnPlayerId!;
        if(s.pendingDecision){const fallback=s.pendingDecision.options.find(o=>['keep','normal'].includes(o.value))??s.pendingDecision.options[0];s=applyAction(s,id,{type:'DECIDE',value:fallback.value});}
        else s=applyAction(s,id,{type:'ROLL'});
      }
      expect(s.phase,`seed ${seed}`).toBe('gameOver');
    }
  },30000);
});

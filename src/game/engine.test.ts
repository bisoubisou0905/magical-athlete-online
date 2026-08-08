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
    expect(s.draftPool).toHaveLength(count*4);
    while(s.phase==='draft')s=applyAction(s,currentDrafter(s)!,{type:'DRAFT',racerId:s.draftPool[0]});
    expect(s.players.every(p=>p.hand.length===4)).toBe(true);
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
});

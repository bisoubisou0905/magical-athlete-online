import { describe, expect, it } from 'vitest';
import { addPlayer, applyAction, createGame, currentDrafter } from '../game/engine';
import { projectView } from './session';

describe('network projections',()=>{
  it('hides other players simultaneous racer selections',()=>{
    let s=createGame('ROOM42','a','A',7);s=addPlayer(s,'b','B');s=addPlayer(s,'c','C');s=addPlayer(s,'d','D');
    s=applyAction(s,'a',{type:'START_GAME'});
    while(s.phase==='draft')s=applyAction(s,currentDrafter(s)!,{type:'DRAFT',racerId:s.draftPool[0]});
    s=applyAction(s,'a',{type:'SELECT_RACER',racerId:s.players[0].hand[0]});
    const b=projectView(s,'b');
    expect(b.selected.a).toBe('hidden');
    expect(b.selected.b).toBe(null);
  });
});

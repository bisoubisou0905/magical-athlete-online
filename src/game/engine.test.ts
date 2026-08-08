import { describe, expect, it } from 'vitest';
import { WILD_ARROWS, WILD_ROCKS, WILD_STARS, addPlayer, applyAction, availableSpecials, createGame, currentDrafter, getFinishChance, getRacerPowerId } from './engine';
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
  for(const p of s.players){
    const needed=s.players.length===2?2:1;
    for(let i=0;i<needed;i++){const id=p.hand.find(x=>!p.used.includes(x)&&x!==s.selected[p.id])!;s=applyAction(s,p.id,{type:'SELECT_RACER',racerId:id});}
  }
  return s;
}

function acknowledgePresentation(s:GameState){return s.presentationGate?applyAction(s,s.presentationGate.playerId,{type:'ACK_PRESENTATION',id:s.presentationGate.id}):s;}

function seedForRoll(target:number){
  for(let seed=1;seed<10000;seed++)if((((Math.imul(seed,1664525)+1013904223)>>>0)%6)+1===target)return seed;
  throw new Error('seed not found');
}

function raceState(ids:string[],positions:number[]=[]){
  let s=createGame('RULES','p1','甲',1);
  for(let i=1;i<ids.length;i++)s=addPlayer(s,`p${i+1}`,String.fromCharCode(30002+i));
  s.phase='race';s.track='mild';s.turnOrder=s.players.map(p=>p.id);s.turnPlayerId='p1';s.turnRacerId='p1:0';s.raceNumber=0;
  s.racers=ids.map((racerId,i)=>({id:`p${i+1}:0`,playerId:`p${i+1}`,racerId,position:positions[i]??0,tripped:false,finished:null,eliminated:false,lastTurnStart:positions[i]??0,firstTurn:true,rerolls:0,dicemongerUsed:false}));
  return s;
}

function beginConfiguredTurn(s:GameState,racerId='p1:0'){
  const racer=s.racers.find(r=>r.id===racerId)!;
  s.turnPlayerId=racer.playerId;s.turnRacerId=null;
  s.pendingDecision={playerId:racer.playerId,kind:'two-player-order',prompt:'测试行动顺序',promptEn:'Test turn order',options:[{value:racer.id,label:'先行动',labelEn:'Act first'}],optional:false};
  return applyAction(s,racer.playerId,{type:'DECIDE',value:racer.id});
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
    const faceUp=count===2?8:count*2;
    const handSize=count===2?8:4;
    expect(s.draftOrder).toHaveLength(faceUp*2);
    expect(s.draftPool).toHaveLength(faceUp);
    expect(s.draftDeck).toHaveLength(faceUp);
    const firstGroup=new Set(s.draftPool);
    for(let pick=0;pick<faceUp;pick++)s=applyAction(s,currentDrafter(s)!,{type:'DRAFT',racerId:s.draftPool[0]});
    expect(s.draftRound).toBe(1);
    expect(s.draftPool).toHaveLength(faceUp);
    expect(s.draftPool.every(id=>!firstGroup.has(id))).toBe(true);
    while(s.phase==='draft')s=applyAction(s,currentDrafter(s)!,{type:'DRAFT',racerId:s.draftPool[0]});
    expect(s.players.every(p=>p.hand.length===handSize)).toBe(true);
  });

  it('uses the official two-player double-racer flow',()=>{
    let s=createGame('DUAL22','p1','甲',2244);
    s=addPlayer(s,'p2','乙');
    s=finishDraft(s);
    expect(s.players.map(p=>p.hand.length)).toEqual([8,8]);
    const setupRacers=new Set(['egg','twin']);
    for(const p of s.players){
      const choices=p.hand.filter(id=>!setupRacers.has(id)).slice(0,2);
      for(const racerId of choices)s=applyAction(s,p.id,{type:'SELECT_RACER',racerId});
    }
    expect(s.phase).toBe('race');
    expect(s.racers).toHaveLength(4);
    expect(s.players.map(p=>s.racers.filter(r=>r.playerId===p.id).length)).toEqual([2,2]);
    expect(s.players.map(p=>p.used.length)).toEqual([2,2]);
    expect(s.pendingDecision?.kind).toBe('two-player-order');
    const owner=s.pendingDecision!.playerId;
    const first=s.pendingDecision!.options[0].value;
    s=applyAction(s,owner,{type:'DECIDE',value:first});
    expect(s.turnRacerId).toBe(first);
    expect(s.turnRacerQueue).toHaveLength(1);
  });

  it('matches every special space on the supplied Wild Wilds board',()=>{
    expect([...WILD_STARS]).toEqual([1,13]);
    expect([...WILD_ROCKS]).toEqual([5,17,26]);
    expect(WILD_ARROWS).toEqual({7:3,11:1,16:-4,23:2,24:-2});
  });

  it('resolves every printed star, rock and arrow space exactly',()=>{
    for(const star of WILD_STARS){
      let s=raceState(['banana','coach'],[star-1,29]);s.track='wild';s.rngSeed=seedForRoll(1);
      s=applyAction(s,'p1',{type:'ROLL'});
      expect(s.racers[0].position,`star ${star}`).toBe(star);
      expect(s.players[0].score,`star ${star}`).toBe(1);
    }
    for(const rock of WILD_ROCKS){
      let s=raceState(['banana','coach'],[rock-1,29]);s.track='wild';s.rngSeed=seedForRoll(1);
      s=applyAction(s,'p1',{type:'ROLL'});
      expect(s.racers[0],`rock ${rock}`).toMatchObject({position:rock,tripped:true});
    }
    for(const [space,arrow] of Object.entries(WILD_ARROWS)){
      const index=Number(space);let s=raceState(['banana','coach'],[index-1,29]);s.track='wild';s.rngSeed=seedForRoll(1);
      s=applyAction(s,'p1',{type:'ROLL'});
      expect(s.racers[0].position,`arrow ${space}`).toBe(index+arrow);
      expect(s.logs).toContainEqual(expect.objectContaining({sourceRacerId:'p1:0',effectKind:'track'}));
    }
  });

  it('treats an arrow as a separate move that can pass Banana',()=>{
    let s=raceState(['egg','banana'],[6,8]);
    s.track='wild';s.rngSeed=seedForRoll(1);
    s=applyAction(s,'p1',{type:'ROLL'});
    expect(s.racers[0].position).toBe(10);
    expect(s.racers[0].tripped).toBe(true);
    expect(s.logs).toEqual(expect.arrayContaining([
      expect.objectContaining({sourceRacerId:'p1:0',effectKind:'track'}),
      expect.objectContaining({sourceRacerId:'p2:0',effectKind:'ability'})
    ]));
  });

  it('changes Blimp at the second corner printed on the supplied board',()=>{
    let before=raceState(['blimp','coach'],[14,0]);
    before.rngSeed=seedForRoll(1);
    before=applyAction(before,'p1',{type:'ROLL'});
    expect(before.racers[0].position).toBe(18);
    expect(before.logs).toContainEqual(expect.objectContaining({sourceRacerId:'p1:0',effectKind:'ability',text:expect.stringContaining('+3')}));

    let onCorner=raceState(['blimp','coach'],[15,0]);
    onCorner.rngSeed=seedForRoll(1);
    onCorner=applyAction(onCorner,'p1',{type:'ROLL'});
    expect(onCorner.racers[0].position).toBe(15);
  });

  it('forecasts only die results that can actually cross or exactly reach the finish',()=>{
    const plain=raceState(['coach','banana'],[24,10]);
    expect(getFinishChance(plain)).toMatchObject({possible:true,successfulRolls:[5,6],exact:false});

    const tooFar=raceState(['banana','coach'],[23,10]);
    expect(getFinishChance(tooFar).possible).toBe(false);

    const strict=raceState(['banana','stickler'],[25,10]);
    expect(getFinishChance(strict)).toMatchObject({possible:true,successfulRolls:[5],exact:true});

    const blimp=raceState(['blimp','coach'],[25,10]);
    expect(getFinishChance(blimp)).toMatchObject({possible:true,successfulRolls:[6]});

    const rocket=raceState(['rocket-scientist','coach'],[18,10]);
    expect(getFinishChance(rocket)).toMatchObject({possible:true,successfulRolls:[6]});

    const sisyphus=raceState(['sisyphus','coach'],[25,10]);
    expect(getFinishChance(sisyphus)).toMatchObject({possible:true,successfulRolls:[5]});
  });

  it('preserves the second owned racer when Skipper interrupts a two-player turn',()=>{
    let s=createGame('SKIP22','p1','甲',1);
    s=addPlayer(s,'p2','乙');
    s.phase='race';s.track='mild';s.turnOrder=['p1','p2'];s.turnPlayerId='p1';s.turnRacerId='p1:0';s.turnRacerQueue=['p1:1'];
    s.racers=[
      {id:'p1:0',playerId:'p1',racerId:'coach',position:0,tripped:false,finished:null,eliminated:false,lastTurnStart:0,firstTurn:true,rerolls:0,dicemongerUsed:false},
      {id:'p1:1',playerId:'p1',racerId:'alchemist',position:0,tripped:false,finished:null,eliminated:false,lastTurnStart:0,firstTurn:true,rerolls:0,dicemongerUsed:false},
      {id:'p2:0',playerId:'p2',racerId:'skipper',position:0,tripped:false,finished:null,eliminated:false,lastTurnStart:0,firstTurn:true,rerolls:0,dicemongerUsed:false},
      {id:'p2:1',playerId:'p2',racerId:'banana',position:0,tripped:false,finished:null,eliminated:false,lastTurnStart:0,firstTurn:true,rerolls:0,dicemongerUsed:false}
    ];
    s.rngSeed=seedForRoll(1);
    s=applyAction(s,'p1',{type:'ROLL'});
    expect(s.turnRacerId).toBe('p2:0');
    expect(s.turnRacerQueue).toEqual(['p1:1']);
    s=acknowledgePresentation(s);
    s.rngSeed=seedForRoll(2);
    s=applyAction(s,'p2',{type:'ROLL'});
    expect(s.turnPlayerId).toBe('p1');
    expect(s.turnRacerId).toBe('p1:1');
  });

  it('does not trigger roll powers from a roll that Magician rerolls',()=>{
    let s=raceState(['magician','inchworm']);
    s.rngSeed=seedForRoll(1);
    s=applyAction(s,'p1',{type:'ROLL'});
    expect(s.pendingDecision?.kind).toBe('magician-reroll');
    expect(s.racers[1].position).toBe(0);
    expect(s.skippedTurns['roll:p1']).toBeUndefined();
  });

  it('ends Sisyphus main move after a 6 warps it to Start',()=>{
    let s=raceState(['sisyphus','coach'],[10,2]);
    s.players[0].score=4;s.rngSeed=seedForRoll(6);
    s=applyAction(s,'p1',{type:'ROLL'});
    expect(s.racers[0].position).toBe(0);
    expect(s.players[0].score).toBe(3);
    expect(s.presentationGate).toMatchObject({kind:'warp',racerId:'p1:0',from:10,to:0});
  });

  it('allows Mastermind to win both first and second by predicting itself',()=>{
    let s=raceState(['mastermind','coach'],[29,0]);
    s.rngSeed=seedForRoll(1);
    s=applyAction(s,'p1',{type:'ROLL'});
    s=applyAction(s,'p1',{type:'DECIDE',value:'p1:0'});
    expect(s.phase).toBe('raceResult');
    expect(s.finishers).toEqual(['p1:0','p1:0']);
    expect(s.players[0].score).toBe(6);
  });

  it('does not deadlock when M.O.U.T.H. eliminates the only other racer',()=>{
    let s=raceState(['mouth','coach'],[4,5]);
    s.rngSeed=seedForRoll(1);
    s=applyAction(s,'p1',{type:'ROLL'});
    expect(s.phase).toBe('raceResult');
    expect(s.racers[1].eliminated).toBe(true);
    expect(s.finishers).toEqual(['p1:0']);
  });

  it('waits for the roller to push their piece before the next player can act',()=>{
    let s=raceState(['coach','banana'],[0,10]);s.rngSeed=seedForRoll(2);
    s=applyAction(s,'p1',{type:'ROLL'});
    expect(s.presentationGate).toMatchObject({kind:'move',playerId:'p1',racerId:'p1:0',from:0,to:3});
    const blocked=applyAction(s,'p2',{type:'ROLL'});
    expect(blocked.rollSeq).toBe(s.rollSeq);
    s=acknowledgePresentation(s);
    expect(s.presentationGate).toBeNull();
  });

  it('trips on the supplied rock, then waits for the owner to stand up and skip the move',()=>{
    let s=raceState(['banana','coach'],[4,0]);s.track='wild';s.rngSeed=seedForRoll(1);
    s=applyAction(s,'p1',{type:'ROLL'});
    expect(s.racers[0]).toMatchObject({position:5,tripped:true});
    expect(s.logs).toContainEqual(expect.objectContaining({targetRacerId:'p1:0',effectKind:'track'}));
    s=acknowledgePresentation(s);s.rngSeed=seedForRoll(1);s=applyAction(s,'p2',{type:'ROLL'});s=acknowledgePresentation(s);
    expect(s.pendingDecision).toMatchObject({playerId:'p1',kind:'recover-trip'});
    s=applyAction(s,'p1',{type:'DECIDE',value:'recover'});
    expect(s.racers[0].tripped).toBe(false);
    expect(s.turnPlayerId).toBe('p2');
  });

  it('applies Alchemist, Coach, Gunk, Hare and Legs main-move modifiers',()=>{
    let alchemist=raceState(['alchemist','banana']);alchemist.rngSeed=seedForRoll(1);
    alchemist=applyAction(alchemist,'p1',{type:'ROLL'});
    expect(alchemist.pendingDecision?.kind).toBe('alchemist-four');
    alchemist=applyAction(alchemist,'p1',{type:'DECIDE',value:'four'});
    expect(alchemist.racers[0].position).toBe(4);

    let coach=raceState(['coach','banana'],[0,0]);coach.rngSeed=seedForRoll(2);
    coach=applyAction(coach,'p1',{type:'ROLL'});
    expect(coach.racers[0].position).toBe(3);

    let gunk=raceState(['banana','gunk'],[0,8]);gunk.rngSeed=seedForRoll(3);
    gunk=applyAction(gunk,'p1',{type:'ROLL'});
    expect(gunk.racers[0].position).toBe(2);

    let hare=raceState(['hare','banana'],[0,0]);hare.rngSeed=seedForRoll(1);
    hare=applyAction(hare,'p1',{type:'ROLL'});
    expect(hare.racers[0].position).toBe(3);

    let proudHare=beginConfiguredTurn(raceState(['hare','banana'],[5,0]));
    expect(proudHare.racers[0].position).toBe(5);
    expect(proudHare.turnPlayerId).toBe('p2');

    let coachedLegs=raceState(['legs','coach'],[0,0]);
    expect(availableSpecials(coachedLegs,'p1').map(x=>x.kind)).toContain('rocket-double');
    coachedLegs=applyAction(coachedLegs,'p1',{type:'USE_SPECIAL',kind:'rocket-double'});
    expect(coachedLegs.racers[0].position).toBe(6);

    let goopedLegs=raceState(['legs','gunk'],[0,8]);
    goopedLegs=applyAction(goopedLegs,'p1',{type:'USE_SPECIAL',kind:'rocket-double'});
    expect(goopedLegs.racers[0].position).toBe(4);
  });

  it('resolves Baba Yaga, Centaur, Huge Baby, Leaptoad and Banana interactions',()=>{
    let visitor=raceState(['banana','baba-yaga'],[4,5]);visitor.rngSeed=seedForRoll(1);
    visitor=applyAction(visitor,'p1',{type:'ROLL'});
    expect(visitor.racers[0].tripped).toBe(true);

    let baba=raceState(['baba-yaga','banana'],[4,5]);baba.rngSeed=seedForRoll(1);
    baba=applyAction(baba,'p1',{type:'ROLL'});
    expect(baba.racers[1].tripped).toBe(true);

    let centaur=raceState(['centaur','banana'],[0,2]);centaur.rngSeed=seedForRoll(3);
    centaur=applyAction(centaur,'p1',{type:'ROLL'});
    expect(centaur.racers[1].position).toBe(0);

    let huge=raceState(['huge-baby','banana'],[4,5]);huge.rngSeed=seedForRoll(1);
    huge=applyAction(huge,'p1',{type:'ROLL'});
    expect(huge.racers[0]).toMatchObject({position:5,tripped:true});
    expect(huge.racers[1].position).toBe(4);

    let blocked=raceState(['banana','huge-baby'],[4,5]);blocked.rngSeed=seedForRoll(1);
    blocked=applyAction(blocked,'p1',{type:'ROLL'});
    expect(blocked.racers[0].position).toBe(4);

    let backward=raceState(['centaur','leaptoad','coach','scoocher'],[0,4,3,10]);backward.rngSeed=seedForRoll(5);
    backward=applyAction(backward,'p1',{type:'ROLL'});
    expect(backward.racers[1].position).toBe(1);
    expect(backward.racers[3].position).toBeGreaterThanOrEqual(13);
  });

  it('handles Duelist, Romantic, Suckerfish and M.O.U.T.H. stop effects',()=>{
    let duel=raceState(['banana','duelist'],[4,5]);duel.rngSeed=seedForRoll(1);
    duel=applyAction(duel,'p1',{type:'ROLL'});
    expect(duel.logs).toContainEqual(expect.objectContaining({text:expect.stringContaining('决斗')}));
    expect(Math.max(...duel.racers.map(r=>r.position))).toBeGreaterThanOrEqual(7);

    let romantic=raceState(['banana','coach','romantic'],[4,5,0]);romantic.rngSeed=seedForRoll(1);
    romantic=applyAction(romantic,'p1',{type:'ROLL'});
    expect(romantic.racers[2].position).toBe(2);

    let follower=raceState(['banana','suckerfish'],[0,0]);follower.rngSeed=seedForRoll(2);
    follower=applyAction(follower,'p1',{type:'ROLL'});
    expect(follower.racers.map(r=>r.position)).toEqual([2,2]);

    let finishTogether=raceState(['banana','suckerfish'],[29,29]);finishTogether.rngSeed=seedForRoll(1);
    finishTogether=applyAction(finishTogether,'p1',{type:'ROLL'});
    expect(finishTogether.phase).toBe('raceResult');
    expect(finishTogether.finishers).toEqual(['p1:0','p2:0']);
    expect(finishTogether.players.map(p=>p.score)).toEqual([4,2]);
  });

  it('runs Cheerleader, Hypnotist, Party Animal, Third Wheel and Lovable Loser at turn timing',()=>{
    let cheer=raceState(['cheerleader','banana','coach'],[5,0,0]);
    cheer=applyAction(cheer,'p1',{type:'USE_SPECIAL',kind:'cheerleader'});
    expect(cheer.racers.map(r=>r.position)).toEqual([6,2,2]);

    let hypnotist=raceState(['hypnotist','banana'],[4,10]);
    hypnotist=applyAction(hypnotist,'p1',{type:'USE_SPECIAL',kind:'hypnotist'});
    expect(hypnotist.pendingDecision?.kind).toBe('hypnotist');
    hypnotist=applyAction(hypnotist,'p1',{type:'DECIDE',value:'p2:0'});
    expect(hypnotist.racers[1].position).toBe(4);

    let flip=raceState(['flip-flop','banana'],[2,8]);
    flip=applyAction(flip,'p1',{type:'USE_SPECIAL',kind:'flip-flop'});
    flip=applyAction(flip,'p1',{type:'DECIDE',value:'p2:0'});
    expect(flip.racers.map(r=>r.position)).toEqual([8,2]);

    let party=beginConfiguredTurn(raceState(['party-animal','banana','coach'],[3,0,5]));
    expect(party.racers.map(r=>r.position)).toEqual([3,1,4]);

    let third=raceState(['third-wheel','banana','coach'],[0,5,5]);
    third=applyAction(third,'p1',{type:'USE_SPECIAL',kind:'third-wheel'});
    third=applyAction(third,'p1',{type:'DECIDE',value:'5'});
    expect(third.racers[0].position).toBe(5);
    expect(third.turnPlayerId).toBe('p1');

    let loser=beginConfiguredTurn(raceState(['lovable-loser','banana'],[0,5]));
    expect(loser.players[0].score).toBe(1);
  });

  it('handles Genius, Inchworm, Lackey, Rocket Scientist, Skipper and rerolls in trigger order',()=>{
    let genius=raceState(['genius','banana']);genius.rngSeed=seedForRoll(3);
    genius=applyAction(genius,'p1',{type:'ROLL'});
    genius=applyAction(genius,'p1',{type:'DECIDE',value:'3'});
    expect(genius.racers[0].position).toBe(3);
    expect(genius.turnPlayerId).toBe('p1');
    expect(genius.presentationGate).toMatchObject({from:0,to:3});

    let stolen=raceState(['genius','skipper','banana']);stolen.rngSeed=seedForRoll(1);
    stolen=applyAction(stolen,'p1',{type:'ROLL'});
    stolen=applyAction(stolen,'p1',{type:'DECIDE',value:'1'});
    expect(stolen.turnRacerId).toBe('p2:0');
    expect(stolen.skippedTurns.extraTurn).toBeUndefined();

    let worm=raceState(['banana','inchworm']);worm.rngSeed=seedForRoll(1);
    worm=applyAction(worm,'p1',{type:'ROLL'});
    expect(worm.racers.map(r=>r.position)).toEqual([0,1]);

    let lackey=raceState(['banana','lackey']);lackey.rngSeed=seedForRoll(6);
    lackey=applyAction(lackey,'p1',{type:'ROLL'});
    expect(lackey.racers.map(r=>r.position)).toEqual([6,2]);

    let heckler=raceState(['banana','heckler'],[0,8]);heckler.rngSeed=seedForRoll(1);
    heckler=applyAction(heckler,'p1',{type:'ROLL'});
    expect(heckler.racers.map(r=>r.position)).toEqual([1,10]);

    let rocket=raceState(['rocket-scientist','banana']);rocket.rngSeed=seedForRoll(3);
    rocket=applyAction(rocket,'p1',{type:'ROLL'});
    rocket=applyAction(rocket,'p1',{type:'DECIDE',value:'double'});
    expect(rocket.racers[0]).toMatchObject({position:6,tripped:true});

    let dice=raceState(['dicemonger','scoocher']);dice.rngSeed=seedForRoll(2);
    dice=applyAction(dice,'p1',{type:'ROLL'});
    dice=applyAction(dice,'p1',{type:'DECIDE',value:'reroll'});
    expect(dice.racers[1].position).toBeGreaterThanOrEqual(1);
  });

  it('lets Scoocher react to passive powers and Copycat choose between tied leaders',()=>{
    let scooch=raceState(['banana','gunk','scoocher'],[0,8,15]);scooch.rngSeed=seedForRoll(3);
    scooch=applyAction(scooch,'p1',{type:'ROLL'});
    expect(scooch.racers[2].position).toBe(16);

    let copy=beginConfiguredTurn(raceState(['copycat','hare','coach'],[0,5,5]));
    expect(copy.pendingDecision?.kind).toBe('copycat-leader');
    copy=applyAction(copy,'p1',{type:'DECIDE',value:'p2:0'});
    expect(getRacerPowerId(copy,copy.racers[0])).toBe('hare');
    copy.rngSeed=seedForRoll(1);copy=applyAction(copy,'p1',{type:'ROLL'});
    expect(copy.racers[0].position).toBe(3);
  });

  it('keeps Copycat dynamic when Egg or Twin copies its power',()=>{
    let copied=raceState(['egg','hare','coach'],[0,5,5]);
    copied.racers[0].powerOverride='copycat';
    copied=beginConfiguredTurn(copied);
    expect(copied.pendingDecision?.kind).toBe('copycat-leader');
    copied=applyAction(copied,'p1',{type:'DECIDE',value:'p2:0'});
    expect(getRacerPowerId(copied,copied.racers[0])).toBe('hare');
    copied.rngSeed=seedForRoll(1);copied=applyAction(copied,'p1',{type:'ROLL'});
    expect(copied.racers[0].position).toBe(3);
  });

  it('sets up Egg and optional Twin copied powers before the race',()=>{
    let egg=raceState(['egg','banana']);egg.prediction.setupQueue='[]';
    egg.pendingDecision={playerId:'p1',kind:'egg-copy',prompt:'复制',promptEn:'Copy',options:[{value:'sisyphus',label:'西西弗斯',labelEn:'Sisyphus'}],optional:false};
    egg=applyAction(egg,'p1',{type:'DECIDE',value:'sisyphus'});
    expect(getRacerPowerId(egg,egg.racers[0])).toBe('sisyphus');
    expect(egg.players[0].score).toBe(4);

    let twin=raceState(['twin','banana']);twin.winnersByRace=['hare'];twin.prediction.setupQueue='[]';
    twin.pendingDecision={playerId:'p1',kind:'twin-copy',prompt:'复制',promptEn:'Copy',options:[{value:'hare',label:'野兔',labelEn:'Hare'}],optional:true};
    twin=applyAction(twin,'p1',{type:'DECIDE',value:'hare'});
    expect(getRacerPowerId(twin,twin.racers[0])).toBe('hare');
  });

  it('has an explicit behavioral regression path for every one of the 36 racers',()=>{
    const covered=['alchemist','blimp','coach','baba-yaga','centaur','copycat','banana','cheerleader','dicemonger','duelist','genius','heckler','egg','gunk','huge-baby','flip-flop','hare','hypnotist','inchworm','legs','mastermind','lackey','lovable-loser','mouth','leaptoad','magician','party-animal','rocket-scientist','sisyphus','suckerfish','romantic','skipper','third-wheel','scoocher','stickler','twin'];
    expect(new Set(covered)).toEqual(new Set(RACERS.map(r=>r.id)));
  });

  it('stress-runs 60 complete 2–4 player games and exercises all 36 racers',()=>{
    const exercised=new Set<string>();
    for(const count of [2,3,4])for(let seed=1;seed<=20;seed++){
      let s=createGame(`STRESS${count}`,'p1','选手1',count*10000+seed);
      for(let i=2;i<=count;i++)s=addPlayer(s,`p${i}`,`选手${i}`);
      s=finishDraft(s);let actions=0;
      while(s.phase!=='gameOver'&&actions++<12000){
        expect(s.players.every(p=>Number.isFinite(p.score)&&p.score>=0)).toBe(true);
        expect(s.racers.every(r=>Number.isFinite(r.position)&&r.position>=0&&r.position<=30)).toBe(true);
        if(s.presentationGate){s=acknowledgePresentation(s);continue;}
        if(s.phase==='select'){s=chooseRacers(s);continue;}
        if(s.phase==='raceResult'){s=applyAction(s,s.hostId,{type:'CONTINUE'});continue;}
        const id=s.turnPlayerId!;
        if(s.pendingDecision){
          const fallback=s.pendingDecision.options.find(o=>['keep','normal','recover'].includes(o.value))??s.pendingDecision.options[0];
          s=applyAction(s,s.pendingDecision.playerId,{type:'DECIDE',value:fallback.value});
        }else s=applyAction(s,id,{type:'ROLL'});
      }
      expect(s.phase,`${count} players seed ${seed}; actions ${actions}; turn ${s.turnPlayerId}/${s.turnRacerId}; pending ${s.pendingDecision?.kind??'none'}; racers ${s.racers.map(r=>`${r.racerId}:${r.position}:${r.finished??'-'}:${r.eliminated?'X':'A'}`).join(',')}`).toBe('gameOver');
      expect(actions).toBeLessThan(12000);
      s.players.flatMap(p=>p.used).forEach(id=>exercised.add(id));
    }
    expect(exercised).toEqual(new Set(RACERS.map(r=>r.id)));
  },30000);

  it('simulates four complete races without divergent or invalid state',()=>{
    let s=finishDraft(fourPlayerGame(91234));
    let actions=0;
    while(s.phase!=='gameOver'&&actions<5000){
      actions++;
      if(s.presentationGate){s=acknowledgePresentation(s);continue;}
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
        if(s.presentationGate){s=acknowledgePresentation(s);continue;}
        if(s.phase==='select'){s=chooseRacers(s);continue;}
        if(s.phase==='raceResult'){s=applyAction(s,s.hostId,{type:'CONTINUE'});continue;}
        const id=s.turnPlayerId!;
        if(s.pendingDecision){const fallback=s.pendingDecision.options.find(o=>['keep','normal'].includes(o.value))??s.pendingDecision.options[0];s=applyAction(s,id,{type:'DECIDE',value:fallback.value});}
        else s=applyAction(s,id,{type:'ROLL'});
      }
      expect(s.phase,`seed ${seed}`).toBe('gameOver');
    }
  },30000);

  it('finishes the official two-player four-race format across deterministic seeds',()=>{
    for(let seed=31;seed<=36;seed++){
      let s=createGame('DUALRUN','p1','甲',seed);s=addPlayer(s,'p2','乙');s=finishDraft(s);let actions=0;
      while(s.phase!=='gameOver'&&actions++<10000){
        if(s.presentationGate){s=acknowledgePresentation(s);continue;}
        if(s.phase==='select'){s=chooseRacers(s);continue;}
        if(s.phase==='raceResult'){s=applyAction(s,s.hostId,{type:'CONTINUE'});continue;}
        const id=s.turnPlayerId!;
        if(s.pendingDecision){const fallback=s.pendingDecision.options.find(o=>['keep','normal'].includes(o.value))??s.pendingDecision.options[0];s=applyAction(s,id,{type:'DECIDE',value:fallback.value});}
        else s=applyAction(s,id,{type:'ROLL'});
      }
      expect(s.phase,`seed ${seed}`).toBe('gameOver');
      expect(s.players.map(p=>p.used.length)).toEqual([8,8]);
    }
  },30000);
});

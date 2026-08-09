import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../game/types';
import { compactRepeatedEffects, effectChainRoot, effectOccurrence, visibleEffectIndices } from './effectPresentation';

const entry=(id:number,sourceRacerId:string,targetRacerId?:string):LogEntry=>({
  id,
  text:`效果 ${id}`,
  textEn:`Effect ${id}`,
  effectKind:'ability',
  sourceRacerId,
  targetRacerId
});

describe('effect presentation model',()=>{
  it('counts repeated source-to-target triggers without merging different targets',()=>{
    const entries=[entry(1,'romantic','banana'),entry(2,'scoocher'),entry(3,'romantic','banana'),entry(4,'romantic','coach'),entry(5,'romantic','banana')];
    expect(effectOccurrence(entries,0)).toEqual({index:1,total:3});
    expect(effectOccurrence(entries,2)).toEqual({index:2,total:3});
    expect(effectOccurrence(entries,3)).toEqual({index:1,total:1});
    expect(effectOccurrence(entries,4)).toEqual({index:3,total:3});
  });

  it('keeps the current step centered in a bounded five-step trail',()=>{
    expect(visibleEffectIndices(9,0)).toEqual([0,1,2,3,4]);
    expect(visibleEffectIndices(9,4)).toEqual([2,3,4,5,6]);
    expect(visibleEffectIndices(9,8)).toEqual([4,5,6,7,8]);
    expect(visibleEffectIndices(3,1)).toEqual([0,1,2]);
  });

  it('preserves the first causal source as the chain root',()=>{
    expect(effectChainRoot([entry(1,'banana'),entry(2,'romantic','banana')])).toBe('banana');
    expect(effectChainRoot([])).toBeNull();
  });

  it('condenses a long repeated loop while preserving distinct causal steps',()=>{
    const same=(id:number,source:string,target?:string)=>({...entry(id,source,target),text:source,textEn:source});
    const loop=[same(1,'scoocher'),same(2,'suckerfish','scoocher'),same(3,'scoocher'),same(4,'suckerfish','scoocher'),same(5,'scoocher'),same(6,'suckerfish','scoocher')];
    const compact=compactRepeatedEffects(loop);
    expect(compact).toHaveLength(2);
    expect(compact.map(effect=>effect.repeatCount)).toEqual([3,3]);
    expect(compact.map(effect=>effect.sourceRacerId)).toEqual(['scoocher','suckerfish']);
  });
});

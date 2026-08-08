export class FinishDramaAudio {
  private context:AudioContext|null=null;
  private master:GainNode|null=null;

  constructor(private enabled=true){}

  setEnabled(enabled:boolean){
    this.enabled=enabled;
    if(this.master&&this.context){
      const now=this.context.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(enabled ? .9 : 0,now,.025);
    }
  }

  async unlock(){
    if(!this.enabled)return false;
    if(!this.context){
      this.context=new AudioContext();
      this.master=this.context.createGain();
      this.master.gain.value=.9;
      this.master.connect(this.context.destination);
    }
    if(this.context.state==='suspended')await this.context.resume();
    return this.context.state==='running';
  }

  play(outcome:'success'|'chance'|'miss'){
    const context=this.context;
    if(!this.enabled||!context||context.state!=='running'||!this.master)return;
    const at=context.currentTime+.04;

    // Soft double heartbeats keep the suspense physical without becoming loud.
    [0,.42,.86,1.25,1.58].forEach((offset,index)=>{
      this.tone(at+offset,66+index*4,.07,.13,'sine',-10);
      this.tone(at+offset+.13,58+index*3,.045,.1,'sine',-8);
    });
    // A rising toy-like arpeggio matches the game's colorful tabletop material.
    [196,233,277,330,392].forEach((frequency,index)=>this.tone(at+.18+index*.32,frequency,.032,.28,index%2?'triangle':'sine',18));

    if(outcome==='success'){
      [523.25,659.25,783.99].forEach((frequency,index)=>this.tone(at+1.78+index*.035,frequency,.052,.58,'triangle',12));
      this.tone(at+2.02,1046.5,.035,.4,'sine',22);
    }else if(outcome==='chance'){
      this.tone(at+1.78,440,.045,.4,'triangle',8);
      this.tone(at+1.95,659.25,.04,.5,'sine',14);
    }else{
      this.tone(at+1.78,329.63,.045,.42,'triangle',-15);
      this.tone(at+1.98,246.94,.038,.48,'sine',-20);
    }
  }

  private tone(at:number,frequency:number,volume:number,duration:number,type:OscillatorType,detune=0){
    const context=this.context;if(!context||!this.master)return;
    const oscillator=context.createOscillator();
    const gain=context.createGain();
    oscillator.type=type;oscillator.frequency.setValueAtTime(frequency,at);oscillator.detune.setValueAtTime(detune,at);
    gain.gain.setValueAtTime(.0001,at);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0001,volume),at+.025);
    gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
    oscillator.connect(gain);gain.connect(this.master);
    oscillator.start(at);oscillator.stop(at+duration+.04);
  }
}

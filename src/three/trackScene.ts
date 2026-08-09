import * as THREE from 'three';
import type { GameView, TrackKind } from '../game/types';
import { TRACK_LENGTH } from '../game/engine';
import type { Locale } from '../ui/render';

export interface TrackSceneHandlers {
  onRacerTap?:(racerStateId:string)=>void;
  onSpaceLongPress?:(space:number)=>void;
  onCameraViewChange?:(moved:boolean)=>void;
}

export class TrackScene {
  private scene=new THREE.Scene();
  private camera=new THREE.OrthographicCamera(-12,12,8,-8,0.1,100);
  private renderer:THREE.WebGLRenderer;
  private root=new THREE.Group();
  private tokens=new Map<string,THREE.Group>();
  private locatorLines=new Map<string,THREE.Group>();
  private modifierLogIds=new Set<number>();
  private modifierBursts:Array<{sprite:THREE.Sprite;racerId:string;startsAt:number;expiresAt:number;stack:number}>=[];
  private modifiersInitialized=false;
  private textureLoader=new THREE.TextureLoader();
  private boardArtwork:THREE.Mesh|null=null;
  private trackKind:TrackKind|null=null;
  private locale:Locale;
  private positions:THREE.Vector3[]=[];
  private raf=0;
  private animationEndsAt=0;
  private fpsSampleStarted=performance.now();
  private fpsFrames=0;
  private cameraTarget=new THREE.Vector3();
  private effectFocusRacerId:string|null=null;
  private interactionFocusRacerId:string|null=null;
  private mobileView=false;
  private mobileTokenScale=1;
  private raycaster=new THREE.Raycaster();
  private pointer=new THREE.Vector2();
  private pointerStart:{id:number;x:number;y:number;lastX:number;lastY:number}|null=null;
  private activePointers=new Map<number,{x:number;y:number}>();
  private pointerDragged=false;
  private pinchStartDistance=0;
  private pinchStartZoom=1;
  private pinching=false;
  private manualCameraTarget=new THREE.Vector3();
  private manualCameraZoom=1;
  private manualCameraMoved=false;
  private lastEmptyTapAt=0;
  private lastEmptyTap={x:0,y:0};
  private longPressTimer:number|undefined;
  private longPressFired=false;

  constructor(private canvas:HTMLCanvasElement,locale:Locale='zh',private handlers:TrackSceneHandlers={}){
    this.locale=locale;
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=1.12;
    this.renderer.shadowMap.enabled=true; this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.scene.background=new THREE.Color(0x17131c);
    this.scene.fog=new THREE.Fog(0x17131c,26,46);
    this.camera.position.set(16,18,20); this.camera.lookAt(0,0,0);
    this.scene.add(this.root);
    const hemi=new THREE.HemisphereLight(0xfff4d8,0x281b4e,2.1);this.scene.add(hemi);
    const sun=new THREE.DirectionalLight(0xffffff,2.4);sun.position.set(-8,14,8);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);this.scene.add(sun);
    this.buildArena();
    this.positions=this.makePositions();
    this.resize(); addEventListener('resize',this.resize);
    canvas.addEventListener('pointerdown',this.onPointerDown);
    canvas.addEventListener('pointermove',this.onPointerMove);
    canvas.addEventListener('pointerup',this.onPointerUp);
    canvas.addEventListener('pointercancel',this.onPointerCancel);
    canvas.addEventListener('wheel',this.onWheel,{passive:false});
    this.animate();
  }

  update(view:GameView,locale:Locale=this.locale,presentedTurnRacerId?:string|null,effectRacerId?:string,effectTargetRacerId?:string,movementStartDelay=680,heldMovementRacerId?:string|null,heldMovementKind:'move'|'warp'|null=null){
    if(locale!==this.locale){this.locale=locale;this.trackKind=null;}
    if(view.track!==this.trackKind){this.trackKind=view.track;this.buildTrack(view.track);}
    const active=new Set<string>();
    view.racers.forEach((r,index)=>{
      active.add(r.id); let token=this.tokens.get(r.id);
      const owner=view.players.find(p=>p.id===r.playerId)!;
      const viewerOwned=r.playerId===view.viewerId;
      if(token?.userData.racerId!==r.racerId||token?.userData.locale!==this.locale||token?.userData.ownerName!==owner.name||token?.userData.viewerOwned!==viewerOwned){
        if(token){this.root.remove(token);this.disposeObject(token);const previousLocator=this.locatorLines.get(r.id);if(previousLocator){this.root.remove(previousLocator);this.disposeObject(previousLocator);this.locatorLines.delete(r.id);}}
        token=this.makeToken(owner.color,r.racerId,owner.name,viewerOwned);this.tokens.set(r.id,token);this.root.add(token);
        const locator=this.makeLocator(owner.color);this.locatorLines.set(r.id,locator);this.root.add(locator);
        const initial=this.positions[Math.min(r.position,TRACK_LENGTH)].clone();initial.y=.24+index*.025;token.position.copy(initial);token.userData.logicalPosition=r.position;
      }
      token.visible=!r.eliminated;
      token.userData.racerStateId=r.id;
      const base=this.positions[Math.min(r.position,TRACK_LENGTH)];
      const same=view.racers.filter(x=>!x.eliminated&&x.position===r.position);const slot=same.findIndex(x=>x.id===r.id);
      const offset=this.sharedSpaceOffset(same.length,slot,r.position);
      const target=base.clone().add(new THREE.Vector3(offset.x,.24+index*.025+slot*.035,offset.y));
      const previous=token.userData.logicalPosition as number;
      if(previous!==r.position){
        const direction=Math.sign(r.position-previous);
        const queue:THREE.Vector3[]=[];
        const warp=heldMovementRacerId===r.id&&heldMovementKind==='warp';
        if(warp)queue.push(target.clone());
        else for(let position=previous+direction;direction>0?position<=r.position:position>=r.position;position+=direction){
          const pathPoint=this.positions[Math.min(Math.max(position,0),TRACK_LENGTH)].clone();pathPoint.y=.24+index*.025;queue.push(pathPoint);
        }
        token.userData.stepQueue=queue;
        token.userData.warpMove=warp;
        token.userData.stepTarget=undefined;
        const held=heldMovementRacerId===r.id;
        token.userData.moveStartsAt=held?Number.POSITIVE_INFINITY:performance.now()+(view.lastRollRacerId===r.id?movementStartDelay:120);
        token.userData.awaitingConfirmation=held;
        if(!held)this.animationEndsAt=Math.max(this.animationEndsAt,token.userData.moveStartsAt+queue.length*205+250+(r.tripped?760:0));
        token.userData.logicalPosition=r.position;
      }
      if(token.userData.awaitingConfirmation&&heldMovementRacerId!==r.id){
        token.userData.awaitingConfirmation=false;token.userData.moveStartsAt=performance.now()+90;
        const queue=token.userData.stepQueue as THREE.Vector3[]|undefined;
        this.animationEndsAt=Math.max(this.animationEndsAt,token.userData.moveStartsAt+(queue?.length??0)*205+250+(r.tripped?760:0));
      }
      const previousTripped=token.userData.tripped as boolean|undefined;
      if(previousTripped!==undefined&&previousTripped!==r.tripped){
        if(r.tripped){
          const queue=token.userData.stepQueue as THREE.Vector3[]|undefined;
          if(queue?.length||token.userData.stepTarget||token.userData.awaitingConfirmation)token.userData.pendingTrip=true;
          else{token.userData.tripStartedAt=performance.now();this.animationEndsAt=Math.max(this.animationEndsAt,performance.now()+760);}
        }else{token.userData.pendingTrip=false;token.userData.recoverStartedAt=performance.now();this.animationEndsAt=Math.max(this.animationEndsAt,performance.now()+680);}
      }
      token.userData.target=target;token.userData.tripped=r.tripped;token.userData.finished=r.finished;token.userData.clusterScale=this.sharedSpaceScale(same.length);
      token.userData.spaceCenter=base.clone();token.userData.clustered=same.length>1;token.userData.clusterAnchor=slot===0;
      const isTurn=(presentedTurnRacerId??view.turnRacerId)===r.id;
      const isEffect=effectRacerId===r.id||effectTargetRacerId===r.id;
      token.userData.focusRing.visible=isTurn||isEffect;
      token.userData.active=isTurn||isEffect;
      token.userData.effectFocus=isEffect;
      const focusMaterial=(token.userData.focusRing as THREE.Mesh).material as THREE.MeshBasicMaterial;
      focusMaterial.color.setHex(isEffect?0x55d5ee:0xffffff);
    });
    for(const [id,token] of this.tokens)if(!active.has(id)){this.root.remove(token);this.disposeObject(token);this.tokens.delete(id);const locator=this.locatorLines.get(id);if(locator){this.root.remove(locator);this.disposeObject(locator);this.locatorLines.delete(id);}}
    this.syncModifierBursts(view,movementStartDelay);
    this.effectFocusRacerId=effectTargetRacerId??effectRacerId??null;
    this.interactionFocusRacerId=heldMovementRacerId??null;
  }

  destroy(){
    cancelAnimationFrame(this.raf);removeEventListener('resize',this.resize);clearTimeout(this.longPressTimer);
    this.canvas.removeEventListener('pointerdown',this.onPointerDown);this.canvas.removeEventListener('pointermove',this.onPointerMove);this.canvas.removeEventListener('pointerup',this.onPointerUp);this.canvas.removeEventListener('pointercancel',this.onPointerCancel);this.canvas.removeEventListener('wheel',this.onWheel);
    for(const burst of this.modifierBursts){this.scene.remove(burst.sprite);this.disposeObject(burst.sprite);}this.modifierBursts=[];
    this.renderer.dispose();
  }
  resizeNow(){this.resize();}
  getPendingAnimationMs(){return Math.max(0,this.animationEndsAt-performance.now());}
  resetCameraView(){
    this.manualCameraTarget.set(0,0,0);this.manualCameraZoom=1;this.manualCameraMoved=false;
    this.handlers.onCameraViewChange?.(false);
  }

  private buildTrack(kind:TrackKind){
    for(const child of [...this.root.children])if(child.userData.track){this.root.remove(child);this.disposeObject(child);}
    const board=new THREE.Mesh(new THREE.BoxGeometry(23.4,.48,7.4),new THREE.MeshPhysicalMaterial({color:0x17131c,roughness:.62,clearcoat:.3,clearcoatRoughness:.55}));
    board.position.y=-.38;board.castShadow=true;board.receiveShadow=true;board.userData.track=true;this.root.add(board);
    const texture=this.textureLoader.load(`${import.meta.env.BASE_URL}tracks/${kind}-mile.webp`,()=>this.renderer.render(this.scene,this.camera));
    texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=this.renderer.capabilities.getMaxAnisotropy();texture.generateMipmaps=true;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;
    const artworkMaterial=new THREE.MeshBasicMaterial({map:texture,transparent:true,side:THREE.DoubleSide});
    artworkMaterial.toneMapped=false;
    const artwork=new THREE.Mesh(new THREE.PlaneGeometry(23.15,7.22),artworkMaterial);
    artwork.rotation.x=-Math.PI/2;artwork.position.y=-.125;artwork.receiveShadow=true;artwork.userData.track=true;this.root.add(artwork);this.boardArtwork=artwork;
  }

  private makePositions(){
    const pts=[
      [-8.85,2.34],[-5.86,2.34],[-4.46,2.34],[-3.06,2.34],[-1.66,2.34],[-.26,2.34],[1.14,2.34],[2.54,2.34],[3.94,2.34],[5.34,2.34],[6.74,2.34],[8.14,2.34],[9.48,2.34],
      [10.32,1.18],[10.32,.02],[10.18,-2.22],
      [8.42,-2.22],[7.02,-2.22],[5.62,-2.22],[4.22,-2.22],[2.82,-2.22],[1.42,-2.22],[.02,-2.22],[-1.38,-2.22],[-2.78,-2.22],[-4.18,-2.22],[-5.58,-2.22],[-6.98,-2.22],[-8.38,-2.22],[-9.72,-2.22],[-10.18,.02]
    ];
    return pts.map(([x,z])=>new THREE.Vector3(x,0,z));
  }

  private sharedSpaceOffset(count:number,slot:number,position:number){
    if(count<=1)return new THREE.Vector2();
    const current=this.positions[Math.min(position,TRACK_LENGTH)];
    const before=this.positions[Math.max(0,position-1)],after=this.positions[Math.min(TRACK_LENGTH,position+1)];
    const tangent=new THREE.Vector2(after.x-before.x,after.z-before.z).normalize();
    if(!Number.isFinite(tangent.x))tangent.set(1,0);
    const normal=new THREE.Vector2(-tangent.y,tangent.x);
    const coordinates=count===2
      ? [[-.62,0],[.62,0]]
      : count===3
        ? [[-.72,.24],[.72,.24],[0,-.58]]
        : [[-.74,.5],[.74,.5],[-.74,-.5],[.74,-.5]];
    const [across,along]=coordinates[Math.min(slot,coordinates.length-1)];
    return normal.multiplyScalar(across).add(tangent.multiplyScalar(along));
  }

  private sharedSpaceScale(count:number){return count<=1?1:count===2?.9:count===3?.78:.72;}

  private makeToken(color:string,racerId:string,ownerName:string,viewerOwned=false){
    const g=new THREE.Group();g.userData.racerId=racerId;g.userData.locale=this.locale;g.userData.ownerName=ownerName;g.userData.viewerOwned=viewerOwned;
    const body=new THREE.Group();g.add(body);g.userData.body=body;
    const ink=new THREE.MeshStandardMaterial({color:0x17131c,roughness:.5,metalness:.08});
    const playerMaterial=new THREE.MeshPhysicalMaterial({color,roughness:.38,metalness:.05,clearcoat:.4,clearcoatRoughness:.35,emissive:new THREE.Color(color),emissiveIntensity:.08});
    const shadow=new THREE.Mesh(new THREE.CircleGeometry(.67,24),new THREE.MeshBasicMaterial({color:0x09070c,transparent:true,opacity:.34,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=.012;g.add(shadow);
    const focusRing=new THREE.Mesh(new THREE.RingGeometry(.69,.77,36),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.78,depthWrite:false,side:THREE.DoubleSide}));focusRing.rotation.x=-Math.PI/2;focusRing.position.y=.045;focusRing.visible=false;g.add(focusRing);g.userData.focusRing=focusRing;
    const base=new THREE.Mesh(new THREE.CylinderGeometry(.54,.65,.2,20),playerMaterial);base.position.y=.13;base.castShadow=true;base.receiveShadow=true;body.add(base);
    const rim=new THREE.Mesh(new THREE.TorusGeometry(.56,.065,8,28),ink);rim.rotation.x=Math.PI/2;rim.position.y=.24;body.add(rim);
    const stem=new THREE.Mesh(new THREE.BoxGeometry(.64,.18,.16),ink);stem.position.y=.39;stem.castShadow=true;body.add(stem);
    const backplate=new THREE.Mesh(new THREE.BoxGeometry(1.28,1.44,.09),ink);backplate.position.set(0,1.04,-.015);backplate.castShadow=true;body.add(backplate);
    const frame=new THREE.Mesh(new THREE.BoxGeometry(1.16,1.32,.1),playerMaterial);frame.position.y=1.04;frame.castShadow=true;body.add(frame);
    const texture=this.textureLoader.load(`${import.meta.env.BASE_URL}racers/${racerId}.webp`);
    texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=this.renderer.capabilities.getMaxAnisotropy();texture.generateMipmaps=true;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;
    const portraitMaterial=new THREE.MeshBasicMaterial({map:texture,toneMapped:false});
    const portrait=new THREE.Mesh(new THREE.PlaneGeometry(1.04,1.18),portraitMaterial);portrait.position.set(0,1.04,.056);body.add(portrait);
    const tripFx=new THREE.Group();
    ['✦','★','✧'].forEach((symbol,index)=>{const star=this.textSprite(symbol,index===1?0xffd52a:0xff8f4d);star.position.set((index-1)*.52,1.15+index*.22,.2);star.scale.set(.33,.33,1);tripFx.add(star);});
    tripFx.visible=false;g.add(tripFx);g.userData.tripFx=tripFx;
    g.userData.playerMaterial=playerMaterial;
    g.userData.tripped=false;
    g.position.set(0,4,0);return g;
  }

  private makeLocator(color:string){
    const group=new THREE.Group();group.renderOrder=4;
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,.065,0,0,.065,0],3));
    const line=new THREE.Line(geometry,new THREE.LineBasicMaterial({color,transparent:true,opacity:.92,depthTest:false}));line.renderOrder=4;group.add(line);group.userData.line=line;
    const dot=new THREE.Mesh(new THREE.CircleGeometry(.13,20),new THREE.MeshBasicMaterial({color:0xfff8e8,transparent:true,opacity:.96,depthTest:false,side:THREE.DoubleSide}));dot.rotation.x=-Math.PI/2;dot.position.y=.07;dot.renderOrder=5;group.add(dot);group.userData.dot=dot;
    group.visible=false;return group;
  }

  private syncModifierBursts(view:GameView,movementStartDelay:number){
    const entries=view.logs.filter(log=>log.effectKind==='modifier'&&log.modifier&&log.sourceRacerId);
    if(!this.modifiersInitialized){entries.forEach(log=>this.modifierLogIds.add(log.id));this.modifiersInitialized=true;return;}
    const fresh=entries.filter(log=>!this.modifierLogIds.has(log.id));
    const stackByTarget=new Map<string,number>();
    for(const log of fresh){
      this.modifierLogIds.add(log.id);
      const racerId=log.targetRacerId??log.sourceRacerId!;
      const stack=stackByTarget.get(racerId)??0;stackByTarget.set(racerId,stack+1);
      const value=log.modifier!;const label=`${value>0?'+':''}${value} ${this.locale==='zh'?'步':'STEP'}`;
      const sprite=this.textSprite(label,value>0?0x55d5ee:0xff6a48,true);sprite.scale.set(1.65,.55,1);sprite.visible=false;sprite.renderOrder=100;(sprite.material as THREE.SpriteMaterial).depthTest=false;this.scene.add(sprite);
      const startsAt=performance.now()+Math.max(0,movementStartDelay-360)+stack*80;
      this.modifierBursts.push({sprite,racerId,startsAt,expiresAt:startsAt+1350,stack});
    }
  }

  private buildArena(){
    const floor=new THREE.Mesh(new THREE.CircleGeometry(34,64),new THREE.MeshStandardMaterial({color:0x100c16,roughness:.95,metalness:.02}));floor.rotation.x=-Math.PI/2;floor.position.y=-.74;floor.receiveShadow=true;this.scene.add(floor);
    const ring=new THREE.Mesh(new THREE.TorusGeometry(13.2,.09,8,96),new THREE.MeshBasicMaterial({color:0x55d5ee,transparent:true,opacity:.42}));ring.rotation.x=Math.PI/2;ring.position.y=-.66;this.scene.add(ring);
    const positions:number[]=[];const colors:number[]=[];const palette=[new THREE.Color(0xffd52a),new THREE.Color(0x55d5ee),new THREE.Color(0xf04cab),new THREE.Color(0xff4b2b)];
    for(let i=0;i<180;i++){const a=(i/180)*Math.PI*2;const radius=14+(i%7)*.42;positions.push(Math.cos(a)*radius,1.2+(i%11)*.38,Math.sin(a)*radius);const c=palette[i%palette.length];colors.push(c.r,c.g,c.b);}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    this.scene.add(new THREE.Points(geometry,new THREE.PointsMaterial({size:.11,vertexColors:true,transparent:true,opacity:.68,depthWrite:false})));
    [[-11,3,7,0xffd52a],[11,3,-7,0x55d5ee]].forEach(([x,y,z,color])=>{const light=new THREE.PointLight(color,7,16,2);light.position.set(x,y,z);this.scene.add(light);});
  }

  private disposeObject(object:THREE.Object3D){
    object.traverse(child=>{if(!(child instanceof THREE.Mesh||child instanceof THREE.Sprite||child instanceof THREE.Line))return;child.geometry?.dispose();const materials=Array.isArray(child.material)?child.material:[child.material];for(const material of materials){const map=(material as THREE.MeshStandardMaterial).map;map?.dispose();material.dispose();}});
  }

  private textSprite(text:string,color:number,plaque=false){
    const c=document.createElement('canvas');c.width=384;c.height=128;const x=c.getContext('2d')!;
    if(plaque){x.fillStyle='#17131ce8';x.beginPath();x.roundRect(8,18,368,92,24);x.fill();x.lineWidth=6;x.strokeStyle=`#${color.toString(16).padStart(6,'0')}`;x.stroke();}
    const fontSize=text.length>12?38:text.length>8?44:54;x.font=`900 ${fontSize}px 'Noto Sans SC',Arial,sans-serif`;x.textAlign='center';x.textBaseline='middle';x.lineWidth=12;x.strokeStyle='#17131c';x.strokeText(text,192,64);x.fillStyle=`#${color.toString(16).padStart(6,'0')}`;x.fillText(text,192,64);
    const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false}));sprite.scale.set(2,1,1);return sprite;
  }

  private animate=()=>{
    this.raf=requestAnimationFrame(this.animate);
    const now=performance.now();const t=now*.001;
    this.fpsFrames++;
    if(now-this.fpsSampleStarted>=1000){
      this.canvas.dataset.fps=(this.fpsFrames*1000/(now-this.fpsSampleStarted)).toFixed(1);
      this.fpsFrames=0;this.fpsSampleStarted=now;
    }
    this.root.updateMatrixWorld();const cameraLocal=this.root.worldToLocal(this.camera.position.clone());let movingFocus:THREE.Group|null=null;
    for(const token of this.tokens.values()){
      const queue=token.userData.stepQueue as THREE.Vector3[]|undefined;
      let moving=false;
      if(token.userData.warpMove&&queue?.length&&now>=(token.userData.moveStartsAt??0)){
        moving=true;movingFocus=token;token.position.copy(queue.shift()!);token.userData.warpMove=false;token.userData.warpStartedAt=now;
      }else if((queue?.length||token.userData.stepTarget)&&now>=(token.userData.moveStartsAt??0)){
        moving=true;movingFocus=token;
        if(!token.userData.stepTarget){token.userData.stepFrom=token.position.clone();token.userData.stepTarget=queue!.shift();token.userData.stepStarted=now;}
        const progress=Math.min(1,(now-token.userData.stepStarted)/185);
        token.position.lerpVectors(token.userData.stepFrom,token.userData.stepTarget,progress);
        token.position.y+=Math.sin(progress*Math.PI)*.42;
        if(progress>=1){token.position.copy(token.userData.stepTarget);token.userData.stepTarget=undefined;}
      }else if(!queue?.length){
        const target=token.userData.target as THREE.Vector3|undefined;
        if(target){token.position.x=THREE.MathUtils.lerp(token.position.x,target.x,.18);token.position.z=THREE.MathUtils.lerp(token.position.z,target.z,.18);token.position.y=THREE.MathUtils.lerp(token.position.y,target.y+Math.sin(t*3.4+token.id)*.035,.18);}
      }
      if(token.userData.pendingTrip&&!queue?.length&&!token.userData.stepTarget&&!token.userData.awaitingConfirmation){token.userData.pendingTrip=false;token.userData.tripStartedAt=now;this.animationEndsAt=Math.max(this.animationEndsAt,now+760);}
      token.rotation.y=Math.atan2(cameraLocal.x-token.position.x,cameraLocal.z-token.position.z);
      const body=token.userData.body as THREE.Group,tripFx=token.userData.tripFx as THREE.Group;
      const tripElapsed=now-(token.userData.tripStartedAt??-10000),recoverElapsed=now-(token.userData.recoverStartedAt??-10000),warpElapsed=now-(token.userData.warpStartedAt??-10000);
      let bodyAngle=token.userData.tripped&&!token.userData.pendingTrip?Math.PI/2:moving?Math.sin(t*24)*.08:0;
      if(tripElapsed>=0&&tripElapsed<760){
        const progress=tripElapsed/760;
        bodyAngle=progress<.34?Math.sin(progress*9*Math.PI)*.18*(progress/.34):THREE.MathUtils.lerp(.08,Math.PI/2,1-Math.pow(1-(progress-.34)/.66,3))+Math.sin(progress*Math.PI*5)*(1-progress)*.12;
        tripFx.visible=progress>.2&&progress<.98;tripFx.scale.setScalar(.82+Math.sin(progress*Math.PI)*.46);tripFx.rotation.z=-token.rotation.y;
      }else if(recoverElapsed>=0&&recoverElapsed<680){
        const progress=recoverElapsed/680;bodyAngle=THREE.MathUtils.lerp(Math.PI/2,0,1-Math.pow(1-progress,3))-Math.sin(progress*Math.PI)*.16;
        tripFx.visible=progress<.42;tripFx.scale.setScalar(1-progress*.45);
      }else tripFx.visible=false;
      body.rotation.z=THREE.MathUtils.lerp(body.rotation.z,bodyAngle,.24);
      const warpScale=warpElapsed>=0&&warpElapsed<520?.34+Math.sin(Math.min(1,warpElapsed/520)*Math.PI)*.9:1;
      body.scale.lerp(new THREE.Vector3(warpScale,warpScale,warpScale),.28);
      const clusterScale=token.userData.clusterScale??1;const emphasis=token.userData.finished?1.06:token.userData.active?1.12:1;const baseScale=clusterScale*emphasis*this.mobileTokenScale;
      token.scale.lerp(new THREE.Vector3(baseScale,baseScale,baseScale),.12);
      const material=token.userData.playerMaterial as THREE.MeshPhysicalMaterial;material.emissiveIntensity=token.userData.active?.24:.08;
      const focusRing=token.userData.focusRing as THREE.Mesh;
      if(focusRing.visible){const pulse=1+Math.sin(t*5.5)*.045;focusRing.scale.setScalar(pulse);const ringMaterial=focusRing.material as THREE.MeshBasicMaterial;ringMaterial.opacity=token.userData.effectFocus?.92:.72;}
      const racerStateId=token.userData.racerStateId as string|undefined;const locator=racerStateId?this.locatorLines.get(racerStateId):undefined;const center=token.userData.spaceCenter as THREE.Vector3|undefined;
      if(locator&&center){
        locator.visible=Boolean(token.visible&&token.userData.clustered&&!queue?.length&&!token.userData.stepTarget&&!token.userData.awaitingConfirmation);
        const line=locator.userData.line as THREE.Line;const attribute=line.geometry.getAttribute('position') as THREE.BufferAttribute;
        attribute.setXYZ(0,token.position.x,.065,token.position.z);attribute.setXYZ(1,center.x,.065,center.z);attribute.needsUpdate=true;
        const dot=locator.userData.dot as THREE.Mesh;dot.visible=Boolean(token.userData.clusterAnchor);dot.position.set(center.x,.07,center.z);
      }
    }
    for(let index=this.modifierBursts.length-1;index>=0;index--){
      const burst=this.modifierBursts[index];
      if(now>=burst.expiresAt){this.scene.remove(burst.sprite);this.disposeObject(burst.sprite);this.modifierBursts.splice(index,1);continue;}
      if(now<burst.startsAt){burst.sprite.visible=false;continue;}
      const token=this.tokens.get(burst.racerId);if(!token){burst.sprite.visible=false;continue;}
      const progress=(now-burst.startsAt)/(burst.expiresAt-burst.startsAt);const world=new THREE.Vector3();token.getWorldPosition(world);
      burst.sprite.visible=true;burst.sprite.position.set(world.x,world.y+1.42+burst.stack*.72+progress*.24,world.z);
      const material=burst.sprite.material as THREE.SpriteMaterial;material.opacity=Math.min(1,progress*7,(1-progress)*5);
    }
    const focusToken=(this.effectFocusRacerId?this.tokens.get(this.effectFocusRacerId):undefined)??movingFocus??(this.interactionFocusRacerId?this.tokens.get(this.interactionFocusRacerId):undefined);
    const desiredTarget=this.manualCameraTarget.clone();
    if(focusToken)focusToken.getWorldPosition(desiredTarget);
    desiredTarget.y=0;this.cameraTarget.lerp(desiredTarget,focusToken?.09:.055);this.camera.lookAt(this.cameraTarget);
    this.camera.zoom=THREE.MathUtils.lerp(this.camera.zoom,focusToken?(this.mobileView?1.28:1.22):this.manualCameraZoom,.07);this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene,this.camera);
  };

  private pickAt(clientX:number,clientY:number){
    const rect=this.canvas.getBoundingClientRect();if(!rect.width||!rect.height)return{};
    this.pointer.set(((clientX-rect.left)/rect.width)*2-1,-((clientY-rect.top)/rect.height)*2+1);this.raycaster.setFromCamera(this.pointer,this.camera);
    const tokenHit=this.raycaster.intersectObjects([...this.tokens.values()],true)[0];
    if(tokenHit){let object:THREE.Object3D|null=tokenHit.object;while(object&&!object.userData.racerStateId)object=object.parent;const racerStateId=object?.userData.racerStateId as string|undefined;if(racerStateId)return{racerStateId};}
    const boardHit=this.boardArtwork?this.raycaster.intersectObject(this.boardArtwork,false)[0]:undefined;
    if(!boardHit)return{};
    const local=this.root.worldToLocal(boardHit.point.clone());let closest=0,distance=Number.POSITIVE_INFINITY;
    this.positions.forEach((position,index)=>{const next=Math.hypot(position.x-local.x,position.z-local.z);if(next<distance){distance=next;closest=index;}});
    return distance<1.08?{space:closest}:{};
  }

  private onPointerDown=(event:PointerEvent)=>{
    this.activePointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    this.canvas.setPointerCapture(event.pointerId);
    if(this.activePointers.size>1){
      clearTimeout(this.longPressTimer);this.pointerStart=null;this.pointerDragged=true;this.pinching=true;
      const points=[...this.activePointers.values()];this.pinchStartDistance=Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y);this.pinchStartZoom=this.manualCameraZoom;
      return;
    }
    this.pointerStart={id:event.pointerId,x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY};this.pointerDragged=false;this.pinching=false;this.longPressFired=false;clearTimeout(this.longPressTimer);
    this.longPressTimer=window.setTimeout(()=>{if(!this.pointerStart||this.pointerDragged||this.activePointers.size!==1)return;this.longPressFired=true;const picked=this.pickAt(this.pointerStart.x,this.pointerStart.y);if(picked.racerStateId)this.handlers.onRacerTap?.(picked.racerStateId);else if(picked.space!==undefined)this.handlers.onSpaceLongPress?.(picked.space);},520);
  };
  private onPointerMove=(event:PointerEvent)=>{
    if(!this.activePointers.has(event.pointerId))return;
    this.activePointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(this.activePointers.size>=2){
      clearTimeout(this.longPressTimer);this.pointerDragged=true;this.pinching=true;
      const points=[...this.activePointers.values()];const distance=Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y);
      if(this.pinchStartDistance>0){const next=THREE.MathUtils.clamp(this.pinchStartZoom*distance/this.pinchStartDistance,1,1.9);if(Math.abs(next-this.manualCameraZoom)>.005){this.manualCameraZoom=next;this.manualCameraMoved=true;}}
      return;
    }
    const start=this.pointerStart;if(!start||start.id!==event.pointerId)return;
    const total=Math.hypot(event.clientX-start.x,event.clientY-start.y);
    if(total>10){
      clearTimeout(this.longPressTimer);this.pointerDragged=true;
      this.panCamera(event.clientX-start.lastX,event.clientY-start.lastY);
    }
    start.lastX=event.clientX;start.lastY=event.clientY;
  };
  private onPointerUp=(event:PointerEvent)=>{
    clearTimeout(this.longPressTimer);
    const start=this.pointerStart;const wasDragged=this.pointerDragged||this.pinching;
    this.activePointers.delete(event.pointerId);
    try{this.canvas.releasePointerCapture(event.pointerId);}catch{ /* Pointer capture may already be released. */ }
    if(this.activePointers.size){
      const [id,point]=this.activePointers.entries().next().value as [number,{x:number;y:number}];
      this.pointerStart={id,x:point.x,y:point.y,lastX:point.x,lastY:point.y};return;
    }
    this.pointerStart=null;
    if(wasDragged){this.pointerDragged=false;this.pinching=false;if(this.manualCameraMoved)this.handlers.onCameraViewChange?.(true);return;}
    if(!start||this.longPressFired){this.longPressFired=false;return;}
    const picked=this.pickAt(event.clientX,event.clientY);
    if(picked.racerStateId){this.handlers.onRacerTap?.(picked.racerStateId);return;}
    const now=performance.now();
    if(now-this.lastEmptyTapAt<300&&Math.hypot(event.clientX-this.lastEmptyTap.x,event.clientY-this.lastEmptyTap.y)<28)this.resetCameraView();
    this.lastEmptyTapAt=now;this.lastEmptyTap={x:event.clientX,y:event.clientY};
  };
  private onPointerCancel=(event:PointerEvent)=>{clearTimeout(this.longPressTimer);this.activePointers.delete(event.pointerId);if(!this.activePointers.size){this.pointerStart=null;this.longPressFired=false;if(this.manualCameraMoved)this.handlers.onCameraViewChange?.(true);}};
  private onWheel=(event:WheelEvent)=>{event.preventDefault();const next=THREE.MathUtils.clamp(this.manualCameraZoom*Math.exp(-event.deltaY*.0012),1,1.9);if(Math.abs(next-this.manualCameraZoom)<.005)return;this.manualCameraZoom=next;this.manualCameraMoved=true;this.handlers.onCameraViewChange?.(true);};

  private panCamera(dx:number,dy:number){
    const rect=this.canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
    const right=new THREE.Vector3(1,0,0).applyQuaternion(this.camera.quaternion);right.y=0;if(right.lengthSq()<.001)right.set(1,0,0);else right.normalize();
    const up=new THREE.Vector3(0,1,0).applyQuaternion(this.camera.quaternion);up.y=0;if(up.lengthSq()<.001)up.set(0,0,-1);else up.normalize();
    const worldX=(this.camera.right-this.camera.left)/(rect.width*Math.max(.01,this.camera.zoom));
    const worldY=(this.camera.top-this.camera.bottom)/(rect.height*Math.max(.01,this.camera.zoom));
    this.manualCameraTarget.addScaledVector(right,-dx*worldX).addScaledVector(up,dy*worldY);
    const xLimit=this.mobileView?2.55:7.6,zLimit=this.mobileView?7.6:2.5;
    this.manualCameraTarget.x=THREE.MathUtils.clamp(this.manualCameraTarget.x,-xLimit,xLimit);this.manualCameraTarget.z=THREE.MathUtils.clamp(this.manualCameraTarget.z,-zLimit,zLimit);this.manualCameraTarget.y=0;this.manualCameraMoved=true;
  }

  private resize=()=>{const rect=this.canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;this.renderer.setSize(rect.width,rect.height,false);const aspect=rect.width/rect.height;this.camera.up.set(0,1,0);this.mobileView=aspect<.72;this.mobileTokenScale=this.mobileView?1.22:1;if(this.mobileView){this.root.rotation.y=Math.PI/2;this.camera.position.set(0,22,18);this.camera.lookAt(this.cameraTarget);const halfWidth=5.45;this.camera.left=-halfWidth;this.camera.right=halfWidth;this.camera.top=halfWidth/aspect;this.camera.bottom=-halfWidth/aspect;}else{this.root.rotation.y=0;this.camera.position.set(16,18,20);this.camera.lookAt(this.cameraTarget);const size=10;this.camera.left=-size*aspect;this.camera.right=size*aspect;this.camera.top=size;this.camera.bottom=-size;}this.camera.updateProjectionMatrix();};
}

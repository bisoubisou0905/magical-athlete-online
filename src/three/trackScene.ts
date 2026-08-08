import * as THREE from 'three';
import type { GameView, TrackKind } from '../game/types';
import { RACER_BY_ID } from '../game/racers';
import { TRACK_LENGTH } from '../game/engine';
import type { Locale } from '../ui/render';

const TILE_COLORS=[0xffd52a,0xff4b2b,0x55d5ee,0x53b55b,0xf04cab,0x9562d9];

export class TrackScene {
  private scene=new THREE.Scene();
  private camera=new THREE.OrthographicCamera(-12,12,8,-8,0.1,100);
  private renderer:THREE.WebGLRenderer;
  private root=new THREE.Group();
  private tokens=new Map<string,THREE.Group>();
  private textureLoader=new THREE.TextureLoader();
  private trackKind:TrackKind|null=null;
  private locale:Locale;
  private positions:THREE.Vector3[]=[];
  private raf=0;
  private animationEndsAt=0;

  constructor(private canvas:HTMLCanvasElement,locale:Locale='zh'){
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
    this.animate();
  }

  update(view:GameView,locale:Locale=this.locale){
    if(locale!==this.locale){this.locale=locale;this.trackKind=null;}
    if(view.track!==this.trackKind){this.trackKind=view.track;this.buildTrack(view.track);}
    const active=new Set<string>();
    view.racers.forEach((r,index)=>{
      active.add(r.playerId); let token=this.tokens.get(r.playerId);
      const owner=view.players.find(p=>p.id===r.playerId)!;
      if(token?.userData.racerId!==r.racerId||token?.userData.locale!==this.locale||token?.userData.ownerName!==owner.name){
        if(token){this.root.remove(token);this.disposeObject(token);}
        token=this.makeToken(owner.color,r.racerId,owner.name);this.tokens.set(r.playerId,token);this.root.add(token);
        const initial=this.positions[Math.min(r.position,TRACK_LENGTH)].clone();initial.y=.24+index*.025;token.position.copy(initial);token.userData.logicalPosition=r.position;
      }
      token.visible=!r.eliminated;
      const base=this.positions[Math.min(r.position,TRACK_LENGTH)];
      const same=view.racers.filter(x=>!x.eliminated&&x.position===r.position);const slot=same.findIndex(x=>x.playerId===r.playerId);const angle=(slot/Math.max(1,same.length))*Math.PI*2;
      const fanRadius=same.length > 1 ? .68 : .32;
      const target=base.clone().add(new THREE.Vector3(Math.cos(angle)*fanRadius,0.24+index*0.025,Math.sin(angle)*fanRadius));
      const previous=token.userData.logicalPosition as number;
      if(previous!==r.position){
        const direction=Math.sign(r.position-previous);
        const queue:THREE.Vector3[]=[];
        for(let position=previous+direction;direction>0?position<=r.position:position>=r.position;position+=direction){
          const pathPoint=this.positions[Math.min(Math.max(position,0),TRACK_LENGTH)].clone();pathPoint.y=.24+index*.025;queue.push(pathPoint);
        }
        token.userData.stepQueue=queue;
        token.userData.stepTarget=undefined;
        token.userData.moveStartsAt=performance.now()+(view.lastRollPlayerId===r.playerId?680:120);
        this.animationEndsAt=Math.max(this.animationEndsAt,token.userData.moveStartsAt+queue.length*205+250);
        token.userData.logicalPosition=r.position;
      }
      token.userData.target=target; token.userData.tripped=r.tripped; token.userData.finished=r.finished;
      token.userData.turnMarker.visible=view.turnPlayerId===r.playerId;
      token.userData.active=view.turnPlayerId===r.playerId;
    });
    for(const [id,token] of this.tokens)if(!active.has(id)){this.root.remove(token);this.disposeObject(token);this.tokens.delete(id);}
  }

  destroy(){cancelAnimationFrame(this.raf);removeEventListener('resize',this.resize);this.renderer.dispose();}
  resizeNow(){this.resize();}
  getPendingAnimationMs(){return Math.max(0,this.animationEndsAt-performance.now());}

  private buildTrack(kind:TrackKind){
    for(const child of [...this.root.children])if(child.userData.track){this.root.remove(child);this.disposeObject(child);}
    const board=new THREE.Mesh(new THREE.BoxGeometry(22,0.5,12),new THREE.MeshPhysicalMaterial({color:kind==='mild'?0x30243a:0x28182f,roughness:.78,clearcoat:.16,clearcoatRoughness:.8}));board.position.y=-.47;board.receiveShadow=true;board.userData.track=true;this.root.add(board);
    this.positions.forEach((p,i)=>{
      const halo=new THREE.Mesh(new THREE.BoxGeometry(1.68,.12,1.68),new THREE.MeshStandardMaterial({color:0x100c15,roughness:.65}));halo.position.copy(p);halo.position.y=-.08;halo.userData.track=true;this.root.add(halo);
      const mat=new THREE.MeshPhysicalMaterial({color:TILE_COLORS[i%TILE_COLORS.length],roughness:.55,metalness:.03,clearcoat:.22,clearcoatRoughness:.5});
      const tile=new THREE.Mesh(new THREE.BoxGeometry(1.52,.28,1.52),mat);tile.position.copy(p);tile.castShadow=true;tile.receiveShadow=true;tile.userData.track=true;this.root.add(tile);
      const edge=new THREE.LineSegments(new THREE.EdgesGeometry(tile.geometry),new THREE.LineBasicMaterial({color:0x17131c}));edge.position.copy(tile.position);edge.position.y+=.002;edge.userData.track=true;this.root.add(edge);
      if(kind==='wild'){
        const mark=wildMark(i);if(mark){const sprite=this.textSprite(mark.text,mark.color);sprite.position.copy(p).add(new THREE.Vector3(0,.43,0));sprite.userData.track=true;this.root.add(sprite);}
      }
    });
    const start=this.textSprite(this.locale==='zh'?'起点':'START',0xffffff);start.position.copy(this.positions[0]).add(new THREE.Vector3(0,.75,-1.2));start.scale.multiplyScalar(1.35);start.userData.track=true;this.root.add(start);
    const finish=this.textSprite(this.locale==='zh'?'终点':'FINISH',0xffffff);finish.position.copy(this.positions[TRACK_LENGTH]).add(new THREE.Vector3(0,.75,-1.2));finish.scale.multiplyScalar(1.35);finish.userData.track=true;this.root.add(finish);
    this.addFinishGate();
  }

  private makePositions(){
    const pts:THREE.Vector3[]=[];
    for(let i=0;i<=10;i++)pts.push(new THREE.Vector3(-8.3+i*1.65,0,4.2));
    for(let i=1;i<=10;i++)pts.push(new THREE.Vector3(8.2,0,4.2-i*.84));
    for(let i=1;i<=10;i++)pts.push(new THREE.Vector3(8.2-i*1.65,0,-4.2));
    return pts;
  }

  private makeToken(color:string,racerId:string,ownerName:string){
    const g=new THREE.Group();g.userData.racerId=racerId;g.userData.locale=this.locale;g.userData.ownerName=ownerName;
    const ink=new THREE.MeshStandardMaterial({color:0x17131c,roughness:.5,metalness:.08});
    const playerMaterial=new THREE.MeshPhysicalMaterial({color,roughness:.38,metalness:.05,clearcoat:.4,clearcoatRoughness:.35,emissive:new THREE.Color(color),emissiveIntensity:.08});
    const shadow=new THREE.Mesh(new THREE.CircleGeometry(.67,24),new THREE.MeshBasicMaterial({color:0x09070c,transparent:true,opacity:.34,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=.012;g.add(shadow);
    const base=new THREE.Mesh(new THREE.CylinderGeometry(.58,.68,.2,20),playerMaterial);base.position.y=.13;base.castShadow=true;base.receiveShadow=true;g.add(base);
    const rim=new THREE.Mesh(new THREE.TorusGeometry(.59,.065,8,28),ink);rim.rotation.x=Math.PI/2;rim.position.y=.24;g.add(rim);
    const stem=new THREE.Mesh(new THREE.BoxGeometry(.72,.18,.16),ink);stem.position.y=.39;stem.castShadow=true;g.add(stem);
    const frame=new THREE.Mesh(new THREE.BoxGeometry(1.38,1.34,.1),playerMaterial);frame.position.y=1.04;frame.castShadow=true;g.add(frame);
    const texture=this.textureLoader.load(`${import.meta.env.BASE_URL}racers/${racerId}.webp`);
    texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=Math.min(4,this.renderer.capabilities.getMaxAnisotropy());
    const portrait=new THREE.Mesh(new THREE.PlaneGeometry(1.24,1.2),new THREE.MeshStandardMaterial({map:texture,roughness:.7,metalness:0}));portrait.position.set(0,1.04,.056);g.add(portrait);
    const racerName=this.locale==='zh'?RACER_BY_ID[racerId].nameZh:RACER_BY_ID[racerId].name;
    const badge=this.textSprite(racerName,0xffffff);badge.position.set(0,1.7,.06);badge.scale.set(.92,.32,1);g.add(badge);
    const ownerBadge=this.textSprite(ownerName,new THREE.Color(color).getHex(),true);ownerBadge.position.set(0,2.1,.07);ownerBadge.scale.set(1.72,.58,1);g.add(ownerBadge);
    const turnMarker=this.textSprite('▼',0xffd52a);turnMarker.position.set(0,2.62,.08);turnMarker.scale.set(.54,.4,1);turnMarker.visible=false;g.add(turnMarker);g.userData.turnMarker=turnMarker;
    g.userData.playerMaterial=playerMaterial;
    g.position.set(0,4,0);return g;
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

  private addFinishGate(){
    const p=this.positions[TRACK_LENGTH];const group=new THREE.Group();group.userData.track=true;
    const ink=new THREE.MeshStandardMaterial({color:0x17131c,roughness:.52});const white=new THREE.MeshStandardMaterial({color:0xfff8e8,roughness:.58});
    for(const dz of [-1.05,1.05]){const pole=new THREE.Mesh(new THREE.BoxGeometry(.2,2.35,.2),dz<0?ink:white);pole.position.set(p.x,1.12,p.z+dz);pole.castShadow=true;group.add(pole);}
    const bar=new THREE.Mesh(new THREE.BoxGeometry(.22,.24,2.3),new THREE.MeshStandardMaterial({color:0xffd52a,roughness:.45}));bar.position.set(p.x,2.25,p.z);bar.castShadow=true;group.add(bar);
    this.root.add(group);
  }

  private disposeObject(object:THREE.Object3D){
    object.traverse(child=>{if(!(child instanceof THREE.Mesh||child instanceof THREE.Sprite))return;child.geometry?.dispose();const materials=Array.isArray(child.material)?child.material:[child.material];for(const material of materials){const map=(material as THREE.MeshStandardMaterial).map;map?.dispose();material.dispose();}});
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
    this.root.updateMatrixWorld();const cameraLocal=this.root.worldToLocal(this.camera.position.clone());
    for(const token of this.tokens.values()){
      const queue=token.userData.stepQueue as THREE.Vector3[]|undefined;
      let moving=false;
      if((queue?.length||token.userData.stepTarget)&&now>=(token.userData.moveStartsAt??0)){
        moving=true;
        if(!token.userData.stepTarget){token.userData.stepFrom=token.position.clone();token.userData.stepTarget=queue!.shift();token.userData.stepStarted=now;}
        const progress=Math.min(1,(now-token.userData.stepStarted)/185);
        token.position.lerpVectors(token.userData.stepFrom,token.userData.stepTarget,progress);
        token.position.y+=Math.sin(progress*Math.PI)*.42;
        if(progress>=1){token.position.copy(token.userData.stepTarget);token.userData.stepTarget=undefined;}
      }else if(!queue?.length){
        const target=token.userData.target as THREE.Vector3|undefined;
        if(target){token.position.x=THREE.MathUtils.lerp(token.position.x,target.x,.18);token.position.z=THREE.MathUtils.lerp(token.position.z,target.z,.18);token.position.y=THREE.MathUtils.lerp(token.position.y,target.y+Math.sin(t*3.4+token.id)*.035,.18);}
      }
      token.rotation.y=Math.atan2(cameraLocal.x-token.position.x,cameraLocal.z-token.position.z);
      token.rotation.z=THREE.MathUtils.lerp(token.rotation.z,token.userData.tripped?Math.PI/2:moving?Math.sin(t*24)*.08:0,.16);
      const baseScale=token.userData.finished?1.08:token.userData.active?1.12:1;token.scale.lerp(new THREE.Vector3(baseScale,baseScale,baseScale),.12);
      const material=token.userData.playerMaterial as THREE.MeshPhysicalMaterial;material.emissiveIntensity=token.userData.active?.24:.08;
    }
    this.renderer.render(this.scene,this.camera);
  };
  private resize=()=>{const rect=this.canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;this.renderer.setSize(rect.width,rect.height,false);const aspect=rect.width/rect.height;this.camera.up.set(0,1,0);if(aspect<.72){this.root.rotation.y=Math.PI/2;this.camera.position.set(0,18,24);this.camera.lookAt(0,0,0);const halfWidth=7.2;this.camera.left=-halfWidth;this.camera.right=halfWidth;this.camera.top=halfWidth/aspect;this.camera.bottom=-halfWidth/aspect;}else{this.root.rotation.y=0;this.camera.position.set(16,18,20);this.camera.lookAt(0,0,0);const size=10;this.camera.left=-size*aspect;this.camera.right=size*aspect;this.camera.top=size;this.camera.bottom=-size;}this.camera.updateProjectionMatrix();};
}

function wildMark(i:number){if([4,14,24].includes(i))return{text:'★',color:0xfff36b};if([8,22].includes(i))return{text:'✹',color:0x8b543b};const arrows:Record<number,string>={5:'+2',11:'−2',17:'+3',26:'−3'};return arrows[i]?{text:arrows[i],color:0xffffff}:null;}

import * as THREE from 'three';
import type { GameView, TrackKind } from '../game/types';
import { RACER_BY_ID } from '../game/racers';
import { TRACK_LENGTH } from '../game/engine';

const TILE_COLORS=[0xffd52a,0xff4b2b,0x55d5ee,0x53b55b,0xf04cab,0x9562d9];

export class TrackScene {
  private scene=new THREE.Scene();
  private camera=new THREE.OrthographicCamera(-12,12,8,-8,0.1,100);
  private renderer:THREE.WebGLRenderer;
  private root=new THREE.Group();
  private tokens=new Map<string,THREE.Group>();
  private trackKind:TrackKind|null=null;
  private positions:THREE.Vector3[]=[];
  private raf=0;

  constructor(private canvas:HTMLCanvasElement){
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled=true; this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.scene.background=new THREE.Color(0x17131c);
    this.scene.fog=new THREE.Fog(0x17131c,26,46);
    this.camera.position.set(16,18,20); this.camera.lookAt(0,0,0);
    this.scene.add(this.root);
    const hemi=new THREE.HemisphereLight(0xfff4d8,0x281b4e,2.1);this.scene.add(hemi);
    const sun=new THREE.DirectionalLight(0xffffff,2.4);sun.position.set(-8,14,8);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);this.scene.add(sun);
    this.positions=this.makePositions();
    this.resize(); addEventListener('resize',this.resize);
    this.animate();
  }

  update(view:GameView){
    if(view.track!==this.trackKind){this.trackKind=view.track;this.buildTrack(view.track);}
    const active=new Set<string>();
    view.racers.forEach((r,index)=>{
      active.add(r.playerId); let token=this.tokens.get(r.playerId);
      if(!token){token=this.makeToken(view.players.find(p=>p.id===r.playerId)!.color,RACER_BY_ID[r.racerId].icon);this.tokens.set(r.playerId,token);this.root.add(token);}
      token.visible=!r.eliminated;
      const base=this.positions[Math.min(r.position,TRACK_LENGTH)];
      const same=view.racers.filter(x=>!x.eliminated&&x.position===r.position);const slot=same.findIndex(x=>x.playerId===r.playerId);const angle=(slot/Math.max(1,same.length))*Math.PI*2;
      const target=base.clone().add(new THREE.Vector3(Math.cos(angle)*0.35,0.75+index*0.025,Math.sin(angle)*0.35));
      token.userData.target=target; token.userData.tripped=r.tripped; token.userData.finished=r.finished;
    });
    for(const [id,token] of this.tokens)if(!active.has(id)){this.root.remove(token);this.tokens.delete(id);}
  }

  destroy(){cancelAnimationFrame(this.raf);removeEventListener('resize',this.resize);this.renderer.dispose();}

  private buildTrack(kind:TrackKind){
    for(const child of [...this.root.children])if(child.userData.track)this.root.remove(child);
    const board=new THREE.Mesh(new THREE.BoxGeometry(22,0.45,12),new THREE.MeshStandardMaterial({color:kind==='mild'?0x282033:0x25192f,roughness:.86}));board.position.y=-.45;board.receiveShadow=true;board.userData.track=true;this.root.add(board);
    this.positions.forEach((p,i)=>{
      const mat=new THREE.MeshStandardMaterial({color:TILE_COLORS[i%TILE_COLORS.length],roughness:.72,metalness:.02});
      const tile=new THREE.Mesh(new THREE.BoxGeometry(1.52,.28,1.52),mat);tile.position.copy(p);tile.castShadow=true;tile.receiveShadow=true;tile.userData.track=true;this.root.add(tile);
      const edge=new THREE.LineSegments(new THREE.EdgesGeometry(tile.geometry),new THREE.LineBasicMaterial({color:0x17131c}));edge.position.copy(tile.position);edge.position.y+=.002;edge.userData.track=true;this.root.add(edge);
      if(kind==='wild'){
        const mark=wildMark(i);if(mark){const sprite=this.textSprite(mark.text,mark.color);sprite.position.copy(p).add(new THREE.Vector3(0,.43,0));sprite.userData.track=true;this.root.add(sprite);}
      }
    });
    const start=this.textSprite('START',0xffffff);start.position.copy(this.positions[0]).add(new THREE.Vector3(0,.75,-1.2));start.scale.multiplyScalar(1.35);start.userData.track=true;this.root.add(start);
    const finish=this.textSprite('FINISH',0xffffff);finish.position.copy(this.positions[TRACK_LENGTH]).add(new THREE.Vector3(0,.75,-1.2));finish.scale.multiplyScalar(1.35);finish.userData.track=true;this.root.add(finish);
  }

  private makePositions(){
    const pts:THREE.Vector3[]=[];
    for(let i=0;i<=10;i++)pts.push(new THREE.Vector3(-8.3+i*1.65,0,4.2));
    for(let i=1;i<=10;i++)pts.push(new THREE.Vector3(8.2,0,4.2-i*.84));
    for(let i=1;i<=10;i++)pts.push(new THREE.Vector3(8.2-i*1.65,0,-4.2));
    return pts;
  }

  private makeToken(color:string,icon:string){
    const g=new THREE.Group();
    const body=new THREE.Mesh(new THREE.CylinderGeometry(.48,.56,.64,8),new THREE.MeshStandardMaterial({color,roughness:.55}));body.castShadow=true;g.add(body);
    const rim=new THREE.Mesh(new THREE.TorusGeometry(.52,.09,8,20),new THREE.MeshStandardMaterial({color:0x17131c,roughness:.5}));rim.rotation.x=Math.PI/2;rim.position.y=.3;g.add(rim);
    const label=this.textSprite(icon,0x17131c);label.position.y=.58;label.scale.set(.78,.78,.78);g.add(label);
    g.position.set(0,4,0);return g;
  }

  private textSprite(text:string,color:number){
    const c=document.createElement('canvas');c.width=256;c.height=128;const x=c.getContext('2d')!;x.font='900 54px Arial';x.textAlign='center';x.textBaseline='middle';x.lineWidth=12;x.strokeStyle='#17131c';x.strokeText(text,128,64);x.fillStyle=`#${color.toString(16).padStart(6,'0')}`;x.fillText(text,128,64);
    const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false}));sprite.scale.set(2,1,1);return sprite;
  }

  private animate=()=>{this.raf=requestAnimationFrame(this.animate);const t=performance.now()*.001;for(const token of this.tokens.values()){const target=token.userData.target as THREE.Vector3|undefined;if(target)token.position.lerp(target,.12);token.rotation.z=THREE.MathUtils.lerp(token.rotation.z,token.userData.tripped?Math.PI/2:0,.1);token.position.y+=(Math.sin(t*4+token.id)*.003);}this.renderer.render(this.scene,this.camera);};
  private resize=()=>{const rect=this.canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;this.renderer.setSize(rect.width,rect.height,false);const aspect=rect.width/rect.height;const size=10;this.camera.left=-size*aspect;this.camera.right=size*aspect;this.camera.top=size;this.camera.bottom=-size;this.camera.updateProjectionMatrix();};
}

function wildMark(i:number){if([4,14,24].includes(i))return{text:'★',color:0xfff36b};if([8,22].includes(i))return{text:'✹',color:0x8b543b};const arrows:Record<number,string>={5:'+2',11:'−2',17:'+3',26:'−3'};return arrows[i]?{text:arrows[i],color:0xffffff}:null;}

import Peer, { type DataConnection } from 'peerjs';
import { addPlayer, applyAction, createGame } from '../game/engine';
import type { GameAction, GameState, GameView } from '../game/types';

type WireMessage =
  | { type:'hello'; playerId:string; name:string }
  | { type:'state'; state:GameView }
  | { type:'action'; playerId:string; action:GameAction }
  | { type:'error'; message:string }
  | { type:'ping' };

export class OnlineSession {
  peer: Peer | null = null;
  state: GameState | null = null;
  playerId: string;
  isHost = false;
  private hostConnection: DataConnection | null = null;
  private guests = new Map<string, DataConnection>();
  private playerByConnection = new Map<string, string>();
  onState: (view: GameView) => void = () => {};
  onStatus: (text: string, error?: boolean) => void = () => {};

  constructor() {
    this.playerId = sessionStorage.getItem('ma-player-id') || crypto.randomUUID();
    sessionStorage.setItem('ma-player-id', this.playerId);
  }

  async host(name: string, preferredCode?: string): Promise<string> {
    this.close();
    this.isHost = true;
    const code = (preferredCode || randomCode()).toUpperCase();
    const peer = new Peer(`ma-${code.toLowerCase()}`);
    this.peer = peer;
    await waitForOpen(peer);
    this.state = createGame(code, this.playerId, name);
    peer.on('connection', conn => this.acceptGuest(conn));
    peer.on('error', err => this.onStatus(peerError(err.type), true));
    this.onStatus(`房间 ${code} 已创建`);
    this.emitLocal();
    return code;
  }

  async join(code: string, name: string): Promise<void> {
    this.close();
    this.isHost = false;
    const peer = new Peer(); this.peer = peer;
    await waitForOpen(peer);
    const conn = peer.connect(`ma-${code.toLowerCase()}`, { reliable:true, serialization:'json' });
    this.hostConnection = conn;
    await waitForConnection(conn);
    conn.on('data', raw => this.receiveFromHost(raw as WireMessage));
    conn.on('close', () => this.onStatus('与房主的连接已断开，可刷新后重新加入', true));
    conn.on('error', () => this.onStatus('联机通道发生错误', true));
    conn.send({ type:'hello', playerId:this.playerId, name } satisfies WireMessage);
    this.onStatus(`已连接房间 ${code.toUpperCase()}`);
  }

  dispatch(action: GameAction) {
    if (this.isHost && this.state) {
      this.state = applyAction(this.state, this.playerId, action);
      this.broadcast();
    } else this.hostConnection?.send({ type:'action', playerId:this.playerId, action } satisfies WireMessage);
  }

  replaceHostState(state: GameState) {
    if (!this.isHost) return;
    this.state = state; this.broadcast();
  }

  close() {
    this.hostConnection?.close(); this.hostConnection = null;
    for (const conn of this.guests.values()) conn.close();
    this.guests.clear(); this.playerByConnection.clear();
    this.peer?.destroy(); this.peer = null; this.state = null;
  }

  private acceptGuest(conn: DataConnection) {
    conn.on('open', () => this.onStatus('一名选手正在加入…'));
    conn.on('data', raw => {
      const msg=raw as WireMessage;
      if (msg.type==='hello') {
        if (!this.state) return;
        const existing=this.state.players.find(p=>p.id===msg.playerId);
        if (!existing && (this.state.phase!=='lobby'||this.state.players.length>=4)) { conn.send({type:'error',message:'房间已满或比赛已经开始'} satisfies WireMessage); conn.close(); return; }
        if (!existing) this.state=addPlayer(this.state,msg.playerId,msg.name);
        else existing.connected=true;
        this.guests.set(msg.playerId,conn); this.playerByConnection.set(conn.connectionId,msg.playerId); this.broadcast();
      } else if (msg.type==='action' && this.state && this.guests.has(msg.playerId)) {
        this.state=applyAction(this.state,msg.playerId,msg.action); this.broadcast();
      }
    });
    conn.on('close',()=>{
      const id=this.playerByConnection.get(conn.connectionId); if(!id||!this.state)return;
      const p=this.state.players.find(x=>x.id===id); if(p)p.connected=false;
      this.guests.delete(id); this.playerByConnection.delete(conn.connectionId); this.broadcast();
    });
  }

  private receiveFromHost(msg:WireMessage) {
    if(msg.type==='state') this.onState(msg.state);
    if(msg.type==='error') this.onStatus(msg.message,true);
  }

  private broadcast() {
    if(!this.state)return;
    this.emitLocal();
    for(const [id,conn] of this.guests) if(conn.open) conn.send({type:'state',state:projectView(this.state,id)} satisfies WireMessage);
  }

  private emitLocal(){if(this.state)this.onState(projectView(this.state,this.playerId));}
}

export function projectView(state:GameState,viewerId:string):GameView {
  const view=structuredClone(state) as GameView;
  view.viewerId=viewerId;
  if(view.phase==='select') for(const id of Object.keys(view.selected)) if(id!==viewerId)view.selected[id]=view.selected[id]?'hidden':null;
  return view;
}

function waitForOpen(peer:Peer):Promise<string>{return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('连接信令服务器超时')),12000);peer.once('open',id=>{clearTimeout(timer);resolve(id);});peer.once('error',err=>{clearTimeout(timer);reject(err);});});}
function waitForConnection(conn:DataConnection):Promise<void>{return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('找不到该房间，请检查房间码')),12000);conn.once('open',()=>{clearTimeout(timer);resolve();});conn.once('error',err=>{clearTimeout(timer);reject(err);});});}
function randomCode(){const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return Array.from({length:6},()=>alphabet[Math.floor(Math.random()*alphabet.length)]).join('');}
function peerError(type:string){if(type==='unavailable-id')return'这个房间码正在使用，请重试';if(type==='peer-unavailable')return'找不到房间，请确认房主在线';if(type==='network')return'网络连接失败，请检查网络';return`联机错误：${type}`;}

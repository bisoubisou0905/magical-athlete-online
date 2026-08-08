export type Phase = 'lobby' | 'draft' | 'select' | 'race' | 'raceResult' | 'gameOver';
export type TrackKind = 'mild' | 'wild';

export interface RacerDefinition {
  id: string;
  name: string;
  nameZh: string;
  power: string;
  powerZh: string;
  color: string;
  icon: string;
}

export interface PlayerState {
  id: string;
  name: string;
  color: string;
  hand: string[];
  used: string[];
  score: number;
  connected: boolean;
  isBot: boolean;
}

export interface RacerState {
  id: string;
  playerId: string;
  racerId: string;
  position: number;
  tripped: boolean;
  finished: number | null;
  eliminated: boolean;
  lastTurnStart: number;
  firstTurn: boolean;
  powerOverride?: string;
  rerolls: number;
  dicemongerUsed: boolean;
}

export interface LogEntry {
  id: number;
  text: string;
  textEn: string;
  tone?: 'normal' | 'power' | 'score' | 'warning';
  sourceRacerId?: string;
  targetRacerId?: string;
  effectKind?: 'move' | 'ability' | 'track' | 'finish' | 'decision';
}

export interface PresentationGate {
  id: number;
  kind: 'move' | 'warp';
  playerId: string;
  racerId: string;
  from: number;
  to: number;
}

export type DecisionKind =
  | 'genius-predict'
  | 'mastermind-predict'
  | 'flip-flop'
  | 'hypnotist'
  | 'third-wheel'
  | 'rocket-double'
  | 'alchemist-four'
  | 'cheerleader'
  | 'egg-copy'
  | 'twin-copy'
  | 'magician-reroll'
  | 'dicemonger-reroll'
  | 'two-player-order'
  | 'copycat-leader'
  | 'recover-trip';

export interface PendingDecision {
  playerId: string;
  kind: DecisionKind;
  prompt: string;
  promptEn: string;
  options: Array<{ value: string; label: string; labelEn: string }>;
  optional: boolean;
  roll?: number;
}

export interface GameState {
  roomCode: string;
  hostId: string;
  phase: Phase;
  players: PlayerState[];
  draftPool: string[];
  draftOrder: string[];
  draftIndex: number;
  draftDeck: string[];
  draftRound: number;
  raceNumber: number;
  track: TrackKind;
  selected: Record<string, string | null>;
  selectedSecond: Record<string, string | null>;
  racers: RacerState[];
  turnPlayerId: string | null;
  turnRacerId: string | null;
  turnRacerQueue: string[];
  turnOrder: string[];
  finishers: string[];
  raceStartPlayerId: string | null;
  raceStartScores: Record<string, number>;
  winnersByRace: string[];
  logs: LogEntry[];
  pendingDecision: PendingDecision | null;
  lastRoll: number | null;
  lastRollPlayerId: string | null;
  lastRollRacerId: string | null;
  rollSeq: number;
  nextLogId: number;
  rngSeed: number;
  demoMode: boolean;
  prediction: Record<string, string | number>;
  skippedTurns: Record<string, string | number>;
  turnFlags: Record<string, boolean>;
  eliminationOrder: string[];
  presentationGate: PresentationGate | null;
}

export type GameAction =
  | { type: 'START_GAME' }
  | { type: 'DRAFT'; racerId: string }
  | { type: 'SELECT_RACER'; racerId: string }
  | { type: 'ROLL' }
  | { type: 'USE_SPECIAL'; kind: DecisionKind }
  | { type: 'DECIDE'; value: string }
  | { type: 'ACK_PRESENTATION'; id: number }
  | { type: 'CONTINUE' };

export interface NetworkActionEnvelope {
  type: 'action';
  playerId: string;
  action: GameAction;
}

export interface GameView extends Omit<GameState, 'selected'> {
  selected: Record<string, string | null>;
  viewerId: string;
}

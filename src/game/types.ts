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
}

export interface LogEntry {
  id: number;
  text: string;
  tone?: 'normal' | 'power' | 'score' | 'warning';
}

export type DecisionKind =
  | 'genius-predict'
  | 'mastermind-predict'
  | 'flip-flop'
  | 'hypnotist'
  | 'third-wheel'
  | 'rocket-double'
  | 'magician-reroll'
  | 'dicemonger-reroll';

export interface PendingDecision {
  playerId: string;
  kind: DecisionKind;
  prompt: string;
  options: Array<{ value: string; label: string }>;
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
  raceNumber: number;
  track: TrackKind;
  selected: Record<string, string | null>;
  racers: RacerState[];
  turnPlayerId: string | null;
  turnOrder: string[];
  finishers: string[];
  previousLastPlayerId: string | null;
  winnersByRace: string[];
  logs: LogEntry[];
  pendingDecision: PendingDecision | null;
  lastRoll: number | null;
  nextLogId: number;
  rngSeed: number;
  demoMode: boolean;
  prediction: Record<string, string | number>;
  skippedTurns: Record<string, string | number>;
}

export type GameAction =
  | { type: 'START_GAME' }
  | { type: 'DRAFT'; racerId: string }
  | { type: 'SELECT_RACER'; racerId: string }
  | { type: 'ROLL' }
  | { type: 'USE_SPECIAL'; kind: DecisionKind }
  | { type: 'DECIDE'; value: string }
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

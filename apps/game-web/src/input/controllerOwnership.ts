export type ControllerPlayerSlot = 'P1' | 'P2';

export interface ControllerAssignments {
  P1: number | null;
  P2: number | null;
}

export interface ControllerOwnershipState {
  revision: number;
  activeControllerIndex: number | null;
  connectedControllerIndices: readonly number[];
  assignments: ControllerAssignments;
}

export interface ControllerDisconnectResult {
  controllerIndex: number;
  lostPlayers: readonly ControllerPlayerSlot[];
  activeControllerIndex: number | null;
}

export interface ControllerAssignmentResult {
  assigned: boolean;
  player: ControllerPlayerSlot;
  controllerIndex: number;
  displacedPlayer: ControllerPlayerSlot | null;
  previousControllerIndex: number | null;
}

export type ControllerOwnershipListener = (state: ControllerOwnershipState) => void;

const PLAYER_SLOTS: readonly ControllerPlayerSlot[] = ['P1', 'P2'];

function isControllerIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 0;
}

export class ControllerOwnership {
  private readonly connected = new Set<number>();
  private readonly listeners = new Set<ControllerOwnershipListener>();
  private readonly assignments: ControllerAssignments = { P1: null, P2: null };
  private activeControllerIndex: number | null = null;
  private revision = 0;

  connect(controllerIndex: number): boolean {
    if (!isControllerIndex(controllerIndex) || this.connected.has(controllerIndex)) {
      return false;
    }
    this.connected.add(controllerIndex);
    if (this.activeControllerIndex === null) {
      this.activeControllerIndex = controllerIndex;
    }
    this.publish();
    return true;
  }

  disconnect(controllerIndex: number): ControllerDisconnectResult {
    const lostPlayers = PLAYER_SLOTS.filter(
      (player) => this.assignments[player] === controllerIndex,
    );
    const changed = this.connected.delete(controllerIndex) || lostPlayers.length > 0;
    for (const player of lostPlayers) {
      this.assignments[player] = null;
    }
    if (this.activeControllerIndex === controllerIndex) {
      this.activeControllerIndex = this.resolveFallbackActiveController();
    }
    if (changed) {
      this.publish();
    }
    return {
      controllerIndex,
      lostPlayers,
      activeControllerIndex: this.activeControllerIndex,
    };
  }

  recordActivity(controllerIndex: number): boolean {
    if (!this.connected.has(controllerIndex)) {
      return false;
    }
    if (this.activeControllerIndex !== controllerIndex) {
      this.activeControllerIndex = controllerIndex;
      this.publish();
    }
    return true;
  }

  assign(player: ControllerPlayerSlot, controllerIndex: number): ControllerAssignmentResult {
    const previousControllerIndex = this.assignments[player];
    if (!this.connected.has(controllerIndex)) {
      return {
        assigned: false,
        player,
        controllerIndex,
        displacedPlayer: null,
        previousControllerIndex,
      };
    }
    const displacedPlayer = PLAYER_SLOTS.find(
      (candidate) => candidate !== player && this.assignments[candidate] === controllerIndex,
    ) ?? null;
    if (displacedPlayer) {
      this.assignments[displacedPlayer] = null;
    }
    const activeControllerChanged = this.activeControllerIndex !== controllerIndex;
    this.assignments[player] = controllerIndex;
    this.activeControllerIndex = controllerIndex;
    if (
      previousControllerIndex !== controllerIndex
      || displacedPlayer !== null
      || activeControllerChanged
    ) {
      this.publish();
    }
    return {
      assigned: true,
      player,
      controllerIndex,
      displacedPlayer,
      previousControllerIndex,
    };
  }

  claimAvailablePlayer(
    controllerIndex: number,
    preferredPlayer?: ControllerPlayerSlot,
  ): ControllerPlayerSlot | null {
    if (!this.connected.has(controllerIndex)) {
      return null;
    }
    const existingPlayer = PLAYER_SLOTS.find(
      (player) => this.assignments[player] === controllerIndex,
    );
    if (existingPlayer) {
      this.recordActivity(controllerIndex);
      return existingPlayer;
    }
    const availablePlayer = preferredPlayer && this.assignments[preferredPlayer] === null
      ? preferredPlayer
      : PLAYER_SLOTS.find((player) => this.assignments[player] === null) ?? null;
    if (!availablePlayer) {
      this.recordActivity(controllerIndex);
      return null;
    }
    this.assign(availablePlayer, controllerIndex);
    return availablePlayer;
  }

  releasePlayer(player: ControllerPlayerSlot): number | null {
    const controllerIndex = this.assignments[player];
    if (controllerIndex === null) {
      return null;
    }
    this.assignments[player] = null;
    this.publish();
    return controllerIndex;
  }

  getOwner(controllerIndex: number): ControllerPlayerSlot | null {
    return PLAYER_SLOTS.find((player) => this.assignments[player] === controllerIndex) ?? null;
  }

  getState(): ControllerOwnershipState {
    return {
      revision: this.revision,
      activeControllerIndex: this.activeControllerIndex,
      connectedControllerIndices: [...this.connected].sort((a, b) => a - b),
      assignments: { ...this.assignments },
    };
  }

  subscribe(listener: ControllerOwnershipListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private resolveFallbackActiveController(): number | null {
    for (const player of PLAYER_SLOTS) {
      const assignedIndex = this.assignments[player];
      if (assignedIndex !== null && this.connected.has(assignedIndex)) {
        return assignedIndex;
      }
    }
    return [...this.connected].sort((a, b) => a - b)[0] ?? null;
  }

  private publish(): void {
    this.revision += 1;
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}

export function createControllerOwnership(): ControllerOwnership {
  return new ControllerOwnership();
}

type OnlineDevSectionId = 'matchmaking' | 'rooms' | 'replay' | 'ranked';
type QueueType = 'unranked' | 'ranked';
type RegionId = 'us-east' | 'us-west' | 'eu-west' | 'ap-southeast';

interface OnlineDevMenuOptions {
  apiBase: string;
  getAccountId(): string | null;
  onClose(): void;
}

interface PadState {
  up: boolean;
  down: boolean;
  confirm: boolean;
  back: boolean;
  start: boolean;
}

interface OnlineDevSection {
  id: OnlineDevSectionId;
  title: string;
  summary: string;
  status: string;
}

interface MatchStartPayload {
  sessionId: string;
  sessionToken: string;
  sessionTokenExpiresAt: string;
  queueType: QueueType;
  region: RegionId;
  createdAt: string;
  expiresAt: string;
}

interface QueueTicketView {
  ticketId: string;
  accountId: string;
  queueType: QueueType;
  regionPreferences: RegionId[];
  status: 'queued' | 'matched' | 'closed';
  queuedAt: string;
  matchedAt?: string;
  closedAt?: string;
  closedReason?: string;
  matchStart?: MatchStartPayload;
}

interface MatchSessionParticipantView {
  accountId: string;
  side: 'P1' | 'P2';
  connectionStatus: 'connected' | 'disconnected';
  disconnectedAt?: string;
  reconnectDeadlineAt?: string;
}

interface MatchSessionView {
  sessionId: string;
  queueType: QueueType;
  region: RegionId;
  status: 'active' | 'resolved';
  resolvedReason?: string;
  reconnectGraceSeconds: number;
  createdAt: string;
  expiresAt: string;
  participants: MatchSessionParticipantView[];
}

interface RoomSettingsView {
  locked: boolean;
  allowSpectators: boolean;
  requiredRegion: string | null;
  requiredBuildVersion: string | null;
}

interface RoomParticipantView {
  accountId: string;
  platform: 'web' | 'steam';
  role: 'player' | 'spectator';
  joinedAt: string;
}

interface RoomActiveSessionView {
  sessionId: string;
  rematchIndex: number;
  phase: 'character_select' | 'ready_check' | 'in_match' | 'completed';
  startedAt: string;
  players: Array<{
    accountId: string;
    characterId: string | null;
    ready: boolean;
  }>;
}

interface RoomHistoryEntryView {
  matchId: string;
  rematchIndex: number;
  outcome: 'win' | 'draw' | 'forfeit';
  winnerAccountId: string | null;
  completedAt: string;
  players: Array<{
    accountId: string;
    characterId: string | null;
  }>;
}

interface RoomView {
  roomCode: string;
  hostAccountId: string;
  status: 'open' | 'active' | 'closed';
  createdAt: string;
  updatedAt: string;
  idleExpiresAt: string;
  settings: RoomSettingsView;
  participants: RoomParticipantView[];
  activeSession?: RoomActiveSessionView;
  history: RoomHistoryEntryView[];
}

interface RoomInviteView {
  roomCode: string;
  platform: 'web' | 'steam';
  flow: 'web_friend' | 'steam_friend';
  inviteValue: string;
}

const QUEUE_TYPES: QueueType[] = ['unranked', 'ranked'];
const REGION_IDS: RegionId[] = ['us-east', 'us-west', 'eu-west', 'ap-southeast'];

const SECTIONS: OnlineDevSection[] = [
  {
    id: 'matchmaking',
    title: 'Matchmaking',
    summary: 'Queue join/leave and ticket/session polling live in this section.',
    status: 'S2.22 ready',
  },
  {
    id: 'rooms',
    title: 'Rooms',
    summary: 'Create, join, and manage private room lifecycle from this panel.',
    status: 'S2.23 ready',
  },
  {
    id: 'replay',
    title: 'Replay',
    summary: 'Replay search and playback tools will appear here.',
    status: 'S2.24 target',
  },
  {
    id: 'ranked',
    title: 'Ranked',
    summary: 'Ranked progression inspection tools will appear here.',
    status: 'S2.25 target',
  },
];

function readButton(gamepad: Gamepad, index: number, threshold = 0.35): boolean {
  const button = gamepad.buttons[index];
  if (!button) {
    return false;
  }
  return button.pressed || button.value > threshold;
}

function readPadState(gamepad: Gamepad): PadState {
  const axisY = gamepad.axes[1] ?? 0;
  const threshold = 0.55;
  const dpadUp = readButton(gamepad, 12);
  const dpadDown = readButton(gamepad, 13);

  return {
    up: dpadUp || axisY < -threshold,
    down: dpadDown || axisY > threshold,
    confirm: readButton(gamepad, 0),
    back: readButton(gamepad, 1),
    start: readButton(gamepad, 9) || readButton(gamepad, 16),
  };
}

async function parseErrorMessage(response: Response): Promise<string> {
  const fallback = `Request failed (${response.status})`;
  try {
    const body = await response.json() as { error?: string; message?: string };
    return body.error ?? body.message ?? fallback;
  } catch {
    return fallback;
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export class OnlineDevMenu {
  private readonly root: HTMLDivElement;
  private readonly sectionButtons: HTMLButtonElement[] = [];
  private readonly detailTitle: HTMLHeadingElement;
  private readonly detailSummary: HTMLParagraphElement;
  private readonly detailStatus: HTMLParagraphElement;
  private readonly sectionBody: HTMLDivElement;
  private readonly prevPadStateByIndex = new Map<number, PadState>();
  private readonly queueSelect: HTMLSelectElement;
  private readonly regionInputs = new Map<RegionId, HTMLInputElement>();
  private readonly joinButton: HTMLButtonElement;
  private readonly leaveButton: HTMLButtonElement;
  private readonly pollButton: HTMLButtonElement;
  private readonly statusElement: HTMLDivElement;
  private readonly errorElement: HTMLDivElement;
  private readonly ticketOutput: HTMLPreElement;
  private readonly sessionOutput: HTMLPreElement;
  private readonly reconnectOutput: HTMLPreElement;
  private readonly matchmakingPanel: HTMLDivElement;
  private readonly roomsPanel: HTMLDivElement;
  private readonly roomCodeInput: HTMLInputElement;
  private readonly roomRegionInput: HTMLInputElement;
  private readonly roomBuildInput: HTMLInputElement;
  private readonly roomAllowSpectatorsInput: HTMLInputElement;
  private readonly roomJoinRoleSelect: HTMLSelectElement;
  private readonly createRoomButton: HTMLButtonElement;
  private readonly joinRoomButton: HTMLButtonElement;
  private readonly refreshRoomButton: HTMLButtonElement;
  private readonly toggleLockButton: HTMLButtonElement;
  private readonly toggleSpectatorsButton: HTMLButtonElement;
  private readonly startRoomButton: HTMLButtonElement;
  private readonly rematchButton: HTMLButtonElement;
  private readonly closeRoomButton: HTMLButtonElement;
  private readonly inviteWebButton: HTMLButtonElement;
  private readonly inviteSteamButton: HTMLButtonElement;
  private readonly roomStatusElement: HTMLDivElement;
  private readonly roomErrorElement: HTMLDivElement;
  private readonly roomOutput: HTMLPreElement;
  private readonly roomPhaseOutput: HTMLPreElement;
  private readonly roomInviteOutput: HTMLPreElement;
  private selectedIndex = 0;
  private rafId = 0;
  private pollIntervalId: number | null = null;
  private pendingMatchmakingRequest = false;
  private pendingRoomRequest = false;
  private ticket: QueueTicketView | null = null;
  private session: MatchSessionView | null = null;
  private room: RoomView | null = null;
  private invitePreview: { web: RoomInviteView | null; steam: RoomInviteView | null } = {
    web: null,
    steam: null,
  };
  private readonly buildVersion = '0.1.0-web';

  private readonly keydownHandler = (event: KeyboardEvent): void => {
    if (this.root.hidden) {
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.setSelectedIndex(this.selectedIndex - 1);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.setSelectedIndex(this.selectedIndex + 1);
      return;
    }
    if (event.key === 'Escape' || event.key === 'Backspace') {
      event.preventDefault();
      this.options.onClose();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.sectionButtons[this.selectedIndex]?.focus();
    }
  };

  public constructor(private readonly options: OnlineDevMenuOptions) {
    this.root = document.createElement('div');
    this.root.className = 'online-dev-menu';
    this.root.hidden = true;

    const panel = document.createElement('section');
    panel.className = 'online-dev-panel';
    this.root.appendChild(panel);

    const title = document.createElement('h2');
    title.textContent = 'Online Dev Menu';
    const subtitle = document.createElement('p');
    subtitle.textContent = 'Use this menu to test online backend flows quickly.';
    panel.append(title, subtitle);

    const shell = document.createElement('div');
    shell.className = 'online-dev-shell';
    panel.appendChild(shell);

    const list = document.createElement('div');
    list.className = 'online-dev-list';
    shell.appendChild(list);

    for (const [index, section] of SECTIONS.entries()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'online-dev-item';
      button.textContent = section.title;
      button.addEventListener('click', () => {
        this.setSelectedIndex(index);
      });
      list.appendChild(button);
      this.sectionButtons.push(button);
    }

    const detail = document.createElement('div');
    detail.className = 'online-dev-detail';
    shell.appendChild(detail);

    this.detailTitle = document.createElement('h3');
    this.detailSummary = document.createElement('p');
    this.detailStatus = document.createElement('p');
    this.detailStatus.className = 'online-dev-detail-status';
    this.sectionBody = document.createElement('div');
    this.sectionBody.className = 'online-dev-section-body';
    detail.append(this.detailTitle, this.detailSummary, this.detailStatus, this.sectionBody);

    this.matchmakingPanel = document.createElement('div');
    this.matchmakingPanel.className = 'online-dev-matchmaking';
    this.matchmakingPanel.hidden = true;

    const controlGrid = document.createElement('div');
    controlGrid.className = 'online-dev-controls';
    this.matchmakingPanel.appendChild(controlGrid);

    const queueLabel = document.createElement('label');
    queueLabel.className = 'online-dev-control';
    queueLabel.textContent = 'Queue';
    this.queueSelect = document.createElement('select');
    for (const queueType of QUEUE_TYPES) {
      const option = document.createElement('option');
      option.value = queueType;
      option.textContent = queueType;
      this.queueSelect.appendChild(option);
    }
    queueLabel.appendChild(this.queueSelect);
    controlGrid.appendChild(queueLabel);

    const regionsGroup = document.createElement('div');
    regionsGroup.className = 'online-dev-control';
    const regionsTitle = document.createElement('span');
    regionsTitle.textContent = 'Regions';
    regionsGroup.appendChild(regionsTitle);
    const regionsList = document.createElement('div');
    regionsList.className = 'online-dev-region-list';
    for (const region of REGION_IDS) {
      const regionLabel = document.createElement('label');
      regionLabel.className = 'online-dev-region-item';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = region === 'us-east';
      this.regionInputs.set(region, input);
      const text = document.createElement('span');
      text.textContent = region;
      regionLabel.append(input, text);
      regionsList.appendChild(regionLabel);
    }
    regionsGroup.appendChild(regionsList);
    controlGrid.appendChild(regionsGroup);

    const actions = document.createElement('div');
    actions.className = 'online-dev-actions';
    this.joinButton = document.createElement('button');
    this.joinButton.type = 'button';
    this.joinButton.className = 'online-dev-action';
    this.joinButton.textContent = 'Join Queue';
    this.joinButton.addEventListener('click', () => {
      void this.joinQueue();
    });
    actions.appendChild(this.joinButton);

    this.leaveButton = document.createElement('button');
    this.leaveButton.type = 'button';
    this.leaveButton.className = 'online-dev-action';
    this.leaveButton.textContent = 'Leave Queue';
    this.leaveButton.addEventListener('click', () => {
      void this.leaveQueue();
    });
    actions.appendChild(this.leaveButton);

    this.pollButton = document.createElement('button');
    this.pollButton.type = 'button';
    this.pollButton.className = 'online-dev-action';
    this.pollButton.textContent = 'Poll Now';
    this.pollButton.addEventListener('click', () => {
      void this.pollQueueAndSession();
    });
    actions.appendChild(this.pollButton);
    this.matchmakingPanel.appendChild(actions);

    this.statusElement = document.createElement('div');
    this.statusElement.className = 'online-dev-status';
    this.statusElement.textContent = 'Ready.';
    this.matchmakingPanel.appendChild(this.statusElement);

    this.errorElement = document.createElement('div');
    this.errorElement.className = 'online-dev-error';
    this.errorElement.hidden = true;
    this.matchmakingPanel.appendChild(this.errorElement);

    const outputs = document.createElement('div');
    outputs.className = 'online-dev-outputs';
    this.matchmakingPanel.appendChild(outputs);

    const ticketPanel = this.createOutputPanel('Ticket state');
    this.ticketOutput = ticketPanel.output;
    outputs.appendChild(ticketPanel.root);

    const sessionPanel = this.createOutputPanel('Session state');
    this.sessionOutput = sessionPanel.output;
    outputs.appendChild(sessionPanel.root);

    const reconnectPanel = this.createOutputPanel('Reconnect debug');
    this.reconnectOutput = reconnectPanel.output;
    outputs.appendChild(reconnectPanel.root);

    this.roomsPanel = document.createElement('div');
    this.roomsPanel.className = 'online-dev-rooms';
    this.roomsPanel.hidden = true;

    const roomsControlGrid = document.createElement('div');
    roomsControlGrid.className = 'online-dev-controls';
    this.roomsPanel.appendChild(roomsControlGrid);

    const roomCodeLabel = document.createElement('label');
    roomCodeLabel.className = 'online-dev-control';
    roomCodeLabel.textContent = 'Room code';
    this.roomCodeInput = document.createElement('input');
    this.roomCodeInput.type = 'text';
    this.roomCodeInput.placeholder = 'AB12CD';
    this.roomCodeInput.maxLength = 12;
    this.roomCodeInput.addEventListener('input', () => {
      this.updateRoomControlState();
    });
    roomCodeLabel.appendChild(this.roomCodeInput);
    roomsControlGrid.appendChild(roomCodeLabel);

    const roomRegionLabel = document.createElement('label');
    roomRegionLabel.className = 'online-dev-control';
    roomRegionLabel.textContent = 'Region (create or join)';
    this.roomRegionInput = document.createElement('input');
    this.roomRegionInput.type = 'text';
    this.roomRegionInput.placeholder = 'us-east';
    roomRegionLabel.appendChild(this.roomRegionInput);
    roomsControlGrid.appendChild(roomRegionLabel);

    const roomBuildLabel = document.createElement('label');
    roomBuildLabel.className = 'online-dev-control';
    roomBuildLabel.textContent = 'Build version (create or join)';
    this.roomBuildInput = document.createElement('input');
    this.roomBuildInput.type = 'text';
    this.roomBuildInput.value = this.buildVersion;
    roomBuildLabel.appendChild(this.roomBuildInput);
    roomsControlGrid.appendChild(roomBuildLabel);

    const roomCreateSettingsLabel = document.createElement('label');
    roomCreateSettingsLabel.className = 'online-dev-control';
    roomCreateSettingsLabel.textContent = 'Create settings';
    const roomCreateSettingsRow = document.createElement('div');
    roomCreateSettingsRow.className = 'online-dev-inline';
    this.roomAllowSpectatorsInput = document.createElement('input');
    this.roomAllowSpectatorsInput.type = 'checkbox';
    const allowSpectatorsText = document.createElement('span');
    allowSpectatorsText.textContent = 'Allow spectators';
    roomCreateSettingsRow.append(this.roomAllowSpectatorsInput, allowSpectatorsText);
    roomCreateSettingsLabel.appendChild(roomCreateSettingsRow);
    roomsControlGrid.appendChild(roomCreateSettingsLabel);

    const roomJoinRoleLabel = document.createElement('label');
    roomJoinRoleLabel.className = 'online-dev-control';
    roomJoinRoleLabel.textContent = 'Join role';
    this.roomJoinRoleSelect = document.createElement('select');
    for (const role of ['player', 'spectator']) {
      const option = document.createElement('option');
      option.value = role;
      option.textContent = role;
      this.roomJoinRoleSelect.appendChild(option);
    }
    roomJoinRoleLabel.appendChild(this.roomJoinRoleSelect);
    roomsControlGrid.appendChild(roomJoinRoleLabel);

    const roomActions = document.createElement('div');
    roomActions.className = 'online-dev-actions';

    this.createRoomButton = this.createRoomActionButton('Create Room', () => {
      void this.createRoom();
    });
    roomActions.appendChild(this.createRoomButton);

    this.joinRoomButton = this.createRoomActionButton('Join Room', () => {
      void this.joinRoom();
    });
    roomActions.appendChild(this.joinRoomButton);

    this.refreshRoomButton = this.createRoomActionButton('Refresh', () => {
      void this.refreshRoom();
    });
    roomActions.appendChild(this.refreshRoomButton);

    this.toggleLockButton = this.createRoomActionButton('Toggle Lock', () => {
      void this.toggleRoomLock();
    });
    roomActions.appendChild(this.toggleLockButton);

    this.toggleSpectatorsButton = this.createRoomActionButton('Toggle Spectators', () => {
      void this.toggleRoomSpectators();
    });
    roomActions.appendChild(this.toggleSpectatorsButton);

    this.startRoomButton = this.createRoomActionButton('Start Session', () => {
      void this.startRoomSession();
    });
    roomActions.appendChild(this.startRoomButton);

    this.rematchButton = this.createRoomActionButton('Rematch', () => {
      void this.startRoomRematch();
    });
    roomActions.appendChild(this.rematchButton);

    this.closeRoomButton = this.createRoomActionButton('Close Room', () => {
      void this.closeRoom();
    });
    roomActions.appendChild(this.closeRoomButton);

    this.inviteWebButton = this.createRoomActionButton('Invite Preview (Web)', () => {
      void this.fetchInvite('web');
    });
    roomActions.appendChild(this.inviteWebButton);

    this.inviteSteamButton = this.createRoomActionButton('Invite Preview (Steam)', () => {
      void this.fetchInvite('steam');
    });
    roomActions.appendChild(this.inviteSteamButton);

    this.roomsPanel.appendChild(roomActions);

    this.roomStatusElement = document.createElement('div');
    this.roomStatusElement.className = 'online-dev-status';
    this.roomStatusElement.textContent = 'Ready.';
    this.roomsPanel.appendChild(this.roomStatusElement);

    this.roomErrorElement = document.createElement('div');
    this.roomErrorElement.className = 'online-dev-error';
    this.roomErrorElement.hidden = true;
    this.roomsPanel.appendChild(this.roomErrorElement);

    const roomOutputs = document.createElement('div');
    roomOutputs.className = 'online-dev-outputs';
    this.roomsPanel.appendChild(roomOutputs);

    const roomStatePanel = this.createOutputPanel('Room state');
    this.roomOutput = roomStatePanel.output;
    roomOutputs.appendChild(roomStatePanel.root);

    const roomPhasePanel = this.createOutputPanel('Room phase and history');
    this.roomPhaseOutput = roomPhasePanel.output;
    roomOutputs.appendChild(roomPhasePanel.root);

    const roomInvitePanel = this.createOutputPanel('Invite payload preview');
    this.roomInviteOutput = roomInvitePanel.output;
    roomOutputs.appendChild(roomInvitePanel.root);

    this.sectionBody.append(this.matchmakingPanel, this.roomsPanel);

    const hint = document.createElement('p');
    hint.className = 'online-dev-hint';
    hint.textContent = 'Controls: Up/Down or D-pad to switch section. Esc/B to close.';
    panel.appendChild(hint);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'online-dev-close';
    closeButton.textContent = 'Back to Home';
    closeButton.addEventListener('click', () => this.options.onClose());
    panel.appendChild(closeButton);

    document.body.appendChild(this.root);
    this.setSelectedIndex(0);
    this.renderMatchmakingData();
    this.renderRoomData();
    this.updateRoomControlState();
    window.addEventListener('keydown', this.keydownHandler);
    this.pollGamepads();
  }

  public show(): void {
    this.root.hidden = false;
    this.prevPadStateByIndex.clear();
    this.setSelectedIndex(this.selectedIndex);
    this.ensurePolling();
  }

  public hide(): void {
    this.root.hidden = true;
    this.prevPadStateByIndex.clear();
    this.stopPolling();
  }

  public dispose(): void {
    if (this.rafId) {
      window.cancelAnimationFrame(this.rafId);
    }
    this.stopPolling();
    window.removeEventListener('keydown', this.keydownHandler);
    this.root.remove();
  }

  private createOutputPanel(title: string): { root: HTMLDivElement; output: HTMLPreElement } {
    const root = document.createElement('div');
    root.className = 'online-dev-output';
    const heading = document.createElement('h4');
    heading.textContent = title;
    const output = document.createElement('pre');
    output.textContent = '-';
    root.append(heading, output);
    return { root, output };
  }

  private createRoomActionButton(label: string, handler: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'online-dev-action';
    button.textContent = label;
    button.addEventListener('click', handler);
    return button;
  }

  private setSelectedIndex(index: number): void {
    const max = SECTIONS.length - 1;
    const next = Math.max(0, Math.min(max, index));
    this.selectedIndex = next;
    const section = SECTIONS[next];

    for (let i = 0; i < this.sectionButtons.length; i += 1) {
      this.sectionButtons[i].classList.toggle('active', i === next);
    }

    this.detailTitle.textContent = section.title;
    this.detailSummary.textContent = section.summary;
    this.detailStatus.textContent = section.status;
    this.matchmakingPanel.hidden = section.id !== 'matchmaking';
    this.roomsPanel.hidden = section.id !== 'rooms';
  }

  private getSelectedRegions(): RegionId[] {
    const regions: RegionId[] = [];
    for (const region of REGION_IDS) {
      if (this.regionInputs.get(region)?.checked) {
        regions.push(region);
      }
    }
    return regions;
  }

  private getAccountIdOrError(): string | null {
    const accountId = this.options.getAccountId();
    if (!accountId) {
      this.setError('Missing account id. Profile bootstrap has not completed.');
      return null;
    }
    return accountId;
  }

  private setError(message: string | null): void {
    if (!message) {
      this.errorElement.hidden = true;
      this.errorElement.textContent = '';
      return;
    }
    this.errorElement.hidden = false;
    this.errorElement.textContent = message;
  }

  private setStatus(message: string): void {
    this.statusElement.textContent = message;
  }

  private setRoomError(message: string | null): void {
    if (!message) {
      this.roomErrorElement.hidden = true;
      this.roomErrorElement.textContent = '';
      return;
    }
    this.roomErrorElement.hidden = false;
    this.roomErrorElement.textContent = message;
  }

  private setRoomStatus(message: string): void {
    this.roomStatusElement.textContent = message;
  }

  private updateControlState(): void {
    const hasTicket = this.ticket !== null;
    this.joinButton.disabled = this.pendingMatchmakingRequest;
    this.leaveButton.disabled = this.pendingMatchmakingRequest || !hasTicket;
    this.pollButton.disabled = this.pendingMatchmakingRequest || !hasTicket;
    this.queueSelect.disabled = this.pendingMatchmakingRequest;
    for (const input of this.regionInputs.values()) {
      input.disabled = this.pendingMatchmakingRequest;
    }
  }

  private updateRoomControlState(): void {
    const hasRoomCode = this.resolveRoomCode() !== null;
    const hasRoom = this.room !== null;
    const busy = this.pendingRoomRequest;
    this.roomCodeInput.disabled = busy;
    this.roomRegionInput.disabled = busy;
    this.roomBuildInput.disabled = busy;
    this.roomAllowSpectatorsInput.disabled = busy;
    this.roomJoinRoleSelect.disabled = busy;

    this.createRoomButton.disabled = busy;
    this.joinRoomButton.disabled = busy || !hasRoomCode;
    this.refreshRoomButton.disabled = busy || !hasRoomCode;
    this.toggleLockButton.disabled = busy || !hasRoom;
    this.toggleSpectatorsButton.disabled = busy || !hasRoom;
    this.startRoomButton.disabled = busy || !hasRoomCode;
    this.rematchButton.disabled = busy || !hasRoomCode;
    this.closeRoomButton.disabled = busy || !hasRoomCode;
    this.inviteWebButton.disabled = busy || !hasRoomCode;
    this.inviteSteamButton.disabled = busy || !hasRoomCode;
  }

  private renderMatchmakingData(): void {
    this.ticketOutput.textContent = this.ticket ? stableStringify(this.ticket) : '-';
    this.sessionOutput.textContent = this.session ? stableStringify(this.session) : '-';

    const reconnectData = {
      sessionToken: this.ticket?.matchStart?.sessionToken ?? null,
      sessionTokenExpiresAt: this.ticket?.matchStart?.sessionTokenExpiresAt ?? null,
      reconnectGraceSeconds: this.session?.reconnectGraceSeconds ?? null,
      participantConnectionState: this.session?.participants ?? [],
    };
    this.reconnectOutput.textContent = stableStringify(reconnectData);
  }

  private renderRoomData(): void {
    this.roomOutput.textContent = this.room ? stableStringify(this.room) : '-';
    this.roomPhaseOutput.textContent = stableStringify({
      status: this.room?.status ?? null,
      activePhase: this.room?.activeSession?.phase ?? null,
      rematchIndex: this.room?.activeSession?.rematchIndex ?? null,
      history: this.room?.history ?? [],
    });
    this.roomInviteOutput.textContent = stableStringify(this.invitePreview);
    if (this.room?.roomCode) {
      this.roomCodeInput.value = this.room.roomCode;
    }
  }

  private async runMatchmakingAction(action: () => Promise<void>): Promise<void> {
    if (this.pendingMatchmakingRequest) {
      return;
    }
    this.pendingMatchmakingRequest = true;
    this.setError(null);
    this.updateControlState();
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected request failure.';
      this.setError(message);
    } finally {
      this.pendingMatchmakingRequest = false;
      this.updateControlState();
      this.renderMatchmakingData();
    }
  }

  private async runRoomAction(action: () => Promise<void>): Promise<void> {
    if (this.pendingRoomRequest) {
      return;
    }
    this.pendingRoomRequest = true;
    this.setRoomError(null);
    this.updateRoomControlState();
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected request failure.';
      this.setRoomError(message);
    } finally {
      this.pendingRoomRequest = false;
      this.updateRoomControlState();
      this.renderRoomData();
    }
  }

  private async requestJson<T>(
    method: 'GET' | 'POST',
    path: string,
    accountId: string,
    body?: unknown,
  ): Promise<T> {
    const apiBase = this.options.apiBase.trim();
    if (!apiBase) {
      throw new Error('Missing VITE_MATCHMAKING_API_BASE for Online Dev matchmaking panel.');
    }

    const headers: Record<string, string> = {
      'x-account-id': accountId,
    };
    let payload: string | undefined;
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const response = await fetch(`${apiBase}${path}`, {
      method,
      headers,
      body: payload,
    });
    if (!response.ok) {
      const errorMessage = await parseErrorMessage(response);
      throw new Error(errorMessage);
    }
    return await response.json() as T;
  }

  private ensurePolling(): void {
    if (!this.ticket || this.pollIntervalId !== null) {
      return;
    }
    this.pollIntervalId = window.setInterval(() => {
      if (this.root.hidden) {
        return;
      }
      void this.pollQueueAndSession();
    }, 2000);
  }

  private stopPolling(): void {
    if (this.pollIntervalId !== null) {
      window.clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
  }

  private async joinQueue(): Promise<void> {
    await this.runMatchmakingAction(async () => {
      const accountId = this.getAccountIdOrError();
      if (!accountId) {
        return;
      }
      const regionPreferences = this.getSelectedRegions();
      if (regionPreferences.length === 0) {
        throw new Error('Select at least one region before joining queue.');
      }
      const queueType = this.queueSelect.value as QueueType;
      const joined = await this.requestJson<QueueTicketView>(
        'POST',
        '/matchmaking/queue/join',
        accountId,
        {
          queueType,
          regionPreferences,
          buildVersion: this.buildVersion,
          platform: 'web',
        },
      );
      this.ticket = joined;
      this.session = null;
      this.setStatus(`Joined ${queueType} queue. Ticket: ${joined.ticketId}`);
      await this.pollQueueAndSessionInternal();
      this.ensurePolling();
    });
  }

  private async leaveQueue(): Promise<void> {
    await this.runMatchmakingAction(async () => {
      const accountId = this.getAccountIdOrError();
      if (!accountId || !this.ticket) {
        return;
      }
      const ticketId = this.ticket.ticketId;
      const left = await this.requestJson<QueueTicketView>(
        'POST',
        '/matchmaking/queue/leave',
        accountId,
        {
          ticketId,
        },
      );
      this.ticket = left;
      this.session = null;
      this.setStatus(`Left queue. Ticket status: ${left.status}`);
      if (left.status === 'closed') {
        this.stopPolling();
      }
    });
  }

  private async pollQueueAndSession(): Promise<void> {
    await this.runMatchmakingAction(async () => {
      await this.pollQueueAndSessionInternal();
    });
  }

  private async pollQueueAndSessionInternal(): Promise<void> {
    const accountId = this.getAccountIdOrError();
    if (!accountId || !this.ticket) {
      return;
    }

    const ticket = await this.requestJson<QueueTicketView>(
      'GET',
      `/matchmaking/queue/tickets/${this.ticket.ticketId}`,
      accountId,
    );
    this.ticket = ticket;

    if (ticket.matchStart?.sessionId) {
      this.session = await this.requestJson<MatchSessionView>(
        'GET',
        `/matchmaking/sessions/${ticket.matchStart.sessionId}`,
        accountId,
      );
    } else {
      this.session = null;
    }

    this.setStatus(`Polled ticket ${ticket.ticketId}: ${ticket.status}`);
    if (ticket.status === 'closed') {
      this.stopPolling();
    } else {
      this.ensurePolling();
    }
  }

  private resolveRoomCode(): string | null {
    const raw = this.roomCodeInput.value.trim().toUpperCase();
    return raw.length > 0 ? raw : null;
  }

  private resolveRoomRegion(): string | null {
    const raw = this.roomRegionInput.value.trim().toLowerCase();
    return raw.length > 0 ? raw : null;
  }

  private resolveBuildVersion(): string | null {
    const raw = this.roomBuildInput.value.trim();
    return raw.length > 0 ? raw : null;
  }

  private async createRoom(): Promise<void> {
    await this.runRoomAction(async () => {
      const accountId = this.options.getAccountId();
      if (!accountId) {
        this.setRoomError('Missing account id. Profile bootstrap has not completed.');
        return;
      }
      const room = await this.requestJson<RoomView>(
        'POST',
        '/rooms',
        accountId,
        {
          platform: 'web',
          requiredRegion: this.resolveRoomRegion(),
          buildVersion: this.resolveBuildVersion(),
          allowSpectators: this.roomAllowSpectatorsInput.checked,
        },
      );
      this.room = room;
      this.invitePreview = { web: null, steam: null };
      this.setRoomStatus(`Created room ${room.roomCode}.`);
    });
  }

  private async joinRoom(): Promise<void> {
    await this.runRoomAction(async () => {
      const accountId = this.options.getAccountId();
      const roomCode = this.resolveRoomCode();
      if (!accountId) {
        this.setRoomError('Missing account id. Profile bootstrap has not completed.');
        return;
      }
      if (!roomCode) {
        throw new Error('Room code is required to join.');
      }
      const room = await this.requestJson<RoomView>(
        'POST',
        `/rooms/${roomCode}/join`,
        accountId,
        {
          platform: 'web',
          role: this.roomJoinRoleSelect.value,
          region: this.resolveRoomRegion(),
          buildVersion: this.resolveBuildVersion(),
        },
      );
      this.room = room;
      this.setRoomStatus(`Joined room ${roomCode} as ${this.roomJoinRoleSelect.value}.`);
    });
  }

  private async refreshRoom(): Promise<void> {
    await this.runRoomAction(async () => {
      const accountId = this.options.getAccountId();
      const roomCode = this.resolveRoomCode();
      if (!accountId) {
        this.setRoomError('Missing account id. Profile bootstrap has not completed.');
        return;
      }
      if (!roomCode) {
        throw new Error('Room code is required to refresh.');
      }
      this.room = await this.requestJson<RoomView>('GET', `/rooms/${roomCode}`, accountId);
      this.setRoomStatus(`Refreshed room ${roomCode}.`);
    });
  }

  private async toggleRoomLock(): Promise<void> {
    await this.runRoomAction(async () => {
      const accountId = this.options.getAccountId();
      const roomCode = this.room?.roomCode ?? this.resolveRoomCode();
      if (!accountId) {
        this.setRoomError('Missing account id. Profile bootstrap has not completed.');
        return;
      }
      if (!roomCode || !this.room) {
        throw new Error('Load a room first before toggling lock.');
      }
      this.room = await this.requestJson<RoomView>(
        'POST',
        `/rooms/${roomCode}/settings`,
        accountId,
        {
          locked: !this.room.settings.locked,
        },
      );
      this.setRoomStatus(`Lock updated: ${this.room.settings.locked}.`);
    });
  }

  private async toggleRoomSpectators(): Promise<void> {
    await this.runRoomAction(async () => {
      const accountId = this.options.getAccountId();
      const roomCode = this.room?.roomCode ?? this.resolveRoomCode();
      if (!accountId) {
        this.setRoomError('Missing account id. Profile bootstrap has not completed.');
        return;
      }
      if (!roomCode || !this.room) {
        throw new Error('Load a room first before toggling spectators.');
      }
      this.room = await this.requestJson<RoomView>(
        'POST',
        `/rooms/${roomCode}/settings`,
        accountId,
        {
          allowSpectators: !this.room.settings.allowSpectators,
        },
      );
      this.setRoomStatus(`Spectators updated: ${this.room.settings.allowSpectators}.`);
    });
  }

  private async startRoomSession(): Promise<void> {
    await this.runRoomAction(async () => {
      const accountId = this.options.getAccountId();
      const roomCode = this.room?.roomCode ?? this.resolveRoomCode();
      if (!accountId) {
        this.setRoomError('Missing account id. Profile bootstrap has not completed.');
        return;
      }
      if (!roomCode) {
        throw new Error('Room code is required to start session.');
      }
      this.room = await this.requestJson<RoomView>('POST', `/rooms/${roomCode}/start`, accountId);
      this.setRoomStatus(`Started room session for ${roomCode}.`);
    });
  }

  private async startRoomRematch(): Promise<void> {
    await this.runRoomAction(async () => {
      const accountId = this.options.getAccountId();
      const roomCode = this.room?.roomCode ?? this.resolveRoomCode();
      if (!accountId) {
        this.setRoomError('Missing account id. Profile bootstrap has not completed.');
        return;
      }
      if (!roomCode) {
        throw new Error('Room code is required to start rematch.');
      }
      this.room = await this.requestJson<RoomView>('POST', `/rooms/${roomCode}/rematch`, accountId);
      this.setRoomStatus(`Started rematch for ${roomCode}.`);
    });
  }

  private async closeRoom(): Promise<void> {
    await this.runRoomAction(async () => {
      const accountId = this.options.getAccountId();
      const roomCode = this.room?.roomCode ?? this.resolveRoomCode();
      if (!accountId) {
        this.setRoomError('Missing account id. Profile bootstrap has not completed.');
        return;
      }
      if (!roomCode) {
        throw new Error('Room code is required to close room.');
      }
      this.room = await this.requestJson<RoomView>('POST', `/rooms/${roomCode}/close`, accountId);
      this.setRoomStatus(`Closed room ${roomCode}.`);
    });
  }

  private async fetchInvite(platform: 'web' | 'steam'): Promise<void> {
    await this.runRoomAction(async () => {
      const accountId = this.options.getAccountId();
      const roomCode = this.room?.roomCode ?? this.resolveRoomCode();
      if (!accountId) {
        this.setRoomError('Missing account id. Profile bootstrap has not completed.');
        return;
      }
      if (!roomCode) {
        throw new Error('Room code is required to fetch invite payload.');
      }
      const invite = await this.requestJson<RoomInviteView>(
        'GET',
        `/rooms/${roomCode}/invite?platform=${platform}`,
        accountId,
      );
      this.invitePreview = {
        ...this.invitePreview,
        [platform]: invite,
      };
      this.setRoomStatus(`Fetched ${platform} invite payload for ${roomCode}.`);
    });
  }

  private wasPressed(padIndex: number, state: PadState, key: keyof PadState): boolean {
    const previous = this.prevPadStateByIndex.get(padIndex);
    return state[key] && !previous?.[key];
  }

  private pollGamepads = (): void => {
    if (!this.root.hidden && navigator.getGamepads) {
      const pads = navigator.getGamepads();
      for (let i = 0; i < pads.length; i += 1) {
        const pad = pads[i];
        if (!pad) {
          continue;
        }
        const state = readPadState(pad);
        if (this.wasPressed(pad.index, state, 'up')) {
          this.setSelectedIndex(this.selectedIndex - 1);
        }
        if (this.wasPressed(pad.index, state, 'down')) {
          this.setSelectedIndex(this.selectedIndex + 1);
        }
        if (this.wasPressed(pad.index, state, 'back') || this.wasPressed(pad.index, state, 'start')) {
          this.options.onClose();
        }
        if (this.wasPressed(pad.index, state, 'confirm')) {
          this.sectionButtons[this.selectedIndex]?.focus();
        }
        this.prevPadStateByIndex.set(pad.index, state);
      }
    }

    this.rafId = window.requestAnimationFrame(this.pollGamepads);
  };
}

export function createOnlineDevMenu(options: OnlineDevMenuOptions): OnlineDevMenu {
  return new OnlineDevMenu(options);
}

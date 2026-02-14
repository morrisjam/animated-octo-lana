type OnlineDevSectionId = 'matchmaking' | 'rooms' | 'replay' | 'ranked';
type QueueType = 'unranked' | 'ranked';
type RegionId = 'us-east' | 'us-west' | 'eu-west' | 'ap-southeast';

interface OnlineDevMenuOptions {
  apiBase: string;
  getAccountId(): string | null;
  onOpenReplayPayload(options: { replayId: string; payload: unknown }): Promise<void> | void;
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

interface ReplayParticipantView {
  accountId: string;
  side: 'P1' | 'P2';
  characterId: string;
  result: 'win' | 'loss' | 'draw' | 'forfeit' | string;
}

interface ReplaySearchItemView {
  replayId: string;
  matchId: string;
  queueType: QueueType | string;
  matchType: string;
  region: string;
  patchVersion: string;
  rulesetVersion: string;
  payloadVersion: number;
  outcome: string;
  winnerAccountId: string | null;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  player: ReplayParticipantView;
  opponent: ReplayParticipantView;
}

interface ReplaySearchResponseView {
  items: ReplaySearchItemView[];
  nextCursor: string | null;
  page: {
    limit: number;
    returned: number;
  };
}

interface ReplayPayloadResponseView {
  replayId: string;
  payload: unknown;
}

interface ReplaySearchFiltersInput {
  playerId: string;
  opponentId: string | null;
  character: string | null;
  matchup: string | null;
  queueType: QueueType | null;
  from: string | null;
  to: string | null;
  patchVersion: string | null;
  limit: number;
}

interface RankedMatchDeltaView {
  matchId: string | null;
  queueType: string | null;
  result: string | null;
  preRating: number | null;
  postRating: number | null;
  preLeaguePoints: number | null;
  postLeaguePoints: number | null;
  preMrPoints: number | null;
  postMrPoints: number | null;
  occurredAt: string | null;
}

interface RankedProgressionView {
  source: 'ranked_api' | 'profile_settings' | 'unavailable';
  seasonId: string | null;
  rating: number | null;
  leagueTier: string | null;
  leaguePoints: number | null;
  mrPoints: number | null;
  provisional: boolean | null;
  updatedAt: string | null;
  recentDeltas: RankedMatchDeltaView[];
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
    summary: 'Search replay archive and launch replay review from payload fetches.',
    status: 'S2.24 ready',
  },
  {
    id: 'ranked',
    title: 'Ranked',
    summary: 'Inspect ranked progression and recent result deltas from API or profile fallback.',
    status: 'S2.25 ready',
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
  private readonly replayPanel: HTMLDivElement;
  private readonly replayPlayerInput: HTMLInputElement;
  private readonly replayOpponentInput: HTMLInputElement;
  private readonly replayCharacterInput: HTMLInputElement;
  private readonly replayMatchupInput: HTMLInputElement;
  private readonly replayQueueSelect: HTMLSelectElement;
  private readonly replayFromInput: HTMLInputElement;
  private readonly replayToInput: HTMLInputElement;
  private readonly replayPatchInput: HTMLInputElement;
  private readonly replaySearchButton: HTMLButtonElement;
  private readonly replayNextButton: HTMLButtonElement;
  private readonly replayClearButton: HTMLButtonElement;
  private readonly replayStatusElement: HTMLDivElement;
  private readonly replayErrorElement: HTMLDivElement;
  private readonly replayResults: HTMLDivElement;
  private readonly replayCursorOutput: HTMLPreElement;
  private readonly rankedPanel: HTMLDivElement;
  private readonly rankedSeasonInput: HTMLInputElement;
  private readonly rankedRefreshButton: HTMLButtonElement;
  private readonly rankedStatusElement: HTMLDivElement;
  private readonly rankedErrorElement: HTMLDivElement;
  private readonly rankedProgressOutput: HTMLPreElement;
  private readonly rankedDeltaOutput: HTMLPreElement;
  private selectedIndex = 0;
  private rafId = 0;
  private pollIntervalId: number | null = null;
  private pendingMatchmakingRequest = false;
  private pendingRoomRequest = false;
  private pendingReplayRequest = false;
  private pendingRankedRequest = false;
  private ticket: QueueTicketView | null = null;
  private session: MatchSessionView | null = null;
  private room: RoomView | null = null;
  private replayItems: ReplaySearchItemView[] = [];
  private replayNextCursor: string | null = null;
  private replayActiveFilters: ReplaySearchFiltersInput | null = null;
  private rankedProgression: RankedProgressionView | null = null;
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

    this.replayPanel = document.createElement('div');
    this.replayPanel.className = 'online-dev-replay';
    this.replayPanel.hidden = true;

    const replayControlGrid = document.createElement('div');
    replayControlGrid.className = 'online-dev-controls';
    this.replayPanel.appendChild(replayControlGrid);

    const replayPlayerLabel = document.createElement('label');
    replayPlayerLabel.className = 'online-dev-control';
    replayPlayerLabel.textContent = 'Player account id';
    this.replayPlayerInput = document.createElement('input');
    this.replayPlayerInput.type = 'text';
    this.replayPlayerInput.placeholder = 'Defaults to authenticated account';
    replayPlayerLabel.appendChild(this.replayPlayerInput);
    replayControlGrid.appendChild(replayPlayerLabel);

    const replayOpponentLabel = document.createElement('label');
    replayOpponentLabel.className = 'online-dev-control';
    replayOpponentLabel.textContent = 'Opponent account id';
    this.replayOpponentInput = document.createElement('input');
    this.replayOpponentInput.type = 'text';
    this.replayOpponentInput.placeholder = 'Optional UUID filter';
    replayOpponentLabel.appendChild(this.replayOpponentInput);
    replayControlGrid.appendChild(replayOpponentLabel);

    const replayCharacterLabel = document.createElement('label');
    replayCharacterLabel.className = 'online-dev-control';
    replayCharacterLabel.textContent = 'Character id';
    this.replayCharacterInput = document.createElement('input');
    this.replayCharacterInput.type = 'text';
    this.replayCharacterInput.placeholder = 'Optional';
    replayCharacterLabel.appendChild(this.replayCharacterInput);
    replayControlGrid.appendChild(replayCharacterLabel);

    const replayMatchupLabel = document.createElement('label');
    replayMatchupLabel.className = 'online-dev-control';
    replayMatchupLabel.textContent = 'Matchup filter';
    this.replayMatchupInput = document.createElement('input');
    this.replayMatchupInput.type = 'text';
    this.replayMatchupInput.placeholder = 'format: player:opponent';
    replayMatchupLabel.appendChild(this.replayMatchupInput);
    replayControlGrid.appendChild(replayMatchupLabel);

    const replayQueueLabel = document.createElement('label');
    replayQueueLabel.className = 'online-dev-control';
    replayQueueLabel.textContent = 'Queue type';
    this.replayQueueSelect = document.createElement('select');
    for (const optionValue of ['', ...QUEUE_TYPES]) {
      const option = document.createElement('option');
      option.value = optionValue;
      option.textContent = optionValue || 'all';
      this.replayQueueSelect.appendChild(option);
    }
    replayQueueLabel.appendChild(this.replayQueueSelect);
    replayControlGrid.appendChild(replayQueueLabel);

    const replayFromLabel = document.createElement('label');
    replayFromLabel.className = 'online-dev-control';
    replayFromLabel.textContent = 'From (date/time)';
    this.replayFromInput = document.createElement('input');
    this.replayFromInput.type = 'datetime-local';
    replayFromLabel.appendChild(this.replayFromInput);
    replayControlGrid.appendChild(replayFromLabel);

    const replayToLabel = document.createElement('label');
    replayToLabel.className = 'online-dev-control';
    replayToLabel.textContent = 'To (date/time)';
    this.replayToInput = document.createElement('input');
    this.replayToInput.type = 'datetime-local';
    replayToLabel.appendChild(this.replayToInput);
    replayControlGrid.appendChild(replayToLabel);

    const replayPatchLabel = document.createElement('label');
    replayPatchLabel.className = 'online-dev-control';
    replayPatchLabel.textContent = 'Patch version';
    this.replayPatchInput = document.createElement('input');
    this.replayPatchInput.type = 'text';
    this.replayPatchInput.placeholder = 'Optional';
    replayPatchLabel.appendChild(this.replayPatchInput);
    replayControlGrid.appendChild(replayPatchLabel);

    const replayActions = document.createElement('div');
    replayActions.className = 'online-dev-actions';

    this.replaySearchButton = document.createElement('button');
    this.replaySearchButton.type = 'button';
    this.replaySearchButton.className = 'online-dev-action';
    this.replaySearchButton.textContent = 'Search Replays';
    this.replaySearchButton.addEventListener('click', () => {
      void this.searchReplays(true);
    });
    replayActions.appendChild(this.replaySearchButton);

    this.replayNextButton = document.createElement('button');
    this.replayNextButton.type = 'button';
    this.replayNextButton.className = 'online-dev-action';
    this.replayNextButton.textContent = 'Load Next Page';
    this.replayNextButton.addEventListener('click', () => {
      void this.searchReplays(false);
    });
    replayActions.appendChild(this.replayNextButton);

    this.replayClearButton = document.createElement('button');
    this.replayClearButton.type = 'button';
    this.replayClearButton.className = 'online-dev-action';
    this.replayClearButton.textContent = 'Clear Filters';
    this.replayClearButton.addEventListener('click', () => {
      this.clearReplayState();
    });
    replayActions.appendChild(this.replayClearButton);

    this.replayPanel.appendChild(replayActions);

    this.replayStatusElement = document.createElement('div');
    this.replayStatusElement.className = 'online-dev-status';
    this.replayStatusElement.textContent = 'Ready.';
    this.replayPanel.appendChild(this.replayStatusElement);

    this.replayErrorElement = document.createElement('div');
    this.replayErrorElement.className = 'online-dev-error';
    this.replayErrorElement.hidden = true;
    this.replayPanel.appendChild(this.replayErrorElement);

    const replayResultsPanel = document.createElement('div');
    replayResultsPanel.className = 'online-dev-output online-dev-replay-results';
    const replayResultsHeading = document.createElement('h4');
    replayResultsHeading.textContent = 'Replay results';
    this.replayResults = document.createElement('div');
    this.replayResults.className = 'online-dev-replay-list';
    replayResultsPanel.append(replayResultsHeading, this.replayResults);
    this.replayPanel.appendChild(replayResultsPanel);

    const replayCursorPanel = this.createOutputPanel('Cursor and filters');
    this.replayCursorOutput = replayCursorPanel.output;
    this.replayPanel.appendChild(replayCursorPanel.root);

    this.rankedPanel = document.createElement('div');
    this.rankedPanel.className = 'online-dev-ranked';
    this.rankedPanel.hidden = true;

    const rankedControlGrid = document.createElement('div');
    rankedControlGrid.className = 'online-dev-controls';
    this.rankedPanel.appendChild(rankedControlGrid);

    const rankedSeasonLabel = document.createElement('label');
    rankedSeasonLabel.className = 'online-dev-control';
    rankedSeasonLabel.textContent = 'Season id (optional)';
    this.rankedSeasonInput = document.createElement('input');
    this.rankedSeasonInput.type = 'text';
    this.rankedSeasonInput.placeholder = 'Current season when empty';
    rankedSeasonLabel.appendChild(this.rankedSeasonInput);
    rankedControlGrid.appendChild(rankedSeasonLabel);

    const rankedActions = document.createElement('div');
    rankedActions.className = 'online-dev-actions';
    this.rankedRefreshButton = document.createElement('button');
    this.rankedRefreshButton.type = 'button';
    this.rankedRefreshButton.className = 'online-dev-action';
    this.rankedRefreshButton.textContent = 'Refresh Ranked Snapshot';
    this.rankedRefreshButton.addEventListener('click', () => {
      void this.refreshRankedProgression();
    });
    rankedActions.appendChild(this.rankedRefreshButton);
    this.rankedPanel.appendChild(rankedActions);

    this.rankedStatusElement = document.createElement('div');
    this.rankedStatusElement.className = 'online-dev-status';
    this.rankedStatusElement.textContent = 'Ready.';
    this.rankedPanel.appendChild(this.rankedStatusElement);

    this.rankedErrorElement = document.createElement('div');
    this.rankedErrorElement.className = 'online-dev-error';
    this.rankedErrorElement.hidden = true;
    this.rankedPanel.appendChild(this.rankedErrorElement);

    const rankedOutputs = document.createElement('div');
    rankedOutputs.className = 'online-dev-outputs';
    this.rankedPanel.appendChild(rankedOutputs);

    const rankedProgressPanel = this.createOutputPanel('Current progression');
    this.rankedProgressOutput = rankedProgressPanel.output;
    rankedOutputs.appendChild(rankedProgressPanel.root);

    const rankedDeltaPanel = this.createOutputPanel('Recent match deltas');
    this.rankedDeltaOutput = rankedDeltaPanel.output;
    rankedOutputs.appendChild(rankedDeltaPanel.root);

    this.sectionBody.append(this.matchmakingPanel, this.roomsPanel, this.replayPanel, this.rankedPanel);

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
    this.clearReplayState();
    this.renderReplayData();
    this.renderRankedData();
    this.updateRoomControlState();
    this.updateReplayControlState();
    this.updateRankedControlState();
    window.addEventListener('keydown', this.keydownHandler);
    this.pollGamepads();
  }

  public show(): void {
    this.root.hidden = false;
    this.prevPadStateByIndex.clear();
    this.populateReplayPlayerDefault();
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
    this.replayPanel.hidden = section.id !== 'replay';
    this.rankedPanel.hidden = section.id !== 'ranked';
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

  private setReplayError(message: string | null): void {
    if (!message) {
      this.replayErrorElement.hidden = true;
      this.replayErrorElement.textContent = '';
      return;
    }
    this.replayErrorElement.hidden = false;
    this.replayErrorElement.textContent = message;
  }

  private setReplayStatus(message: string): void {
    this.replayStatusElement.textContent = message;
  }

  private populateReplayPlayerDefault(): void {
    if (this.replayPlayerInput.value.trim().length > 0) {
      return;
    }
    const accountId = this.options.getAccountId();
    if (accountId) {
      this.replayPlayerInput.value = accountId;
    }
  }

  private setRankedError(message: string | null): void {
    if (!message) {
      this.rankedErrorElement.hidden = true;
      this.rankedErrorElement.textContent = '';
      return;
    }
    this.rankedErrorElement.hidden = false;
    this.rankedErrorElement.textContent = message;
  }

  private setRankedStatus(message: string): void {
    this.rankedStatusElement.textContent = message;
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

  private updateReplayControlState(): void {
    const busy = this.pendingReplayRequest;
    this.replayPlayerInput.disabled = busy;
    this.replayOpponentInput.disabled = busy;
    this.replayCharacterInput.disabled = busy;
    this.replayMatchupInput.disabled = busy;
    this.replayQueueSelect.disabled = busy;
    this.replayFromInput.disabled = busy;
    this.replayToInput.disabled = busy;
    this.replayPatchInput.disabled = busy;
    this.replaySearchButton.disabled = busy;
    this.replayNextButton.disabled = busy || !this.replayNextCursor;
    this.replayClearButton.disabled = busy;
  }

  private updateRankedControlState(): void {
    const busy = this.pendingRankedRequest;
    this.rankedSeasonInput.disabled = busy;
    this.rankedRefreshButton.disabled = busy;
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

  private renderReplayData(): void {
    this.replayCursorOutput.textContent = stableStringify({
      loadedResults: this.replayItems.length,
      nextCursor: this.replayNextCursor,
      filters: this.replayActiveFilters,
    });

    this.replayResults.textContent = '';
    if (this.replayItems.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'online-dev-replay-empty';
      empty.textContent = this.pendingReplayRequest
        ? 'Loading replay search...'
        : 'No replay results. Run a search.';
      this.replayResults.appendChild(empty);
      return;
    }

    for (const item of this.replayItems) {
      const row = document.createElement('div');
      row.className = 'online-dev-replay-item';

      const startedAt = new Date(item.startedAt);
      const startedLabel = Number.isNaN(startedAt.getTime())
        ? item.startedAt
        : startedAt.toLocaleString();

      const title = document.createElement('div');
      title.className = 'online-dev-replay-item-title';
      title.textContent = `${startedLabel} | ${item.queueType} | ${item.player.characterId} vs ${item.opponent.characterId}`;

      const meta = document.createElement('div');
      meta.className = 'online-dev-replay-item-meta';
      meta.textContent = `${item.player.result} vs ${item.opponent.result} | replay ${item.replayId} | ${item.patchVersion}`;

      const actionButton = document.createElement('button');
      actionButton.type = 'button';
      actionButton.className = 'online-dev-action';
      actionButton.textContent = 'Open Replay';
      actionButton.disabled = this.pendingReplayRequest;
      actionButton.addEventListener('click', () => {
        void this.openReplayPayload(item.replayId);
      });

      row.append(title, meta, actionButton);
      this.replayResults.appendChild(row);
    }
  }

  private renderRankedData(): void {
    this.rankedProgressOutput.textContent = stableStringify({
      source: this.rankedProgression?.source ?? null,
      seasonId: this.rankedProgression?.seasonId ?? null,
      rating: this.rankedProgression?.rating ?? null,
      leagueTier: this.rankedProgression?.leagueTier ?? null,
      leaguePoints: this.rankedProgression?.leaguePoints ?? null,
      mrPoints: this.rankedProgression?.mrPoints ?? null,
      provisional: this.rankedProgression?.provisional ?? null,
      updatedAt: this.rankedProgression?.updatedAt ?? null,
    });

    const recentDeltas = (this.rankedProgression?.recentDeltas ?? []).map((delta) => ({
      ...delta,
      ratingDelta: this.computeDelta(delta.preRating, delta.postRating),
      leaguePointsDelta: this.computeDelta(delta.preLeaguePoints, delta.postLeaguePoints),
      mrPointsDelta: this.computeDelta(delta.preMrPoints, delta.postMrPoints),
    }));
    this.rankedDeltaOutput.textContent = stableStringify(
      recentDeltas.length > 0
        ? recentDeltas
        : [{ message: 'No ranked delta entries available yet.' }],
    );
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

  private async runReplayAction(action: () => Promise<void>): Promise<void> {
    if (this.pendingReplayRequest) {
      return;
    }
    this.pendingReplayRequest = true;
    this.setReplayError(null);
    this.updateReplayControlState();
    this.renderReplayData();
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected request failure.';
      this.setReplayError(message);
    } finally {
      this.pendingReplayRequest = false;
      this.updateReplayControlState();
      this.renderReplayData();
    }
  }

  private async runRankedAction(action: () => Promise<void>): Promise<void> {
    if (this.pendingRankedRequest) {
      return;
    }
    this.pendingRankedRequest = true;
    this.setRankedError(null);
    this.updateRankedControlState();
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected request failure.';
      this.setRankedError(message);
    } finally {
      this.pendingRankedRequest = false;
      this.updateRankedControlState();
      this.renderRankedData();
    }
  }

  private static valueOrNull(rawValue: string): string | null {
    const value = rawValue.trim();
    return value.length > 0 ? value : null;
  }

  private parseReplayDateInput(rawValue: string, fieldName: 'from' | 'to'): string | null {
    const value = rawValue.trim();
    if (!value) {
      return null;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`${fieldName} date must be valid.`);
    }
    return parsed.toISOString();
  }

  private resolveReplayFilters(accountId: string): ReplaySearchFiltersInput {
    const fromIso = this.parseReplayDateInput(this.replayFromInput.value, 'from');
    const toIso = this.parseReplayDateInput(this.replayToInput.value, 'to');
    if (fromIso && toIso && new Date(fromIso).getTime() > new Date(toIso).getTime()) {
      throw new Error('Replay search from date must be earlier than to date.');
    }
    return {
      playerId: OnlineDevMenu.valueOrNull(this.replayPlayerInput.value) ?? accountId,
      opponentId: OnlineDevMenu.valueOrNull(this.replayOpponentInput.value),
      character: OnlineDevMenu.valueOrNull(this.replayCharacterInput.value),
      matchup: OnlineDevMenu.valueOrNull(this.replayMatchupInput.value),
      queueType: (OnlineDevMenu.valueOrNull(this.replayQueueSelect.value) as QueueType | null),
      from: fromIso,
      to: toIso,
      patchVersion: OnlineDevMenu.valueOrNull(this.replayPatchInput.value),
      limit: 20,
    };
  }

  private buildReplaySearchPath(filters: ReplaySearchFiltersInput, cursor: string | null): string {
    const query = new URLSearchParams();
    query.set('playerId', filters.playerId);
    if (filters.opponentId) {
      query.set('opponentId', filters.opponentId);
    }
    if (filters.character) {
      query.set('character', filters.character);
    }
    if (filters.matchup) {
      query.set('matchup', filters.matchup);
    }
    if (filters.queueType) {
      query.set('queueType', filters.queueType);
    }
    if (filters.from) {
      query.set('from', filters.from);
    }
    if (filters.to) {
      query.set('to', filters.to);
    }
    if (filters.patchVersion) {
      query.set('patchVersion', filters.patchVersion);
    }
    query.set('limit', String(filters.limit));
    if (cursor) {
      query.set('cursor', cursor);
    }
    return `/replays/search?${query.toString()}`;
  }

  private clearReplayState(): void {
    this.replayItems = [];
    this.replayNextCursor = null;
    this.replayActiveFilters = null;
    this.replayPlayerInput.value = '';
    this.replayOpponentInput.value = '';
    this.replayCharacterInput.value = '';
    this.replayMatchupInput.value = '';
    this.replayQueueSelect.value = '';
    this.replayFromInput.value = '';
    this.replayToInput.value = '';
    this.replayPatchInput.value = '';
    this.populateReplayPlayerDefault();
    this.setReplayStatus('Ready.');
    this.setReplayError(null);
    this.updateReplayControlState();
    this.renderReplayData();
  }

  private async searchReplays(reset: boolean): Promise<void> {
    await this.runReplayAction(async () => {
      const accountId = this.options.getAccountId();
      if (!accountId) {
        this.setReplayError('Missing account id. Profile bootstrap has not completed.');
        return;
      }
      this.populateReplayPlayerDefault();
      if (!reset) {
        if (!this.replayActiveFilters) {
          throw new Error('Run replay search before loading next page.');
        }
        if (!this.replayNextCursor) {
          this.setReplayStatus('No more replay results.');
          return;
        }
      }

      const filters = reset
        ? this.resolveReplayFilters(accountId)
        : this.replayActiveFilters!;
      const cursor = reset ? null : this.replayNextCursor;
      const response = await this.requestJson<ReplaySearchResponseView>(
        'GET',
        this.buildReplaySearchPath(filters, cursor),
        accountId,
      );

      this.replayActiveFilters = filters;
      this.replayItems = reset ? response.items : [...this.replayItems, ...response.items];
      this.replayNextCursor = response.nextCursor;
      if (this.replayItems.length === 0) {
        this.setReplayStatus('No replay results found for current filters.');
      } else {
        const delta = reset ? response.items.length : response.items.length;
        const pageState = this.replayNextCursor ? 'next page available' : 'last page reached';
        this.setReplayStatus(`Loaded ${delta} result(s). Total ${this.replayItems.length} (${pageState}).`);
      }
    });
  }

  private async openReplayPayload(replayId: string): Promise<void> {
    await this.runReplayAction(async () => {
      const accountId = this.options.getAccountId();
      if (!accountId) {
        this.setReplayError('Missing account id. Profile bootstrap has not completed.');
        return;
      }
      this.setReplayStatus(`Loading replay payload ${replayId}...`);
      const response = await this.requestJson<ReplayPayloadResponseView>(
        'GET',
        `/replays/${replayId}/payload`,
        accountId,
      );
      await this.options.onOpenReplayPayload({
        replayId: response.replayId,
        payload: response.payload,
      });
      this.setReplayStatus(`Opened replay ${replayId} in replay review viewer.`);
    });
  }

  private async refreshRankedProgression(): Promise<void> {
    await this.runRankedAction(async () => {
      const accountId = this.options.getAccountId();
      if (!accountId) {
        this.setRankedError('Missing account id. Profile bootstrap has not completed.');
        return;
      }

      const seasonId = OnlineDevMenu.valueOrNull(this.rankedSeasonInput.value);
      this.setRankedStatus('Loading ranked progression...');

      const rankedApiProgression = await this.tryFetchRankedProgressionFromApi(accountId, seasonId);
      if (rankedApiProgression) {
        this.rankedProgression = rankedApiProgression;
        this.setRankedStatus('Loaded ranked progression from ranked API.');
        return;
      }

      const fallback = await this.fetchRankedProgressionFromProfile(accountId, seasonId);
      if (fallback) {
        this.rankedProgression = fallback;
        this.setRankedStatus('Ranked API unavailable. Loaded profile settings fallback.');
        return;
      }

      this.rankedProgression = {
        source: 'unavailable',
        seasonId,
        rating: null,
        leagueTier: null,
        leaguePoints: null,
        mrPoints: null,
        provisional: null,
        updatedAt: null,
        recentDeltas: [],
      };
      this.setRankedStatus('No ranked progression data is available yet.');
    });
  }

  private async tryFetchRankedProgressionFromApi(
    accountId: string,
    seasonId: string | null,
  ): Promise<RankedProgressionView | null> {
    const path = seasonId
      ? `/ranked/progression?seasonId=${encodeURIComponent(seasonId)}`
      : '/ranked/progression';
    const response = await this.requestRaw('GET', path, accountId);
    if (response.status === 404 || response.status === 501) {
      return null;
    }
    if (!response.ok) {
      const message = await parseErrorMessage(response);
      throw new Error(message);
    }
    const payload = await response.json() as unknown;
    return this.parseRankedProgression(payload, 'ranked_api', seasonId);
  }

  private async fetchRankedProgressionFromProfile(
    accountId: string,
    requestedSeasonId: string | null,
  ): Promise<RankedProgressionView | null> {
    const profile = await this.requestJson<{ settings_json?: Record<string, unknown>; updated_at?: string | null }>(
      'GET',
      '/profile',
      accountId,
    );
    const settings = this.asRecord(profile.settings_json);
    if (!settings) {
      return null;
    }
    const rankedSettings = this.asRecord(settings.ranked) ?? this.asRecord(settings.rankedProgression);
    if (!rankedSettings) {
      return null;
    }
    return this.parseRankedProgression(
      rankedSettings,
      'profile_settings',
      requestedSeasonId,
      this.stringOrNull(profile.updated_at),
    );
  }

  private parseRankedProgression(
    payload: unknown,
    source: RankedProgressionView['source'],
    requestedSeasonId: string | null,
    fallbackUpdatedAt: string | null = null,
  ): RankedProgressionView {
    const root = this.asRecord(payload);
    const current = this.asRecord(root?.current) ?? root ?? {};
    const recentRaw = Array.isArray(root?.recentDeltas)
      ? root.recentDeltas
      : Array.isArray(root?.recentResults)
        ? root.recentResults
        : Array.isArray(current?.recentDeltas)
          ? current.recentDeltas
          : [];
    const recentDeltas = recentRaw
      .map((entry) => this.parseRankedDelta(entry))
      .filter((entry): entry is RankedMatchDeltaView => entry !== null);

    return {
      source,
      seasonId: this.stringOrNull(current.seasonId) ?? this.stringOrNull(root?.seasonId) ?? requestedSeasonId,
      rating: this.numberOrNull(current.rating),
      leagueTier: this.stringOrNull(current.leagueTier),
      leaguePoints: this.numberOrNull(current.leaguePoints),
      mrPoints: this.numberOrNull(current.mrPoints),
      provisional: this.booleanOrNull(current.provisional),
      updatedAt: this.stringOrNull(current.updatedAt) ?? this.stringOrNull(root?.updatedAt) ?? fallbackUpdatedAt,
      recentDeltas,
    };
  }

  private parseRankedDelta(entry: unknown): RankedMatchDeltaView | null {
    const row = this.asRecord(entry);
    if (!row) {
      return null;
    }
    const ratingPre = this.numberOrNull(row.preRating) ?? this.numberOrNull(row.ratingBefore);
    const ratingPost = this.numberOrNull(row.postRating) ?? this.numberOrNull(row.ratingAfter);
    const lpPre = this.numberOrNull(row.preLeaguePoints) ?? this.numberOrNull(row.leaguePointsBefore);
    const lpPost = this.numberOrNull(row.postLeaguePoints) ?? this.numberOrNull(row.leaguePointsAfter);
    const mrPre = this.numberOrNull(row.preMrPoints) ?? this.numberOrNull(row.mrPointsBefore);
    const mrPost = this.numberOrNull(row.postMrPoints) ?? this.numberOrNull(row.mrPointsAfter);
    return {
      matchId: this.stringOrNull(row.matchId),
      queueType: this.stringOrNull(row.queueType),
      result: this.stringOrNull(row.result),
      preRating: ratingPre,
      postRating: ratingPost,
      preLeaguePoints: lpPre,
      postLeaguePoints: lpPost,
      preMrPoints: mrPre,
      postMrPoints: mrPost,
      occurredAt: this.stringOrNull(row.occurredAt),
    };
  }

  private computeDelta(before: number | null, after: number | null): number | null {
    if (before === null || after === null) {
      return null;
    }
    return after - before;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private stringOrNull(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private numberOrNull(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  }

  private booleanOrNull(value: unknown): boolean | null {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      if (value === 'true') {
        return true;
      }
      if (value === 'false') {
        return false;
      }
    }
    return null;
  }

  private async requestJson<T>(
    method: 'GET' | 'POST',
    path: string,
    accountId: string,
    body?: unknown,
  ): Promise<T> {
    const response = await this.requestRaw(method, path, accountId, body);
    if (!response.ok) {
      const errorMessage = await parseErrorMessage(response);
      throw new Error(errorMessage);
    }
    return await response.json() as T;
  }

  private async requestRaw(
    method: 'GET' | 'POST',
    path: string,
    accountId: string,
    body?: unknown,
  ): Promise<Response> {
    const apiBase = this.options.apiBase.trim();
    if (!apiBase) {
      throw new Error('Missing VITE_MATCHMAKING_API_BASE or VITE_PROFILE_API_BASE for Online Dev API panel.');
    }

    const headers: Record<string, string> = {
      'x-account-id': accountId,
    };
    let payload: string | undefined;
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    return await fetch(`${apiBase}${path}`, {
      method,
      headers,
      body: payload,
    });
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

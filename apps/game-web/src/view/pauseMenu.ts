import { createDefaultTuning, sanitiseTuning } from '../sim/tuning';
import type { GameTuning } from '../sim/types';
import type { AudioSettings, DynamicRangeMode } from './audio/settings';

interface PauseMenuOptions {
  getTuning(): GameTuning;
  setTuning(tuning: GameTuning): void;
  getAudioSettings(): AudioSettings;
  setAudioSettings(settings: AudioSettings): void;
  enableDebugTab?: boolean;
  onRestartTraining?(): void;
}

interface TuningField {
  key: keyof GameTuning;
  label: string;
  step: number;
  min: number;
  max: number;
}

interface AudioVolumeField {
  key: keyof Pick<AudioSettings, 'masterVolume' | 'musicVolume' | 'sfxVolume' | 'voiceVolume'>;
  label: string;
}

const TUNING_FIELDS: TuningField[] = [
  { key: 'playerMoveAccel', label: 'Movement Speed', step: 1, min: 1, max: 400 },
  { key: 'boostHoldSpeed', label: 'Boost Speed', step: 1, min: 1, max: 300 },
  { key: 'superBoostHoldSpeed', label: 'Super Boost Speed', step: 1, min: 1, max: 300 },
  { key: 'launchBasePower', label: 'Launch Base Speed', step: 1, min: 1, max: 400 },
  { key: 'launchChainBonus', label: 'Launch Chain Bonus', step: 1, min: 0, max: 100 },
  { key: 'launchHelplessSeconds', label: 'Launch Duration', step: 0.05, min: 0.1, max: 60 },
  { key: 'chainWindowSeconds', label: 'Chain Window', step: 0.05, min: 0.1, max: 6 },
  { key: 'launchInputInfluence', label: 'Launch DI Influence', step: 0.01, min: 0, max: 1 },
  { key: 'playerVelocityDamping', label: 'Normal Damping', step: 0.001, min: 0.5, max: 0.9995 },
  { key: 'helplessVelocityDamping', label: 'Launch Damping', step: 0.0005, min: 0.5, max: 0.9999 },
  { key: 'superBoostSteerLerp', label: 'Super Steer Lerp', step: 0.01, min: 0.01, max: 1 },
  { key: 'superBoostVelocityBlend', label: 'Super Velocity Blend', step: 0.01, min: 0.01, max: 1 },
  { key: 'superBoostWaveAmplitude', label: 'Super Zigzag Amplitude', step: 0.1, min: 0, max: 30 },
  { key: 'superBoostFuelMultiplier', label: 'Super Fuel Multiplier', step: 0.01, min: 0.01, max: 3 },
  { key: 'dunkRecoveryFuelFraction', label: 'Dunk Recovery Fuel Fraction', step: 0.01, min: 0, max: 1 },
  { key: 'dunkRecoveryDurationSeconds', label: 'Dunk Recovery Duration', step: 0.01, min: 0.1, max: 8 },
  { key: 'dunkRecoveryMoveSpeed', label: 'Dunk Recovery Move Speed', step: 0.5, min: 1, max: 300 },
];

const AUDIO_VOLUME_FIELDS: AudioVolumeField[] = [
  { key: 'masterVolume', label: 'Master Volume' },
  { key: 'musicVolume', label: 'Music Volume' },
  { key: 'sfxVolume', label: 'SFX Volume' },
  { key: 'voiceVolume', label: 'Voice Volume' },
];

type PauseTabId = 'pause' | 'audio' | 'bindings' | 'debug';

export class PauseMenu {
  private readonly root: HTMLDivElement;
  private copyStatus: HTMLDivElement | null = null;
  private readonly tabButtons: Record<PauseTabId, HTMLButtonElement>;
  private readonly debugTabEnabled: boolean;
  private readonly restartTrainingButton!: HTMLButtonElement;
  private readonly tabPanels: Record<PauseTabId, HTMLDivElement>;
  private readonly fieldInputs = new Map<keyof GameTuning, HTMLInputElement>();
  private readonly audioVolumeInputs = new Map<AudioVolumeField['key'], HTMLInputElement>();
  private readonly audioToggleInputs!: {
    voiceDuckingEnabled: HTMLInputElement;
    subtitlesEnabled: HTMLInputElement;
    dynamicRangeMode: HTMLSelectElement;
  };
  private paused = false;
  private canRestartTraining = false;
  private activeTab: PauseTabId = 'pause';

  constructor(private readonly options: PauseMenuOptions) {
    this.debugTabEnabled = options.enableDebugTab ?? true;
    this.root = document.createElement('div');
    this.root.className = 'pause-menu';
    this.root.hidden = true;

    const panel = document.createElement('div');
    panel.className = 'pause-panel';
    this.root.appendChild(panel);

    const header = document.createElement('div');
    header.className = 'pause-header';
    header.innerHTML = '<h2>Paused</h2><span>Esc or Start to resume</span>';
    panel.appendChild(header);

    const tabs = document.createElement('div');
    tabs.className = 'pause-tabs';
    panel.appendChild(tabs);

    const pausePanel = this.createPauseTab();
    const audioPanel = this.createAudioTab();
    const bindingsPanel = this.createBindingsTab();
    const debugPanel = this.createDebugTab();
    this.tabPanels = {
      pause: pausePanel,
      audio: audioPanel,
      bindings: bindingsPanel,
      debug: debugPanel,
    };
    panel.append(pausePanel, audioPanel, bindingsPanel, debugPanel);

    const pauseButton = this.createTabButton('Pause', 'pause');
    const audioButton = this.createTabButton('Audio', 'audio');
    const bindingsButton = this.createTabButton('Controller Bindings', 'bindings');
    const debugButton = this.createTabButton('Debug Tuning', 'debug');
    if (!this.debugTabEnabled) {
      debugButton.hidden = true;
    }
    tabs.append(pauseButton, audioButton, bindingsButton, debugButton);
    this.tabButtons = {
      pause: pauseButton,
      audio: audioButton,
      bindings: bindingsButton,
      debug: debugButton,
    };

    document.body.appendChild(this.root);
    this.setActiveTab('pause');
    this.syncInputsFromTuning();
    this.syncInputsFromAudioSettings();
  }

  isPaused(): boolean {
    return this.paused;
  }

  toggle(): void {
    this.setPaused(!this.paused);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.root.hidden = !paused;
    if (paused) {
      this.setActiveTab('pause');
      this.syncInputsFromTuning();
      this.syncInputsFromAudioSettings();
      if (this.copyStatus) {
        this.copyStatus.textContent = '';
      }
    }
  }

  setCanRestartTraining(enabled: boolean): void {
    this.canRestartTraining = enabled;
    this.restartTrainingButton.hidden = !enabled;
  }

  private createTabButton(label: string, tabId: PauseTabId): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pause-tab-btn';
    button.textContent = label;
    button.addEventListener('click', () => this.setActiveTab(tabId));
    return button;
  }

  private setActiveTab(tabId: PauseTabId): void {
    if (tabId === 'debug' && !this.debugTabEnabled) {
      tabId = 'pause';
    }
    this.activeTab = tabId;
    this.tabPanels.pause.hidden = tabId !== 'pause';
    this.tabPanels.audio.hidden = tabId !== 'audio';
    this.tabPanels.bindings.hidden = tabId !== 'bindings';
    this.tabPanels.debug.hidden = tabId !== 'debug' || !this.debugTabEnabled;

    this.tabButtons.pause.classList.toggle('active', tabId === 'pause');
    this.tabButtons.audio.classList.toggle('active', tabId === 'audio');
    this.tabButtons.bindings.classList.toggle('active', tabId === 'bindings');
    this.tabButtons.debug.classList.toggle('active', tabId === 'debug' && this.debugTabEnabled);
  }

  private createPauseTab(): HTMLDivElement {
    const tab = document.createElement('div');
    tab.className = 'pause-tab-panel';

    const resume = document.createElement('button');
    resume.type = 'button';
    resume.className = 'pause-action';
    resume.textContent = 'Resume';
    resume.addEventListener('click', () => this.setPaused(false));

    const toBindings = document.createElement('button');
    toBindings.type = 'button';
    toBindings.className = 'pause-action';
    toBindings.textContent = 'Controller Bindings';
    toBindings.addEventListener('click', () => this.setActiveTab('bindings'));

    const toDebug = document.createElement('button');
    toDebug.type = 'button';
    toDebug.className = 'pause-action';
    toDebug.textContent = 'Debug Tuning';
    toDebug.addEventListener('click', () => this.setActiveTab('debug'));
    toDebug.hidden = !this.debugTabEnabled;

    const restartTraining = document.createElement('button');
    restartTraining.type = 'button';
    restartTraining.className = 'pause-action';
    restartTraining.textContent = 'Restart Training';
    restartTraining.hidden = true;
    restartTraining.addEventListener('click', () => {
      if (!this.canRestartTraining) {
        return;
      }
      this.options.onRestartTraining?.();
      this.setPaused(false);
    });
    this.restartTrainingButton = restartTraining;

    tab.append(resume, restartTraining, toAudio, toBindings, toDebug);
    return tab;
  }

  private createAudioTab(): HTMLDivElement {
    const tab = document.createElement('div');
    tab.className = 'pause-tab-panel';

    const title = document.createElement('h3');
    title.textContent = 'Audio And Accessibility';
    tab.appendChild(title);

    const volumeGrid = document.createElement('div');
    volumeGrid.className = 'tuning-grid';
    tab.appendChild(volumeGrid);

    for (const field of AUDIO_VOLUME_FIELDS) {
      const row = document.createElement('label');
      row.className = 'tuning-row';
      const text = document.createElement('span');
      text.textContent = field.label;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      input.step = '1';
      input.addEventListener('input', () => {
        const ratio = Number(input.value) / 100;
        this.updateAudioSetting(field.key, ratio);
      });
      row.append(text, input);
      volumeGrid.appendChild(row);
      this.audioVolumeInputs.set(field.key, input);
    }

    const dynamicRangeRow = document.createElement('label');
    dynamicRangeRow.className = 'tuning-row';
    const dynamicRangeText = document.createElement('span');
    dynamicRangeText.textContent = 'Dynamic Range';
    const dynamicRangeSelect = document.createElement('select');
    const optionWide = document.createElement('option');
    optionWide.value = 'wide';
    optionWide.textContent = 'Wide';
    const optionReduced = document.createElement('option');
    optionReduced.value = 'reduced';
    optionReduced.textContent = 'Reduced';
    dynamicRangeSelect.append(optionWide, optionReduced);
    dynamicRangeSelect.addEventListener('change', () => {
      this.updateAudioSetting('dynamicRangeMode', dynamicRangeSelect.value as DynamicRangeMode);
    });
    dynamicRangeRow.append(dynamicRangeText, dynamicRangeSelect);
    tab.appendChild(dynamicRangeRow);

    const duckingRow = document.createElement('label');
    duckingRow.className = 'binding-row';
    const duckingToggle = document.createElement('input');
    duckingToggle.type = 'checkbox';
    duckingToggle.addEventListener('change', () => {
      this.updateAudioSetting('voiceDuckingEnabled', duckingToggle.checked);
    });
    duckingRow.append(duckingToggle, document.createTextNode(' Voice ducking during callouts'));
    tab.appendChild(duckingRow);

    const subtitlesRow = document.createElement('label');
    subtitlesRow.className = 'binding-row';
    const subtitlesToggle = document.createElement('input');
    subtitlesToggle.type = 'checkbox';
    subtitlesToggle.addEventListener('change', () => {
      this.updateAudioSetting('subtitlesEnabled', subtitlesToggle.checked);
    });
    subtitlesRow.append(subtitlesToggle, document.createTextNode(' Voice subtitles'));
    tab.appendChild(subtitlesRow);

    this.audioToggleInputs = {
      voiceDuckingEnabled: duckingToggle,
      subtitlesEnabled: subtitlesToggle,
      dynamicRangeMode: dynamicRangeSelect,
    };
    return tab;
  }

  private createBindingsTab(): HTMLDivElement {
    const tab = document.createElement('div');
    tab.className = 'pause-tab-panel';

    const title = document.createElement('h3');
    title.textContent = 'Xbox Controller Bindings';
    tab.appendChild(title);

    const lines = [
      'Move: Left Stick or D-pad',
      'RT: Boost',
      'LT: Super boost',
      'X: Special',
      'Y: Launch',
      'B: Dunk',
      'LB: Parry',
      'A: Break',
      'Pad assignment: first connected pad is P1, second is P2.',
    ];

    for (const line of lines) {
      const row = document.createElement('div');
      row.className = 'binding-row';
      row.textContent = line;
      tab.appendChild(row);
    }

    return tab;
  }

  private createDebugTab(): HTMLDivElement {
    const tab = document.createElement('div');
    tab.className = 'pause-tab-panel';

    const title = document.createElement('h3');
    title.textContent = 'Debug Tuning';
    tab.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'tuning-grid';
    tab.appendChild(grid);

    for (const field of TUNING_FIELDS) {
      const row = document.createElement('label');
      row.className = 'tuning-row';

      const text = document.createElement('span');
      text.textContent = field.label;

      const input = document.createElement('input');
      input.type = 'number';
      input.step = String(field.step);
      input.min = String(field.min);
      input.max = String(field.max);
      input.addEventListener('change', () => this.updateTuningField(field.key, Number(input.value)));

      row.append(text, input);
      grid.appendChild(row);
      this.fieldInputs.set(field.key, input);
    }

    const actions = document.createElement('div');
    actions.className = 'tuning-actions';

    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.className = 'pause-action';
    resetButton.textContent = 'Reset Defaults';
    resetButton.addEventListener('click', () => {
      this.options.setTuning(createDefaultTuning());
      this.syncInputsFromTuning();
      if (this.copyStatus) {
        this.copyStatus.textContent = 'Defaults restored.';
      }
    });

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'pause-action';
    copyButton.textContent = 'Copy Tuning JSON';
    copyButton.addEventListener('click', () => {
      this.copyTuningToClipboard();
    });

    actions.append(resetButton, copyButton);
    tab.appendChild(actions);

    this.copyStatus = document.createElement('div');
    this.copyStatus.className = 'copy-status';
    this.copyStatus.textContent = '';
    tab.appendChild(this.copyStatus);

    return tab;
  }

  private updateTuningField(key: keyof GameTuning, rawValue: number): void {
    if (!Number.isFinite(rawValue)) {
      this.syncInputsFromTuning();
      return;
    }
    const nextTuning = sanitiseTuning({
      ...this.options.getTuning(),
      [key]: rawValue,
    });
    this.options.setTuning(nextTuning);
    this.syncInputsFromTuning();
  }

  private syncInputsFromTuning(): void {
    const tuning = this.options.getTuning();
    for (const [key, input] of this.fieldInputs.entries()) {
      input.value = String(tuning[key]);
    }
  }

  private updateAudioSetting(key: keyof AudioSettings, value: AudioSettings[keyof AudioSettings]): void {
    const current = this.options.getAudioSettings();
    const next = {
      ...current,
      [key]: value,
    } as AudioSettings;
    this.options.setAudioSettings(next);
    this.syncInputsFromAudioSettings();
  }

  private syncInputsFromAudioSettings(): void {
    const settings = this.options.getAudioSettings();
    for (const field of AUDIO_VOLUME_FIELDS) {
      const input = this.audioVolumeInputs.get(field.key);
      if (!input) {
        continue;
      }
      input.value = String(Math.round(settings[field.key] * 100));
    }
    this.audioToggleInputs.voiceDuckingEnabled.checked = settings.voiceDuckingEnabled;
    this.audioToggleInputs.subtitlesEnabled.checked = settings.subtitlesEnabled;
    this.audioToggleInputs.dynamicRangeMode.value = settings.dynamicRangeMode;
  }

  private async copyTuningToClipboard(): Promise<void> {
    const tuning = this.options.getTuning();
    const payload = JSON.stringify(tuning, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      if (this.copyStatus) {
        this.copyStatus.textContent = 'Tuning copied to clipboard.';
      }
      return;
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = payload;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      if (this.copyStatus) {
        this.copyStatus.textContent = 'Tuning copied to clipboard.';
      }
    }
  }
}

export function createPauseMenu(options: PauseMenuOptions): PauseMenu {
  return new PauseMenu(options);
}
    const toAudio = document.createElement('button');
    toAudio.type = 'button';
    toAudio.className = 'pause-action';
    toAudio.textContent = 'Audio Settings';
    toAudio.addEventListener('click', () => this.setActiveTab('audio'));

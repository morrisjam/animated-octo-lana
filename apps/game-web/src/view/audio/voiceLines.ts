import { CHARACTER_BY_ID, type CharacterId } from '../../sim/characters';
import type { AudioEvent, AudioToneCue } from './types';

export type VoiceCalloutEvent = 'round_start' | 'launch_hit' | 'parry_success' | 'dunk_hit' | 'match_win';

export interface VoiceLineDefinition {
  id: string;
  event: VoiceCalloutEvent;
  priority: number;
  cooldownSeconds: number;
  text: string;
  cue: AudioToneCue;
}

type VoicePackByLocale = Record<string, VoiceLineDefinition[]>;

function buildVoiceLines(profileId: string, locale: string, voiceBaseFrequencyHz: number): VoiceLineDefinition[] {
  const suffix = locale.toLowerCase().replace(/[^a-z0-9]/g, '_');
  return [
    {
      id: `${profileId}_${suffix}_round_start`,
      event: 'round_start',
      priority: 3,
      cooldownSeconds: 8,
      text: locale.startsWith('en') ? 'Ready to engage.' : 'Prepare to engage.',
      cue: { waveform: 'triangle', frequencyHz: voiceBaseFrequencyHz, durationSeconds: 0.14, gain: 0.014 },
    },
    {
      id: `${profileId}_${suffix}_launch_hit`,
      event: 'launch_hit',
      priority: 4,
      cooldownSeconds: 2.4,
      text: locale.startsWith('en') ? 'Launch confirmed.' : 'Launch connected.',
      cue: { waveform: 'square', frequencyHz: voiceBaseFrequencyHz + 24, durationSeconds: 0.12, gain: 0.013 },
    },
    {
      id: `${profileId}_${suffix}_parry_success`,
      event: 'parry_success',
      priority: 5,
      cooldownSeconds: 2.6,
      text: locale.startsWith('en') ? 'Parry clean.' : 'Parry success.',
      cue: { waveform: 'triangle', frequencyHz: voiceBaseFrequencyHz + 38, durationSeconds: 0.1, gain: 0.013 },
    },
    {
      id: `${profileId}_${suffix}_dunk_hit`,
      event: 'dunk_hit',
      priority: 6,
      cooldownSeconds: 3.2,
      text: locale.startsWith('en') ? 'Impact secured.' : 'Dunk impact.',
      cue: { waveform: 'sawtooth', frequencyHz: voiceBaseFrequencyHz - 28, durationSeconds: 0.13, gain: 0.014 },
    },
    {
      id: `${profileId}_${suffix}_match_win`,
      event: 'match_win',
      priority: 10,
      cooldownSeconds: 12,
      text: locale.startsWith('en') ? 'Mission complete.' : 'Match complete.',
      cue: { waveform: 'sine', frequencyHz: voiceBaseFrequencyHz - 44, durationSeconds: 0.18, gain: 0.015 },
    },
  ];
}

const VOICE_PACKS: Record<string, VoicePackByLocale> = {
  character_vanguard_voice: {
    'en-US': buildVoiceLines('vanguard', 'en-US', 320),
    'en-GB': buildVoiceLines('vanguard', 'en-GB', 312),
  },
  character_duelist_voice: {
    'en-US': buildVoiceLines('duelist', 'en-US', 360),
  },
  character_ace_voice: {
    'en-US': buildVoiceLines('ace', 'en-US', 342),
    'fr-FR': buildVoiceLines('ace', 'fr-FR', 336),
  },
  character_warden_voice: {
    'en-US': buildVoiceLines('warden', 'en-US', 300),
  },
};

function normaliseLocale(locale: string): string {
  return locale.trim();
}

function resolveVoicePackLocale(pack: VoicePackByLocale, locale: string): string | null {
  const normalizedLocale = normaliseLocale(locale);
  if (pack[normalizedLocale]) {
    return normalizedLocale;
  }
  const languageTag = normalizedLocale.split('-')[0];
  if (languageTag) {
    const localeByLanguage = Object.keys(pack).find((candidate) => candidate.split('-')[0] === languageTag);
    if (localeByLanguage) {
      return localeByLanguage;
    }
  }
  if (pack['en-US']) {
    return 'en-US';
  }
  const firstLocale = Object.keys(pack)[0];
  return firstLocale ?? null;
}

function resolveVoiceLinesByProfile(profileId: string, locale: string): VoiceLineDefinition[] {
  const pack = VOICE_PACKS[profileId];
  if (!pack) {
    return [];
  }
  const resolvedLocale = resolveVoicePackLocale(pack, locale);
  if (!resolvedLocale) {
    return [];
  }
  return pack[resolvedLocale] ?? [];
}

function getVoiceProfileId(characterId: CharacterId): string {
  return CHARACTER_BY_ID[characterId].audio.voiceProfileId;
}

function toEventKey(playerId: AudioEvent['playerId'], event: VoiceCalloutEvent): string {
  return `${playerId ?? 'unknown'}:${event}`;
}

export interface VoiceCalloutTrigger {
  playerId: NonNullable<AudioEvent['playerId']>;
  characterId: CharacterId;
  event: VoiceCalloutEvent;
  timeSeconds: number;
}

export interface VoiceCalloutResult {
  lineId: string;
  text: string;
}

export interface VoiceCalloutSystem {
  setLocale(locale: string): void;
  trigger(callout: VoiceCalloutTrigger): VoiceCalloutResult | null;
}

export interface VoiceCalloutSystemOptions {
  locale: string;
  emitAudioEvent: (event: AudioEvent) => void;
  minGlobalGapSeconds?: number;
}

export function createVoiceCalloutSystem(options: VoiceCalloutSystemOptions): VoiceCalloutSystem {
  let locale = options.locale;
  const minGlobalGapSeconds = Math.max(0, options.minGlobalGapSeconds ?? 0.65);
  let lastGlobalTimeSeconds = Number.NEGATIVE_INFINITY;
  const lastPlayedByLineId = new Map<string, number>();
  const lastPlayedByEventKey = new Map<string, number>();

  return {
    setLocale(nextLocale: string): void {
      locale = nextLocale;
    },
    trigger(callout: VoiceCalloutTrigger): VoiceCalloutResult | null {
      const voiceProfileId = getVoiceProfileId(callout.characterId);
      const candidateLines = resolveVoiceLinesByProfile(voiceProfileId, locale)
        .filter((line) => line.event === callout.event);
      if (candidateLines.length === 0) {
        return null;
      }

      const elapsedSinceGlobal = callout.timeSeconds - lastGlobalTimeSeconds;
      if (elapsedSinceGlobal < minGlobalGapSeconds) {
        return null;
      }

      const eventKey = toEventKey(callout.playerId, callout.event);
      const lastEventTime = lastPlayedByEventKey.get(eventKey) ?? Number.NEGATIVE_INFINITY;
      const eligible = candidateLines
        .filter((line) => {
          const lastLineTime = lastPlayedByLineId.get(line.id) ?? Number.NEGATIVE_INFINITY;
          return (callout.timeSeconds - lastLineTime) >= line.cooldownSeconds
            && (callout.timeSeconds - lastEventTime) >= line.cooldownSeconds * 0.5;
        })
        .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

      const selected = eligible[0];
      if (!selected) {
        return null;
      }

      lastGlobalTimeSeconds = callout.timeSeconds;
      lastPlayedByLineId.set(selected.id, callout.timeSeconds);
      lastPlayedByEventKey.set(eventKey, callout.timeSeconds);

      options.emitAudioEvent({
        type: 'voice.callout',
        playerId: callout.playerId,
        pan: callout.playerId === 'P1' ? -0.35 : 0.35,
        cueOverride: selected.cue,
      });

      return {
        lineId: selected.id,
        text: selected.text,
      };
    },
  };
}


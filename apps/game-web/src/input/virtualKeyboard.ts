export type VirtualKeyboardInputMode =
  | 'text'
  | 'email'
  | 'numeric'
  | 'decimal'
  | 'tel'
  | 'url'
  | 'search';

export interface VirtualKeyboardRequest {
  title: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  inputMode?: VirtualKeyboardInputMode;
  maxLength?: number;
  secure?: boolean;
  trim?: boolean;
}

export type VirtualKeyboardResult =
  | { status: 'submitted'; value: string; source: string }
  | { status: 'cancelled'; source: string }
  | { status: 'unavailable'; source: string; reason: string }
  | { status: 'error'; source: string; reason: string };

export interface PlatformVirtualKeyboard {
  readonly id: string;
  readonly supportsSecureEntry: boolean;
  isAvailable(): boolean;
  requestText(request: VirtualKeyboardRequest): Promise<VirtualKeyboardResult>;
}

export type BrowserPrompt = (message: string, defaultValue?: string) => string | null;

export interface BrowserVirtualKeyboardOptions {
  prompt?: BrowserPrompt | null;
  id?: string;
}

const DEFAULT_MAX_LENGTH = 64;
const MAX_TEXT_LENGTH = 4096;

function resolveBrowserPrompt(): BrowserPrompt | null {
  if (typeof window === 'undefined' || typeof window.prompt !== 'function') {
    return null;
  }
  return window.prompt.bind(window);
}

function normaliseMaxLength(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAX_LENGTH;
  }
  return Math.max(1, Math.min(MAX_TEXT_LENGTH, Math.floor(Number(value))));
}

export function normaliseVirtualKeyboardRequest(
  request: VirtualKeyboardRequest,
): Required<Omit<VirtualKeyboardRequest, 'placeholder'>> & { placeholder: string } {
  return {
    title: String(request.title ?? '').trim() || 'Enter text',
    label: String(request.label ?? '').trim() || 'Text',
    initialValue: String(request.initialValue ?? ''),
    placeholder: String(request.placeholder ?? ''),
    inputMode: request.inputMode ?? 'text',
    maxLength: normaliseMaxLength(request.maxLength),
    secure: Boolean(request.secure),
    trim: Boolean(request.trim),
  };
}

function normaliseSubmittedValue(value: string, request: VirtualKeyboardRequest): string {
  const maxLength = normaliseMaxLength(request.maxLength);
  const limited = String(value).slice(0, maxLength);
  return request.trim ? limited.trim() : limited;
}

export function createBrowserVirtualKeyboard(
  options: BrowserVirtualKeyboardOptions = {},
): PlatformVirtualKeyboard {
  const prompt = options.prompt === undefined ? resolveBrowserPrompt() : options.prompt;
  const id = options.id ?? 'browser_prompt';
  return {
    id,
    supportsSecureEntry: false,
    isAvailable: () => prompt !== null,
    async requestText(rawRequest) {
      const request = normaliseVirtualKeyboardRequest(rawRequest);
      if (!prompt) {
        return {
          status: 'unavailable',
          source: id,
          reason: 'Browser text entry is unavailable.',
        };
      }
      if (request.secure) {
        return {
          status: 'unavailable',
          source: id,
          reason: 'The browser prompt fallback cannot safely mask secure text.',
        };
      }
      const detail = request.placeholder ? `\n${request.placeholder}` : '';
      try {
        const value = prompt(
          `${request.title}\n${request.label}${detail}`,
          request.initialValue.slice(0, request.maxLength),
        );
        if (value === null) {
          return { status: 'cancelled', source: id };
        }
        return {
          status: 'submitted',
          source: id,
          value: normaliseSubmittedValue(value, request),
        };
      } catch (error) {
        return {
          status: 'error',
          source: id,
          reason: error instanceof Error ? error.message : 'Browser text entry failed.',
        };
      }
    },
  };
}

export class VirtualKeyboardService implements PlatformVirtualKeyboard {
  readonly id = 'platform_with_browser_fallback';
  readonly supportsSecureEntry: boolean;

  constructor(private readonly adapters: readonly PlatformVirtualKeyboard[]) {
    this.supportsSecureEntry = adapters.some(
      (adapter) => adapter.supportsSecureEntry && adapter.isAvailable(),
    );
  }

  isAvailable(): boolean {
    return this.adapters.some((adapter) => adapter.isAvailable());
  }

  async requestText(rawRequest: VirtualKeyboardRequest): Promise<VirtualKeyboardResult> {
    const request = normaliseVirtualKeyboardRequest(rawRequest);
    let lastFailure: VirtualKeyboardResult | null = null;
    for (const adapter of this.adapters) {
      if (!adapter.isAvailable() || (request.secure && !adapter.supportsSecureEntry)) {
        continue;
      }
      let result: VirtualKeyboardResult;
      try {
        result = await adapter.requestText(request);
      } catch (error) {
        result = {
          status: 'error',
          source: adapter.id,
          reason: error instanceof Error ? error.message : 'Platform text entry failed.',
        };
      }
      if (result.status === 'submitted') {
        return {
          ...result,
          value: normaliseSubmittedValue(result.value, request),
        };
      }
      if (result.status === 'cancelled') {
        return result;
      }
      lastFailure = result;
    }
    if (lastFailure) {
      return lastFailure;
    }
    return {
      status: 'unavailable',
      source: this.id,
      reason: request.secure
        ? 'No secure platform text-entry service is available.'
        : 'No platform text-entry service is available.',
    };
  }
}

export function createVirtualKeyboardService(
  platformAdapter?: PlatformVirtualKeyboard | null,
  browserFallback: PlatformVirtualKeyboard = createBrowserVirtualKeyboard(),
): VirtualKeyboardService {
  return new VirtualKeyboardService(
    platformAdapter ? [platformAdapter, browserFallback] : [browserFallback],
  );
}

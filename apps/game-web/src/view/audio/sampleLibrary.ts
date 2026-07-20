import {
  AUDIO_SAMPLE_LIBRARY_SCHEMA_VERSION,
  type AudioSampleDefinitionV1,
  type AudioSampleLibrary,
  type AudioSampleSourceV1,
  type AudioSampleVariantV1,
} from './types';

const MAX_SAMPLE_CONCURRENCY = 64;

function assertNonEmptyString(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`[audio] ${label} must be a non-empty string.`);
  }
}

export function createAudioSampleLibraryIndex(
  library?: AudioSampleLibrary,
): ReadonlyMap<string, AudioSampleDefinitionV1> {
  if (!library) {
    return new Map();
  }
  if (library.schemaVersion !== AUDIO_SAMPLE_LIBRARY_SCHEMA_VERSION) {
    throw new Error(
      `[audio] Unsupported sample library schema version "${String(library.schemaVersion)}".`,
    );
  }

  const definitions = new Map<string, AudioSampleDefinitionV1>();
  for (const sample of library.samples) {
    assertNonEmptyString(sample.id, 'Sample id');
    if (definitions.has(sample.id)) {
      throw new Error(`[audio] Duplicate sample id "${sample.id}".`);
    }
    if (sample.variants.length === 0) {
      throw new Error(`[audio] Sample "${sample.id}" must define at least one variant.`);
    }
    if (
      sample.maxConcurrent !== undefined
      && (!Number.isInteger(sample.maxConcurrent)
        || sample.maxConcurrent < 1
        || sample.maxConcurrent > MAX_SAMPLE_CONCURRENCY)
    ) {
      throw new Error(
        `[audio] Sample "${sample.id}" maxConcurrent must be an integer from 1 to ${MAX_SAMPLE_CONCURRENCY}.`,
      );
    }
    if (
      sample.overflowPolicy !== undefined
      && sample.overflowPolicy !== 'drop-new'
      && sample.overflowPolicy !== 'steal-oldest'
    ) {
      throw new Error(
        `[audio] Sample "${sample.id}" has unsupported overflowPolicy "${String(sample.overflowPolicy)}".`,
      );
    }

    const variantIds = new Set<string>();
    for (const variant of sample.variants) {
      assertNonEmptyString(variant.id, `Variant id for sample "${sample.id}"`);
      if (variantIds.has(variant.id)) {
        throw new Error(`[audio] Duplicate variant id "${variant.id}" in sample "${sample.id}".`);
      }
      variantIds.add(variant.id);
      if (variant.sources.length === 0) {
        throw new Error(
          `[audio] Variant "${variant.id}" in sample "${sample.id}" must define at least one source.`,
        );
      }
      for (const source of variant.sources) {
        assertNonEmptyString(source.src, `Source URL for sample "${sample.id}" variant "${variant.id}"`);
        assertNonEmptyString(source.mimeType, `MIME type for sample "${sample.id}" variant "${variant.id}"`);
        if (!source.mimeType.toLowerCase().startsWith('audio/')) {
          throw new Error(
            `[audio] Source MIME type "${source.mimeType}" for sample "${sample.id}" must start with "audio/".`,
          );
        }
      }
    }
    definitions.set(sample.id, sample);
  }
  return definitions;
}

export function selectAudioSampleVariant(
  definition: AudioSampleDefinitionV1,
  variantId?: string,
): AudioSampleVariantV1 | null {
  if (variantId === undefined) {
    return definition.variants[0] ?? null;
  }
  return definition.variants.find((variant) => variant.id === variantId) ?? null;
}

export function orderAudioSampleSources(
  sources: readonly AudioSampleSourceV1[],
  canPlayType?: (mimeType: string) => CanPlayTypeResult,
): AudioSampleSourceV1[] {
  if (!canPlayType) {
    return [...sources];
  }

  return sources
    .map((source, index) => {
      const support = canPlayType(source.mimeType);
      return {
        source,
        index,
        rank: support === 'probably' ? 2 : support === 'maybe' ? 1 : 0,
      };
    })
    .sort((left, right) => right.rank - left.rank || left.index - right.index)
    .map(({ source }) => source);
}

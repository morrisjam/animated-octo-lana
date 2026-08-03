import {
  ONLINE_ALPHA_STAGE_ATMOSPHERE_ID,
  STAGE_ATMOSPHERE_BY_ID,
} from '../view/stageAtmosphere';

export interface VisualAlphaStageTarget {
  stageId: string;
  modelId: string | null;
  override: boolean;
}

export function resolveVisualAlphaStageTarget(
  requestedStageId: string | undefined,
): VisualAlphaStageTarget {
  const requested = requestedStageId?.trim() ?? '';
  const stageId = requested || ONLINE_ALPHA_STAGE_ATMOSPHERE_ID;
  const preset = STAGE_ATMOSPHERE_BY_ID[stageId];
  if (!preset) {
    throw new Error(`VISUAL_ALPHA_SMOKE_STAGE_ID is not registered: ${stageId}.`);
  }
  // Procedural stages (e.g. the luminous vortex) declare no authored model;
  // the visual smoke skips model-runtime assertions for them.
  return {
    stageId,
    modelId: preset.tokens.backgroundModelId,
    override: requested.length > 0,
  };
}

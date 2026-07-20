import {
  ONLINE_ALPHA_STAGE_ATMOSPHERE_ID,
  STAGE_ATMOSPHERE_BY_ID,
} from '../view/stageAtmosphere';

export interface VisualAlphaStageTarget {
  stageId: string;
  modelId: string;
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
  const modelId = preset.tokens.backgroundModelId;
  if (!modelId) {
    throw new Error(`Visual smoke stage ${stageId} does not declare an authored background model.`);
  }
  return {
    stageId,
    modelId,
    override: requested.length > 0,
  };
}

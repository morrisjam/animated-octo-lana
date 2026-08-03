import type { ProceduralModelOptions } from './generated/createGravityWellArenaRimV1Model';
import { createGravityWellArenaRimV1Model } from './generated/createGravityWellArenaRimV1Model';
import { optimizeStaticModelByMaterial } from '../view/assets/optimizeStaticModel';

export function createOptimizedGravityWellArenaRimV1Model(
  options: ProceduralModelOptions = {},
) {
  const source = createGravityWellArenaRimV1Model(options);
  return optimizeStaticModelByMaterial(source, 'Gravity Well Arena Rim V1').model;
}

import type { PlayerState } from './types';

type OrdinaryBoostActor = Pick<PlayerState, 'pos' | 'vel' | 'radius' | 'boostDir'>;

export const ORDINARY_BOOST_COUNTERPLAY_OBSERVATION_SECONDS = 0.75;
export const ORDINARY_BOOST_COUNTERPLAY_MAX_START_DISTANCE = 48;
export const ORDINARY_BOOST_COUNTERPLAY_CONTACT_PADDING = 0.75;

export interface OrdinaryBoostApproach {
  distance: number;
  directionX: number;
  directionY: number;
  combinedRadius: number;
  contactDistance: number;
  forwardDistance: number;
  lateralDistance: number;
  closingSpeed: number;
  availableReactionSeconds: number;
}

export function measureOrdinaryBoostApproach(
  booster: OrdinaryBoostActor,
  target: OrdinaryBoostActor,
): OrdinaryBoostApproach | null {
  const directionMagnitude = Math.hypot(booster.boostDir.x, booster.boostDir.y);
  if (directionMagnitude <= 0.001) {
    return null;
  }

  const directionX = booster.boostDir.x / directionMagnitude;
  const directionY = booster.boostDir.y / directionMagnitude;
  const relativeX = target.pos.x - booster.pos.x;
  const relativeY = target.pos.y - booster.pos.y;
  const distance = Math.hypot(relativeX, relativeY);
  const combinedRadius = booster.radius + target.radius;
  const contactDistance = combinedRadius + ORDINARY_BOOST_COUNTERPLAY_CONTACT_PADDING;
  const forwardDistance = relativeX * directionX + relativeY * directionY;
  const lateralDistance = Math.abs(relativeX * directionY - relativeY * directionX);
  const closingSpeed = (
    (booster.vel.x - target.vel.x) * directionX
    + (booster.vel.y - target.vel.y) * directionY
  );
  const availableReactionSeconds = closingSpeed > 0.001
    ? Math.max(0, (forwardDistance - combinedRadius) / closingSpeed)
    : Number.POSITIVE_INFINITY;

  return {
    distance,
    directionX,
    directionY,
    combinedRadius,
    contactDistance,
    forwardDistance,
    lateralDistance,
    closingSpeed,
    availableReactionSeconds,
  };
}

export function isOrdinaryBoostCounterplayOpportunity(
  approach: OrdinaryBoostApproach | null,
): approach is OrdinaryBoostApproach {
  return approach !== null
    && approach.distance > approach.contactDistance
    && approach.distance <= ORDINARY_BOOST_COUNTERPLAY_MAX_START_DISTANCE
    && approach.forwardDistance > approach.combinedRadius
    && approach.lateralDistance <= approach.contactDistance
    && approach.closingSpeed > 1
    && approach.availableReactionSeconds <= ORDINARY_BOOST_COUNTERPLAY_OBSERVATION_SECONDS;
}

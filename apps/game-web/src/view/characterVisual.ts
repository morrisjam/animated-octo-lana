import * as THREE from 'three';
import {
  CHARACTER_BY_ID,
  type CharacterId,
  type CharacterVisualPresentation,
  type CharacterVisualProfile,
} from '../sim/characters';
import type { PlayerId, PlayerRenderSnapshot } from '../sim/types';

interface CharacterPalette {
  body: string;
  accent: string;
  emissive: string;
}

export interface CharacterVisualHandle {
  characterId: CharacterId;
  profile: CharacterVisualProfile;
  adapter: CharacterVisualAdapter;
  node: THREE.Object3D;
}

interface CharacterVisualUpdateContext {
  own: PlayerRenderSnapshot;
  opponent: PlayerRenderSnapshot;
  gameTime: number;
}

interface CharacterVisualAdapter {
  presentation: CharacterVisualPresentation;
  createNode: (profile: CharacterVisualProfile, playerId: PlayerId) => THREE.Object3D;
  updateNode: (node: THREE.Object3D, context: CharacterVisualUpdateContext) => void;
}

function getPalette(playerId: PlayerId): CharacterPalette {
  if (playerId === 'P1') {
    return {
      body: '#58b6ff',
      accent: '#7db7ff',
      emissive: '#58b6ff',
    };
  }
  return {
    body: '#ff74b8',
    accent: '#ff9fd0',
    emissive: '#ff74b8',
  };
}

function createMechBody(palette: CharacterPalette): THREE.Group {
  const mech = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(1.4, 2.7, 8, 14),
    new THREE.MeshStandardMaterial({ color: palette.body, metalness: 0.35, roughness: 0.55 }),
  );
  body.rotation.z = Math.PI / 2;
  mech.add(body);

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.45, 16, 16),
    new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: palette.emissive, emissiveIntensity: 1.6 }),
  );
  core.position.z = 1;
  mech.add(core);

  const wingGeo = new THREE.ConeGeometry(1.2, 3.4, 3);
  const wingMat = new THREE.MeshStandardMaterial({
    color: palette.accent,
    transparent: true,
    opacity: 0.6,
    emissive: palette.accent,
    emissiveIntensity: 0.25,
  });

  const leftWing = new THREE.Mesh(wingGeo, wingMat);
  leftWing.position.set(-0.8, 0, -0.2);
  leftWing.rotation.set(Math.PI / 2, 0, Math.PI * 0.2);
  mech.add(leftWing);

  const rightWing = leftWing.clone();
  rightWing.position.x *= -1;
  rightWing.rotation.z *= -1;
  mech.add(rightWing);

  return mech;
}

function createSpriteNode(palette: CharacterPalette): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    color: palette.body,
    transparent: true,
    opacity: 0.94,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(6, 6, 1);
  return sprite;
}

const threeDAdapter: CharacterVisualAdapter = {
  presentation: '3d',
  createNode(profile: CharacterVisualProfile, playerId: PlayerId): THREE.Object3D {
    const mech = createMechBody(getPalette(playerId));
    mech.name = `${profile.modelId}:${profile.animationSetId}`;
    return mech;
  },
  updateNode(node: THREE.Object3D, context: CharacterVisualUpdateContext): void {
    node.lookAt(context.opponent.pos.x, context.opponent.pos.y, 0);
    node.rotation.x = Math.PI / 2;
  },
};

const spriteAdapter: CharacterVisualAdapter = {
  presentation: 'sprite',
  createNode(profile: CharacterVisualProfile, playerId: PlayerId): THREE.Object3D {
    const sprite = createSpriteNode(getPalette(playerId));
    sprite.name = `${profile.modelId}:sprite`;
    return sprite;
  },
  updateNode(node: THREE.Object3D, context: CharacterVisualUpdateContext): void {
    const sprite = node as THREE.Sprite;
    const pulse = 1 + Math.abs(Math.sin(context.gameTime * 5.5)) * 0.04;
    sprite.scale.set(6 * pulse, 6 * pulse, 1);
  },
};

const hybridAdapter: CharacterVisualAdapter = {
  presentation: 'hybrid',
  createNode(profile: CharacterVisualProfile, playerId: PlayerId): THREE.Object3D {
    const palette = getPalette(playerId);
    const group = new THREE.Group();
    group.name = `${profile.modelId}:hybrid`;

    const mech = createMechBody(palette);
    group.add(mech);

    const aura = createSpriteNode(palette);
    aura.position.set(0, 0, -1.2);
    aura.scale.set(8, 8, 1);
    group.add(aura);

    return group;
  },
  updateNode(node: THREE.Object3D, context: CharacterVisualUpdateContext): void {
    node.lookAt(context.opponent.pos.x, context.opponent.pos.y, 0);
    node.rotation.x = Math.PI / 2;
    const aura = node.children.find((child) => child instanceof THREE.Sprite) as THREE.Sprite | undefined;
    if (aura) {
      const pulse = 1 + Math.abs(Math.sin(context.gameTime * 4)) * 0.1;
      aura.scale.set(8 * pulse, 8 * pulse, 1);
    }
  },
};

function resolveAdapter(presentation: CharacterVisualPresentation): CharacterVisualAdapter {
  switch (presentation) {
    case 'sprite':
      return spriteAdapter;
    case 'hybrid':
      return hybridAdapter;
    case '3d':
    default:
      return threeDAdapter;
  }
}

export function createCharacterVisualHandle(characterId: CharacterId, playerId: PlayerId): CharacterVisualHandle {
  const profile = CHARACTER_BY_ID[characterId].visuals;
  const adapter = resolveAdapter(profile.presentation);
  return {
    characterId,
    profile,
    adapter,
    node: adapter.createNode(profile, playerId),
  };
}

export function updateCharacterVisualHandle(
  handle: CharacterVisualHandle,
  own: PlayerRenderSnapshot,
  opponent: PlayerRenderSnapshot,
  gameTime: number,
): void {
  handle.adapter.updateNode(handle.node, { own, opponent, gameTime });
}

export function disposeCharacterVisualNode(node: THREE.Object3D): void {
  node.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    if (mesh.material) {
      const material = mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(material)) {
        material.forEach((item) => item.dispose());
      } else {
        material.dispose();
      }
    }
  });
}

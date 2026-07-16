export type AssetKind = 'model' | 'sprite' | 'texture' | 'audio' | 'shader';
export type AssetReadiness = 'prototype' | 'alpha' | 'production';

export interface AssetBudgetHint {
  estimatedBytes?: number;
  estimatedTextureBytes?: number;
  estimatedTriangles?: number;
  estimatedVertices?: number;
  estimatedVfxEmitters?: number;
}

export interface AssetManifestEntryBase {
  id: string;
  preload?: boolean;
  readiness?: AssetReadiness;
  budget?: AssetBudgetHint;
}

export interface AssetFileEntry extends AssetManifestEntryBase {
  src: string;
  contentTypes?: string[];
  image?: {
    width: number;
    height: number;
  };
}

export interface AssetShaderEntry extends AssetManifestEntryBase {
  vertexSrc: string;
  fragmentSrc: string;
}

export interface AssetManifest {
  models: AssetFileEntry[];
  sprites: AssetFileEntry[];
  textures: AssetFileEntry[];
  audio: AssetFileEntry[];
  shaders: AssetShaderEntry[];
}

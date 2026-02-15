export type AssetKind = 'model' | 'sprite' | 'texture' | 'audio' | 'shader';

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
  budget?: AssetBudgetHint;
}

export interface AssetFileEntry extends AssetManifestEntryBase {
  src: string;
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

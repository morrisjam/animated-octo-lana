export type AssetKind = 'model' | 'sprite' | 'texture' | 'audio' | 'shader';

export interface AssetManifestEntryBase {
  id: string;
  preload?: boolean;
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

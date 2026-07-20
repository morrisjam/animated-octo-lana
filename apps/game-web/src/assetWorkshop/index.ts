import type { SpriteAnimationClip, SpriteAtlasSheet } from '../view/sprites/atlasDefinitions';
import {
  buildAssetWorkshopCatalog,
  formatWorkshopLabel,
  stepWorkshopFrame,
} from './model';

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Asset Workshop is missing #${id}.`);
  }
  return element as T;
}

const catalog = buildAssetWorkshopCatalog();
if (catalog.length === 0) {
  throw new Error('Asset Workshop found no packaged sprite characters.');
}

const characterSelect = requiredElement<HTMLSelectElement>('characterSelect');
const clipList = requiredElement<HTMLElement>('clipList');
const clipCount = requiredElement<HTMLElement>('clipCount');
const characterName = requiredElement<HTMLElement>('characterName');
const clipName = requiredElement<HTMLElement>('clipName');
const playbackBadge = requiredElement<HTMLElement>('playbackBadge');
const previewCanvas = requiredElement<HTMLCanvasElement>('previewCanvas');
const previousFrameButton = requiredElement<HTMLButtonElement>('previousFrame');
const playPauseButton = requiredElement<HTMLButtonElement>('playPause');
const nextFrameButton = requiredElement<HTMLButtonElement>('nextFrame');
const playbackStatus = requiredElement<HTMLElement>('playbackStatus');
const frameMetadata = requiredElement<HTMLElement>('frameMetadata');
const sheetMetadata = requiredElement<HTMLElement>('sheetMetadata');
const sourceMetadata = requiredElement<HTMLElement>('sourceMetadata');
const gridMetadata = requiredElement<HTMLElement>('gridMetadata');
const cellMetadata = requiredElement<HTMLElement>('cellMetadata');
const anchorMetadata = requiredElement<HTMLElement>('anchorMetadata');
const worldMetadata = requiredElement<HTMLElement>('worldMetadata');
const timingMetadata = requiredElement<HTMLElement>('timingMetadata');
const sequenceMetadata = requiredElement<HTMLElement>('sequenceMetadata');
const manifestMetadata = requiredElement<HTMLElement>('manifestMetadata');
const context = previewCanvas.getContext('2d');
if (!context) {
  throw new Error('Asset Workshop requires Canvas 2D support.');
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();
let characterIndex = 0;
let selectedClipId = catalog[0].clipIds[0];
let currentFrameIndex = 0;
let currentImage: HTMLImageElement | null = null;
let playing = true;
let playbackAccumulatorMs = 0;
let lastAnimationTime = performance.now();
let imageRequest = 0;

function activeCharacter() {
  return catalog[characterIndex];
}

function activeClip(): SpriteAnimationClip {
  return activeCharacter().animationSet.clips[selectedClipId];
}

function activeSheet(): SpriteAtlasSheet {
  const character = activeCharacter();
  const clip = activeClip();
  const sheet = character.animationSet.sheets[clip.sheetId];
  if (!sheet) {
    throw new Error(`Clip "${selectedClipId}" references missing sheet "${clip.sheetId}".`);
  }
  return sheet;
}

function loadSheetImage(sheet: SpriteAtlasSheet): Promise<HTMLImageElement> {
  const cached = imageCache.get(sheet.textureUrl);
  if (cached) {
    return cached;
  }
  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${sheet.textureUrl}.`));
    image.src = sheet.textureUrl;
  });
  imageCache.set(sheet.textureUrl, pending);
  return pending;
}

function drawPlaceholder(sheet: SpriteAtlasSheet): void {
  previewCanvas.width = sheet.frameWidthPixels;
  previewCanvas.height = sheet.frameHeightPixels;
  context.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  context.strokeStyle = 'rgba(87, 232, 255, 0.35)';
  context.lineWidth = 1;
  context.strokeRect(0.5, 0.5, previewCanvas.width - 1, previewCanvas.height - 1);
}

function drawAnchor(sheet: SpriteAtlasSheet): void {
  const x = sheet.anchorX * sheet.frameWidthPixels;
  const y = (1 - sheet.anchorY) * sheet.frameHeightPixels;
  const arm = Math.max(5, Math.min(sheet.frameWidthPixels, sheet.frameHeightPixels) * 0.06);
  context.save();
  context.strokeStyle = '#57e8ff';
  context.lineWidth = Math.max(1, sheet.frameWidthPixels / 180);
  context.beginPath();
  context.moveTo(x - arm, y);
  context.lineTo(x + arm, y);
  context.moveTo(x, y - arm);
  context.lineTo(x, y + arm);
  context.stroke();
  context.restore();
}

function drawCurrentFrame(): void {
  const sheet = activeSheet();
  const clip = activeClip();
  const frame = clip.frames[currentFrameIndex];
  previewCanvas.width = sheet.frameWidthPixels;
  previewCanvas.height = sheet.frameHeightPixels;
  context.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  if (currentImage) {
    const column = frame % sheet.columns;
    const row = Math.floor(frame / sheet.columns);
    const sourceX = sheet.marginPixels + column * (sheet.frameWidthPixels + sheet.spacingPixels);
    const sourceY = sheet.marginPixels + row * (sheet.frameHeightPixels + sheet.spacingPixels);
    context.drawImage(
      currentImage,
      sourceX,
      sourceY,
      sheet.frameWidthPixels,
      sheet.frameHeightPixels,
      0,
      0,
      sheet.frameWidthPixels,
      sheet.frameHeightPixels,
    );
  }
  drawAnchor(sheet);
  frameMetadata.textContent = `${currentFrameIndex + 1} of ${clip.frames.length} (cell ${frame})`;
}

function setPlaybackStatus(message: string, error = false): void {
  playbackStatus.textContent = message;
  playbackStatus.dataset.error = String(error);
}

function updateTransport(): void {
  const clip = activeClip();
  const canAnimate = clip.frames.length > 1;
  previousFrameButton.disabled = !canAnimate;
  nextFrameButton.disabled = !canAnimate;
  playPauseButton.disabled = !canAnimate;
  playPauseButton.textContent = playing ? 'Pause' : 'Play';
  playbackBadge.textContent = `${clip.fps} FPS / ${clip.loop ? 'Loop' : 'Once'}`;
}

function updateMetadata(): void {
  const character = activeCharacter();
  const clip = activeClip();
  const sheet = activeSheet();
  characterName.textContent = formatWorkshopLabel(character.characterId);
  clipName.textContent = formatWorkshopLabel(selectedClipId);
  sheetMetadata.textContent = sheet.id;
  sourceMetadata.textContent = sheet.textureUrl;
  gridMetadata.textContent = `${sheet.columns} columns x ${sheet.rows} rows / ${sheet.atlasWidthPixels} x ${sheet.atlasHeightPixels}px`;
  cellMetadata.textContent = `${sheet.frameWidthPixels} x ${sheet.frameHeightPixels}px / margin ${sheet.marginPixels}px / gap ${sheet.spacingPixels}px`;
  anchorMetadata.textContent = `X ${sheet.anchorX.toFixed(3)} / Y ${sheet.anchorY.toFixed(3)}`;
  worldMetadata.textContent = `${sheet.worldWidth} x ${sheet.worldHeight}`;
  timingMetadata.textContent = `${clip.fps} FPS / ${clip.loop ? 'loops' : 'plays once'}`;
  sequenceMetadata.textContent = clip.frames.join(', ');
  manifestMetadata.textContent = character.source;
  updateTransport();
}

function rebuildClipList(): void {
  const character = activeCharacter();
  clipList.replaceChildren();
  clipCount.textContent = String(character.clipIds.length).padStart(2, '0');
  for (const clipId of character.clipIds) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'clip-button';
    button.textContent = formatWorkshopLabel(clipId);
    button.dataset.clipId = clipId;
    button.setAttribute('aria-current', String(clipId === selectedClipId));
    button.addEventListener('click', () => selectClip(clipId));
    clipList.append(button);
  }
}

function refreshClipSelection(): void {
  for (const element of clipList.querySelectorAll<HTMLButtonElement>('.clip-button')) {
    element.setAttribute('aria-current', String(element.dataset.clipId === selectedClipId));
  }
}

function selectClip(clipId: string): void {
  const character = activeCharacter();
  if (!character.animationSet.clips[clipId]) {
    return;
  }
  selectedClipId = clipId;
  currentFrameIndex = 0;
  currentImage = null;
  playbackAccumulatorMs = 0;
  lastAnimationTime = performance.now();
  playing = activeClip().frames.length > 1;
  refreshClipSelection();
  updateMetadata();
  const sheet = activeSheet();
  drawPlaceholder(sheet);
  drawAnchor(sheet);
  setPlaybackStatus(`Loading ${sheet.id}...`);
  const request = ++imageRequest;
  void loadSheetImage(sheet).then((image) => {
    if (request !== imageRequest) {
      return;
    }
    currentImage = image;
    drawCurrentFrame();
    setPlaybackStatus('Ready at authored timing.');
  }).catch((error: unknown) => {
    if (request !== imageRequest) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    setPlaybackStatus(message, true);
  });
}

function selectCharacter(index: number): void {
  characterIndex = index;
  selectedClipId = activeCharacter().clipIds[0];
  rebuildClipList();
  selectClip(selectedClipId);
}

function stepFrame(direction: -1 | 1): void {
  const clip = activeClip();
  playing = false;
  playbackAccumulatorMs = 0;
  currentFrameIndex = stepWorkshopFrame(currentFrameIndex, direction, clip.frames.length);
  updateTransport();
  drawCurrentFrame();
}

function togglePlayback(): void {
  const clip = activeClip();
  if (clip.frames.length <= 1) {
    return;
  }
  if (!playing && !clip.loop && currentFrameIndex === clip.frames.length - 1) {
    currentFrameIndex = 0;
  }
  playing = !playing;
  playbackAccumulatorMs = 0;
  lastAnimationTime = performance.now();
  updateTransport();
  drawCurrentFrame();
}

for (let index = 0; index < catalog.length; index += 1) {
  const option = document.createElement('option');
  option.value = String(index);
  option.textContent = formatWorkshopLabel(catalog[index].characterId);
  characterSelect.append(option);
}

characterSelect.addEventListener('change', () => selectCharacter(Number(characterSelect.value)));
previousFrameButton.addEventListener('click', () => stepFrame(-1));
playPauseButton.addEventListener('click', togglePlayback);
nextFrameButton.addEventListener('click', () => stepFrame(1));
document.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLSelectElement) {
    return;
  }
  if (event.code === 'Space') {
    event.preventDefault();
    togglePlayback();
  } else if (event.code === 'ArrowLeft') {
    event.preventDefault();
    stepFrame(-1);
  } else if (event.code === 'ArrowRight') {
    event.preventDefault();
    stepFrame(1);
  }
});

function animate(now: number): void {
  const deltaMs = Math.min(250, Math.max(0, now - lastAnimationTime));
  lastAnimationTime = now;
  if (playing && currentImage) {
    const clip = activeClip();
    playbackAccumulatorMs += deltaMs;
    const frameDurationMs = 1000 / clip.fps;
    let changed = false;
    while (playbackAccumulatorMs >= frameDurationMs) {
      playbackAccumulatorMs -= frameDurationMs;
      if (!clip.loop && currentFrameIndex === clip.frames.length - 1) {
        playing = false;
        playbackAccumulatorMs = 0;
        updateTransport();
        break;
      }
      currentFrameIndex = stepWorkshopFrame(currentFrameIndex, 1, clip.frames.length);
      changed = true;
    }
    if (changed) {
      drawCurrentFrame();
    }
  }
  requestAnimationFrame(animate);
}

selectCharacter(0);
requestAnimationFrame(animate);

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const assetDir = path.dirname(fileURLToPath(import.meta.url));
const assessmentPath = path.join(assetDir, "pre-spec-assessment.json");
const specPath = path.join(assetDir, "object-sculpt-spec.json");
const assessment = JSON.parse(fs.readFileSync(assessmentPath, "utf8"));
const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));

const colors = {
  hidden: "rgba(0, 0, 0, 0)",
  armor: "rgba(20, 34, 51, 1)",
  armorSecondary: "rgba(41, 61, 84, 1)",
  support: "rgba(7, 17, 28, 1)",
  supportSecondary: "rgba(16, 34, 49, 1)",
  cyan: "rgba(37, 218, 255, 1)",
  cyanSecondary: "rgba(117, 239, 255, 1)",
  violet: "rgba(139, 105, 255, 1)",
  violetSecondary: "rgba(191, 151, 255, 1)",
};

const paletteByMaterial = {
  hidden: [colors.hidden, colors.hidden, "unknown"],
  "armor-metal": [colors.armor, colors.armorSecondary, "metal"],
  "support-metal": [colors.support, colors.supportSecondary, "metal"],
  "emissive-cyan": [colors.cyan, colors.cyanSecondary, "glass"],
  "emissive-violet": [colors.violet, colors.violetSecondary, "glass"],
};

function hexToRgba(hex, alpha = 1) {
  const value = hex.replace("#", "");
  const channels = value.match(/.{2}/g).map((channel) => Number.parseInt(channel, 16));
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${alpha})`;
}

function arcSpine(radius, startDeg, endDeg, z, segments = 8, center = [0, 0]) {
  const points = [];
  for (let index = 0; index <= segments; index += 1) {
    const progress = index / segments;
    const angle = (startDeg + (endDeg - startDeg) * progress) * Math.PI / 180;
    points.push([
      Number((center[0] + Math.cos(angle) * radius).toFixed(4)),
      Number((center[1] + Math.sin(angle) * radius).toFixed(4)),
      z,
    ]);
  }
  return points;
}

function actionProfile(id, material, colliderScale, sockets = []) {
  return {
    animationRole: "static-stage-structure",
    pivot: {
      mode: "object-origin",
      localPosition: [0, 0, 0],
      axis: [0, 0, 1],
      confidence: 0.96,
    },
    transformChannels: {
      translate: true,
      rotate: true,
      scale: true,
      bend: false,
      twist: false,
      detach: false,
      visibility: true,
      materialState: material.startsWith("emissive"),
    },
    sockets,
    collider: {
      type: "box",
      offset: [0, 0, 0],
      scale: colliderScale,
      isTrigger: true,
      notes: "Decorative stage proxy only. Gameplay arena bounds remain authoritative and separate.",
    },
    constraints: ["Static during normal play", "May be hidden as one stage-detail group"],
    destruction: {
      breakable: false,
      fractureGroup: id,
      seamRefs: [],
      detachableFragments: [],
      breakImpulse: 0,
      debrisMaterial: material,
    },
  };
}

function component({
  id,
  name,
  level,
  role = "shell",
  primitive,
  material,
  parent = null,
  geometryDescriptor,
  dimensions,
  transform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  localFeatures = [],
  topologyClass = "assembled-solid",
  topologyRationale,
  confidence = 0.9,
  importance = 0.8,
  fidelityTier,
}) {
  const [dominant, secondary, materialClass] = paletteByMaterial[material];
  const hidden = topologyClass === "material-only";
  return {
    id,
    name,
    level,
    role,
    importance,
    confidence,
    primitive,
    topologyClass,
    topologyRationale,
    geometryDescriptor: {
      topologyIntent: "Low-poly beveled hard-surface stage geometry with stable non-planar volume.",
      edgeTreatment: {
        type: primitive === "curve-sweep" ? "profile-chamfer" : "bevel",
        bevelRadius: primitive === "curve-sweep" ? 0.035 : 0.045,
        segments: 2,
      },
      deformationStack: [],
      uvStrategy: "generated object-space coordinates",
      normalStrategy: "smooth path normals with deliberate hard material boundaries",
      ...geometryDescriptor,
    },
    parent,
    attachment: null,
    dimensions: {
      ...dimensions,
      units: "arena-radius-relative",
      confidence,
    },
    transform,
    actionProfile: actionProfile(id, material, [
      Math.max(dimensions.width ?? 0.1, 0.1),
      Math.max(dimensions.height ?? 0.1, 0.1),
      Math.max(dimensions.depth ?? 0.1, 0.1),
    ]),
    material,
    materialLayers: [material],
    colorMaterialRecipe: hidden ? undefined : {
      dominantAlbedo: dominant,
      secondaryAlbedo: secondary,
      materialClass,
      materialClassConfidence: materialClass === "glass" ? 0.72 : 0.9,
      colorGradient: {
        type: "linear",
        axis: [0, 1, 0],
        stops: [
          { position: 0, color: dominant },
          { position: 1, color: secondary },
        ],
      },
      evidenceRefs: ["full-object"],
    },
    deformations: [],
    joints: [],
    seams: [],
    localFeatures,
    surfaceDetail: {
      macroRoughness: material === "armor-metal" ? 0.12 : 0.04,
      microRoughness: material === "armor-metal" ? 0.08 : 0.025,
      bumpAmplitude: material === "armor-metal" ? 0.012 : 0,
      normalPattern: material === "armor-metal" ? "subtle directional brushed-metal breakup" : "",
      displacementPattern: "",
      occlusionPattern: material === "support-metal" ? "darken stacked recesses" : "",
      edgeWearPattern: material === "armor-metal" ? "restrained blue-grey bevel response" : "",
      notes: "Keep broad faces clean at gameplay distance; avoid micro-greeble noise.",
    },
    evidenceRefs: ["full-object"],
    details: [],
    fidelityTier: fidelityTier ?? level === "macro"
      ? "blockout"
      : level === "meso"
        ? "structural-pass"
        : "form-refinement",
  };
}

function groupComponent(id, name, level, localFeatures) {
  return component({
    id,
    name,
    level,
    role: "metadata-group",
    primitive: "box",
    material: "hidden",
    geometryDescriptor: {
      topologyIntent: "Invisible semantic pivot for review, visibility, and future stage-state control.",
    },
    dimensions: { width: 0.001, height: 0.001, depth: 0.001 },
    localFeatures,
    topologyClass: "material-only",
    topologyRationale: "This node is intentionally invisible and exists to expose semantic runtime grouping.",
    importance: 0.2,
    confidence: 1,
  });
}

function sweptArc({
  id,
  name,
  level,
  material,
  radius,
  start,
  end,
  z,
  width,
  depth,
  center,
  role = "shell",
  importance,
}) {
  return component({
    id,
    name,
    level,
    role,
    primitive: "curve-sweep",
    material,
    geometryDescriptor: {
      topologyIntent: "Rectangular armor or inlay profile swept along a measured open radial spine.",
      curveSweep: {
        spine: arcSpine(radius, start, end, z, level === "micro" ? 2 : 10, center),
        crossSection: {
          points: [
            [-width / 2, -depth / 2],
            [width / 2, -depth / 2],
            [width / 2, depth / 2],
            [-width / 2, depth / 2],
          ],
        },
        closed: false,
      },
    },
    dimensions: {
      width: radius * 2,
      height: radius * 2,
      depth,
    },
    topologyClass: "assembled-solid",
    topologyRationale: "The reference shows a discrete open arc with visible top, side, and underside faces rather than a flat decal or continuous torus.",
    importance,
  });
}

function sweptPath({
  id,
  name,
  level,
  material,
  points,
  width,
  depth,
  role = "landmark",
  importance = 0.9,
}) {
  return component({
    id,
    name,
    level,
    role,
    primitive: "curve-sweep",
    material,
    geometryDescriptor: {
      topologyIntent: "Taper-like curved landmark represented by a compact swept hard-surface profile.",
      curveSweep: {
        spine: points,
        crossSection: {
          points: [
            [-width / 2, -depth / 2],
            [width / 2, -depth / 2],
            [width / 2, depth / 2],
            [-width / 2, depth / 2],
          ],
        },
        closed: false,
      },
    },
    dimensions: {
      width: 1.4,
      height: 3.5,
      depth,
    },
    topologyClass: "assembled-solid",
    topologyRationale: "The reference shows a volumetric curved blade with a readable side wall from the three-quarter camera.",
    importance,
  });
}

function extrudedPlate({
  id,
  name,
  level,
  material,
  points,
  depth,
  parent = null,
  role = "landmark",
  importance = 0.85,
  transform,
}) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return component({
    id,
    name,
    level,
    role,
    primitive: "extrude",
    material,
    parent,
    geometryDescriptor: {
      topologyIntent: "Planar armor profile extruded into a beveled hard-surface plate.",
      profile2D: { points, depth },
    },
    dimensions: {
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      depth,
    },
    transform,
    topologyClass: "assembled-solid",
    topologyRationale: "The reference shows a plate-like landmark with a custom silhouette and finite depth.",
    importance,
  });
}

function material({
  id,
  name,
  baseColor,
  secondary,
  roughness,
  metalness,
  emissive,
  emissiveIntensity = 0,
  localOverrides = [],
  opacity = 1,
}) {
  return {
    id,
    name,
    type: emissive ? "physical-emissive" : "physical",
    shaderModel: "MeshPhysicalMaterial",
    baseColor,
    color: baseColor,
    albedo: {
      dominant: baseColor,
      secondary: [secondary],
      samplingNotes: "Palette sampled from the isolated arena-rim concept; no lighting is baked into runtime albedo.",
    },
    colorVariation: {
      palette: [baseColor, secondary],
      pattern: emissive ? "flat" : "low-amplitude directional",
      amplitude: emissive ? 0.02 : 0.07,
      heightCorrelation: 0.08,
    },
    textureResolution: 1024,
    textureProjection: {
      mode: "object-space",
      repeat: [2, 2],
      anisotropy: 4,
      texelDensityIntent: "Stable medium-scale detail with no visible tiling at gameplay distance.",
    },
    surfaceFrequencyBands: [
      { id: "macro", frequency: 1.5, amplitude: emissive ? 0.01 : 0.08, role: "broad value separation" },
      { id: "meso", frequency: 8, amplitude: emissive ? 0.01 : 0.04, role: "subtle plate finish variation" },
      { id: "micro", frequency: 42, amplitude: emissive ? 0.005 : 0.015, role: "grazing highlight breakup only" },
    ],
    roughness: {
      base: roughness,
      variation: emissive ? 0.02 : 0.08,
      map: "independent-procedural-field",
      localResponse: emissive ? "low roughness energy inlay" : "higher roughness in cavities, lower on bevels",
    },
    metalness: { base: metalness, variation: 0.03 },
    normal: {
      pattern: emissive ? "none" : "independent subtle brushed field",
      strength: emissive ? 0 : 0.16,
      scale: 28,
      space: "tangent",
    },
    bump: { pattern: "none", amplitude: 0, scale: 1 },
    displacement: { pattern: "none", amplitude: 0, scale: 1, silhouetteAffects: false },
    ambientOcclusion: {
      cavityStrength: emissive ? 0 : 0.32,
      contactShadowBias: 0.32,
      notes: "Darken true joins and stacked recesses only.",
    },
    wear: {
      edgeWear: id === "armor-metal" ? 0.12 : 0,
      scratches: [],
      chips: [],
    },
    dirt: {
      amount: id === "support-metal" ? 0.08 : 0.02,
      cavityBias: id === "support-metal" ? 0.75 : 0.25,
      color: "#03080d",
    },
    localOverrides,
    opacity: { base: opacity },
    transparent: opacity < 1,
    emissive: emissive ?? "#000000",
    emissiveIntensity,
    clearcoat: emissive ? 0.16 : 0.05,
    clearcoatRoughness: emissive ? 0.18 : 0.55,
    shaderNotes: [
      "Albedo, roughness, normal, and ambient occlusion remain independent.",
      "Broad geometry and material boundaries provide the visual read; procedural noise stays below gameplay-scale visibility.",
    ],
    notes: "Single-image source supports approximate material response, not physically exact inverse rendering.",
  };
}

const macroComponents = [
  groupComponent("root", "Arena Rim Runtime Root", "macro", [
    { id: "four-primary-breaks", description: "Top, left, right, and lower negative-space breaks remain open." },
  ]),
  groupComponent("outer-arc-segments", "Outer Arc Segment System", "macro", [
    { id: "beveled-arc-caps", description: "Each outer arc terminates with a broad chamfered cap." },
    { id: "panel-seams", description: "Large slabs receive sparse shallow panel seams." },
  ]),
  groupComponent("inner-prongs", "Crossing Inner Prong System", "macro", [
    { id: "tapered-crossing-profile", description: "Paired blades curve inward and cross near the lower center." },
  ]),
  groupComponent("crown-gate", "Split Crown Gate System", "macro", [
    { id: "split-crown-profile", description: "Small top gate remains split at top and bottom." },
  ]),
  groupComponent("lower-keystone", "Forked Lower Keystone System", "macro", [
    { id: "forked-keystone-profile", description: "Heavy lower landmark retains its central V notch." },
  ]),
  sweptArc({
    id: "outer-arc-upper-left",
    name: "Outer Arc Upper Left",
    level: "macro",
    material: "armor-metal",
    radius: 3.55,
    start: 103,
    end: 168,
    z: 0,
    width: 0.72,
    depth: 0.34,
    importance: 1,
  }),
  sweptArc({
    id: "outer-arc-upper-right",
    name: "Outer Arc Upper Right",
    level: "macro",
    material: "armor-metal",
    radius: 3.55,
    start: 12,
    end: 77,
    z: 0,
    width: 0.72,
    depth: 0.34,
    importance: 1,
  }),
  sweptArc({
    id: "outer-arc-lower-left",
    name: "Outer Arc Lower Left",
    level: "macro",
    material: "armor-metal",
    radius: 3.55,
    start: 192,
    end: 252,
    z: 0,
    width: 0.86,
    depth: 0.42,
    importance: 1,
  }),
  sweptArc({
    id: "outer-arc-lower-right",
    name: "Outer Arc Lower Right",
    level: "macro",
    material: "armor-metal",
    radius: 3.55,
    start: 288,
    end: 348,
    z: 0,
    width: 0.86,
    depth: 0.42,
    importance: 1,
  }),
  sweptPath({
    id: "inner-prong-left",
    name: "Inner Prong Left",
    level: "macro",
    material: "armor-metal",
    points: [
      [-0.74, 2.7, 0.08],
      [-0.98, 1.78, 0.05],
      [-0.74, 0.75, 0.04],
      [-0.2, -0.15, 0.03],
      [0.36, -1.1, 0.02],
    ],
    width: 0.34,
    depth: 0.36,
  }),
  sweptPath({
    id: "inner-prong-right",
    name: "Inner Prong Right",
    level: "macro",
    material: "armor-metal",
    points: [
      [0.74, 2.7, 0.08],
      [0.98, 1.78, 0.05],
      [0.74, 0.75, 0.04],
      [0.2, -0.15, 0.03],
      [-0.36, -1.1, 0.02],
    ],
    width: 0.34,
    depth: 0.36,
  }),
  sweptArc({
    id: "crown-gate-left",
    name: "Crown Gate Left",
    level: "macro",
    material: "armor-metal",
    radius: 0.82,
    start: 105,
    end: 255,
    z: 0.08,
    width: 0.34,
    depth: 0.38,
    center: [0, 2.65],
    importance: 0.92,
  }),
  sweptArc({
    id: "crown-gate-right",
    name: "Crown Gate Right",
    level: "macro",
    material: "armor-metal",
    radius: 0.82,
    start: -75,
    end: 75,
    z: 0.08,
    width: 0.34,
    depth: 0.38,
    center: [0, 2.65],
    importance: 0.92,
  }),
  extrudedPlate({
    id: "lower-keystone-left",
    name: "Lower Keystone Left",
    level: "macro",
    material: "armor-metal",
    parent: "lower-keystone",
    points: [
      [-1.45, -2.75],
      [-0.55, -2.45],
      [-0.08, -2.62],
      [-0.12, -3.12],
      [-0.14, -3.82],
      [-0.48, -4.12],
      [-0.98, -3.6],
    ],
    depth: 0.48,
  }),
  extrudedPlate({
    id: "lower-keystone-right",
    name: "Lower Keystone Right",
    level: "macro",
    material: "armor-metal",
    parent: "lower-keystone",
    points: [
      [1.45, -2.75],
      [0.55, -2.45],
      [0.08, -2.62],
      [0.12, -3.12],
      [0.14, -3.82],
      [0.48, -4.12],
      [0.98, -3.6],
    ],
    depth: 0.48,
  }),
];

const mesoComponents = [
  groupComponent("understructure", "Stacked Understructure System", "meso", [
    { id: "stacked-ribs", description: "Recessed structural arc and radial supports sit beneath armor." },
  ]),
  ...[
    ["under-arc-upper-left", "Under Arc Upper Left", 104, 167],
    ["under-arc-upper-right", "Under Arc Upper Right", 13, 76],
    ["under-arc-lower-left", "Under Arc Lower Left", 193, 251],
    ["under-arc-lower-right", "Under Arc Lower Right", 289, 347],
  ].map(([id, name, start, end]) => sweptArc({
    id,
    name,
    level: "meso",
    material: "support-metal",
    radius: 3.39,
    start,
    end,
    z: -0.3,
    width: 1.05,
    depth: 0.34,
    role: "understructure-shell",
    importance: 0.74,
  })),
  extrudedPlate({
    id: "cap-upper-left",
    name: "Upper Left Inward Cap",
    level: "meso",
    material: "armor-metal",
    points: [[-1.38, 3.18], [-0.78, 3.4], [-0.66, 3.08], [-1.18, 2.88]],
    depth: 0.38,
    importance: 0.7,
  }),
  extrudedPlate({
    id: "cap-upper-right",
    name: "Upper Right Inward Cap",
    level: "meso",
    material: "armor-metal",
    points: [[1.38, 3.18], [0.78, 3.4], [0.66, 3.08], [1.18, 2.88]],
    depth: 0.38,
    importance: 0.7,
  }),
  extrudedPlate({
    id: "cap-lower-left",
    name: "Lower Left Inward Cap",
    level: "meso",
    material: "armor-metal",
    points: [[-2.7, -2.05], [-2.0, -2.35], [-1.48, -2.92], [-2.35, -2.72]],
    depth: 0.42,
    importance: 0.72,
  }),
  extrudedPlate({
    id: "cap-lower-right",
    name: "Lower Right Inward Cap",
    level: "meso",
    material: "armor-metal",
    points: [[2.7, -2.05], [2.0, -2.35], [1.48, -2.92], [2.35, -2.72]],
    depth: 0.42,
    importance: 0.72,
  }),
  sweptPath({
    id: "prong-backing-left",
    name: "Prong Backing Left",
    level: "meso",
    material: "support-metal",
    points: [
      [-0.85, 2.72, -0.25],
      [-1.05, 1.8, -0.27],
      [-0.8, 0.78, -0.28],
      [-0.22, -0.35, -0.28],
    ],
    width: 0.52,
    depth: 0.3,
    importance: 0.7,
  }),
  sweptPath({
    id: "prong-backing-right",
    name: "Prong Backing Right",
    level: "meso",
    material: "support-metal",
    points: [
      [0.85, 2.72, -0.25],
      [1.05, 1.8, -0.27],
      [0.8, 0.78, -0.28],
      [0.22, -0.35, -0.28],
    ],
    width: 0.52,
    depth: 0.3,
    importance: 0.7,
  }),
];

const microComponents = [
  ...[
    ["cyan-channel-upper-left", "Cyan Channel Upper Left", 3.6, 108, 158],
    ["cyan-channel-upper-right", "Cyan Channel Upper Right", 3.6, 22, 70],
    ["cyan-channel-lower-left", "Cyan Channel Lower Left", 3.58, 205, 240],
    ["cyan-channel-lower-right", "Cyan Channel Lower Right", 3.58, 300, 338],
  ].map(([id, name, radius, start, end]) => sweptArc({
    id,
    name,
    level: "micro",
    material: "emissive-cyan",
    radius,
    start,
    end,
    z: 0.5,
    width: 0.075,
    depth: 0.055,
    role: "energy-inlay",
    importance: 0.62,
  })),
  sweptPath({
    id: "cyan-prong-left",
    name: "Cyan Prong Channel Left",
    level: "micro",
    material: "emissive-cyan",
    points: [
      [-0.65, 2.55, 0.27],
      [-0.74, 1.4, 0.27],
      [-0.4, 0.28, 0.27],
      [0.15, -0.55, 0.27],
    ],
    width: 0.045,
    depth: 0.035,
    role: "energy-inlay",
    importance: 0.68,
  }),
  sweptPath({
    id: "cyan-prong-right",
    name: "Cyan Prong Channel Right",
    level: "micro",
    material: "emissive-cyan",
    points: [
      [0.65, 2.55, 0.27],
      [0.74, 1.4, 0.27],
      [0.4, 0.28, 0.27],
      [-0.15, -0.55, 0.27],
    ],
    width: 0.045,
    depth: 0.035,
    role: "energy-inlay",
    importance: 0.68,
  }),
  sweptArc({
    id: "violet-accent-left",
    name: "Violet Accent Left",
    level: "micro",
    material: "emissive-violet",
    radius: 3.62,
    start: 125,
    end: 151,
    z: 0.5,
    width: 0.065,
    depth: 0.05,
    role: "energy-inlay",
    importance: 0.5,
  }),
  sweptArc({
    id: "violet-accent-right",
    name: "Violet Accent Right",
    level: "micro",
    material: "emissive-violet",
    radius: 3.62,
    start: 312,
    end: 336,
    z: 0.5,
    width: 0.065,
    depth: 0.05,
    role: "energy-inlay",
    importance: 0.5,
  }),
  extrudedPlate({
    id: "keystone-cyan-inlay",
    name: "Keystone Cyan Inlay",
    level: "micro",
    material: "emissive-cyan",
    parent: "lower-keystone",
    points: [
      [-0.5, -2.66],
      [-0.38, -2.64],
      [-0.1, -3.08],
      [-0.16, -3.78],
      [-0.26, -3.82],
      [-0.24, -3.1]
    ],
    depth: 0.055,
    importance: 0.62,
    transform: { position: [0, 0, 0.5], rotation: [0, 0, 0], scale: [1, 1, 1] },
  }),
  extrudedPlate({
    id: "keystone-cyan-inlay-right",
    name: "Keystone Cyan Inlay Right",
    level: "micro",
    material: "emissive-cyan",
    parent: "lower-keystone",
    points: [
      [0.5, -2.66],
      [0.38, -2.64],
      [0.1, -3.08],
      [0.16, -3.78],
      [0.26, -3.82],
      [0.24, -3.1]
    ],
    depth: 0.055,
    importance: 0.62,
    transform: { position: [0, 0, 0.5], rotation: [0, 0, 0], scale: [1, 1, 1] },
  }),
  extrudedPlate({
    id: "keystone-violet-inlay",
    name: "Keystone Violet Inlay",
    level: "micro",
    material: "emissive-violet",
    parent: "lower-keystone",
    points: [[0.36, -2.82], [0.44, -2.8], [0.47, -3.46], [0.38, -3.66]],
    depth: 0.055,
    importance: 0.48,
    transform: { position: [0, 0, 0.51], rotation: [0, 0, 0], scale: [1, 1, 1] },
  }),
];

spec.suitability = "conditional";
spec.scores = {
  object_isolation: 3,
  silhouette_readability: 3,
  depth_inference: 2,
  primitive_decomposition: 3,
  material_procedurality: 3,
  occlusion_risk: 1,
  interaction_fit: 3,
};
spec.preSpecAssessment = assessment.preSpecAssessment;
spec.qualityContract = assessment.qualityContract;
spec.qualityTargets = {
  targetFidelity: 0.76,
  mustMatch: [
    "four broken outer-boundary gaps",
    "layered outer armor and recessed understructure",
    "split crown, crossing inner prongs, and forked lower keystone",
    "sparse cyan and violet emissive routing",
  ],
  niceToHave: [
    "subtle plate seams",
    "restrained bevel wear",
  ],
  fpsTarget: 60,
  reviewViewpoints: ["reference-three-quarter", "front-orthographic", "left-orbit-30", "right-orbit-30"],
};
spec.referenceCamera = {
  solved: false,
  fovDegrees: 36,
  aspect: 1,
  orientation: { yaw: 0, pitch: -0.58, roll: 0 },
  positionHint: [0, -6.8, 9.2],
  note: "Approximate three-quarter studio camera from a generated concept; review framing is matched manually.",
};
spec.assumptions = [
  "Hidden rear faces use clean beveled metal with no invented greebles.",
  "The structure is decorative and never replaces the authoritative circular gameplay boundary.",
  "Final stage scale, plane tilt, and bloom intensity remain runtime-adjustable.",
  "Single-image reconstruction is intentionally approximate on the unseen underside.",
];
spec.coordinateFrame = {
  front: "positive Z, facing the reference camera",
  up: "positive Y in the aperture plane",
  scaleReference: "outer armor centerline radius is 3.55 units",
};
spec.silhouette = {
  boundingShape: "broken circular aperture approximately 7.8 units wide by 7.4 units high",
  aspectRatios: ["outer width:height = 1.05", "armor radial width:radius = 0.22", "depth:diameter = 0.07"],
  symmetry: "approximately bilateral with intentionally unequal segment lengths and accent routing",
  dominantCurves: [
    "four open outer armor arcs",
    "two inward S-curved blades",
    "two compact crown arcs",
  ],
  negativeSpaces: [
    "large hollow arena center",
    "top split between crown halves",
    "left and right boundary breaks",
    "V-shaped lower keystone notch",
  ],
  landmarks: [
    "split top crown",
    "crossing inner prongs",
    "forked lower keystone",
    "broad lower armor shoulders",
  ],
};
spec.viewEvidence = [
  {
    id: "full-object",
    view: "elevated three-quarter",
    imageRegion: { x: 0, y: 0, width: 1, height: 1, units: "normalized" },
    observations: [
      "Entire object is isolated against a dark neutral background.",
      "Top faces, outer walls, and underside supports are visible.",
      "Four macro gaps and three unique landmark systems define identity.",
    ],
    confidence: 0.96,
  },
];
spec.componentTree = [...macroComponents, ...mesoComponents, ...microComponents];
spec.materials = [
  material({
    id: "hidden",
    name: "Invisible Semantic Node",
    baseColor: "#000000",
    secondary: "#000000",
    roughness: 1,
    metalness: 0,
    opacity: 0,
  }),
  material({
    id: "armor-metal",
    name: "Midnight Armor Metal",
    baseColor: "#142233",
    secondary: "#293d54",
    roughness: 0.44,
    metalness: 0.78,
    localOverrides: [
      {
        id: "edge-wear-response",
        region: "top-facing bevels",
        roughness: 0.26,
        color: "#365776",
        geometryEffect: "none",
        evidenceRefs: ["full-object"],
      },
    ],
  }),
  material({
    id: "support-metal",
    name: "Recessed Support Metal",
    baseColor: "#07111c",
    secondary: "#102231",
    roughness: 0.68,
    metalness: 0.58,
  }),
  material({
    id: "emissive-cyan",
    name: "Cyan Energy Inlay",
    baseColor: "#25daff",
    secondary: "#75efff",
    roughness: 0.2,
    metalness: 0.05,
    emissive: "#16c8ff",
    emissiveIntensity: 0.72,
    localOverrides: [
      {
        id: "arc-channel-layout",
        region: "selected outer arcs and inner prongs",
        roughness: 0.16,
        emissiveIntensity: 0.72,
        geometryEffect: "raised inset strip",
        evidenceRefs: ["full-object"],
      },
    ],
  }),
  material({
    id: "emissive-violet",
    name: "Violet Energy Accent",
    baseColor: "#8b69ff",
    secondary: "#bf97ff",
    roughness: 0.22,
    metalness: 0.04,
    emissive: "#7652ff",
    emissiveIntensity: 0.58,
    localOverrides: [
      {
        id: "accent-channel-layout",
        region: "short asymmetric cap and keystone accents",
        roughness: 0.18,
        emissiveIntensity: 0.58,
        geometryEffect: "raised inset strip",
        evidenceRefs: ["full-object"],
      },
    ],
  }),
];
spec.repetitionSystems = [
  {
    id: "radial-support-ribs",
    name: "Radial Support Ribs",
    level: "meso",
    parent: "root",
    count: 16,
    primitive: "extrude",
    material: "support-metal",
    instanceScale: [0.11, 0.42, 0.18],
    placement: {
      mode: "radial",
      axis: [0, 0, 1],
      radius: 6.55,
      startAngleDeg: 11.25,
    },
    evidenceRefs: ["full-object"],
  },
  {
    id: "recessed-seam-tabs",
    name: "Recessed Seam Tabs",
    level: "micro",
    parent: "root",
    count: 12,
    primitive: "extrude",
    material: "support-metal",
    instanceScale: [0.08, 0.22, 0.06],
    placement: {
      mode: "radial",
      axis: [0, 0, 1],
      radius: 7,
      startAngleDeg: 15,
    },
    evidenceRefs: ["full-object"],
  },
];

const macroIds = macroComponents.map(({ id }) => id);
const mesoIds = mesoComponents.map(({ id }) => id);
const microIds = microComponents.map(({ id }) => id);
spec.buildPasses = [
  {
    id: "blockout",
    goal: "Lock the broken aperture silhouette and the three unique landmark systems.",
    componentRefs: macroIds,
    acceptance: [
      "All four outer gaps remain open.",
      "Crown, crossing prongs, and forked lower keystone are readable without emissive materials.",
      "Reference-aligned silhouette score reaches the configured visual threshold.",
    ],
  },
  {
    id: "structural-pass",
    goal: "Add recessed understructure, caps, and visible physical depth.",
    componentRefs: mesoIds,
    acceptance: [
      "Three physical depth layers read from the reference and orbit cameras.",
      "No child geometry floats or collapses from an orbited view.",
      "Decorative colliders remain triggers and do not alter gameplay bounds.",
    ],
  },
  {
    id: "form-refinement",
    goal: "Add sparse seams and emissive inlay geometry without cluttering the silhouette.",
    componentRefs: microIds,
    acceptance: [
      "Cyan and violet routes terminate before macro gaps.",
      "Micro geometry remains subordinate to the large armor forms.",
      "Multi-angle review confirms genuine depth.",
    ],
  },
  {
    id: "material-pass",
    goal: "Match midnight metal, recessed supports, and restrained energy channels.",
    componentRefs: [...macroIds, ...mesoIds, ...microIds],
    acceptance: [
      "Armor, support, cyan, and violet materials remain independently adjustable.",
      "Metal reads through roughness and lighting rather than baked highlights.",
      "Emissive channels remain readable without clipping to white.",
    ],
  },
  {
    id: "surface-pass",
    goal: "Add subtle broad and grazing-angle material breakup.",
    componentRefs: [...macroIds, ...mesoIds, ...microIds],
    acceptance: [
      "Broad faces remain clean at gameplay distance.",
      "Bevel response survives neutral and grazing lighting.",
      "No procedural texture aliases unrelated PBR channels.",
    ],
  },
  {
    id: "lighting-pass",
    goal: "Verify the structure under neutral, grazing, and wormhole-context lighting.",
    componentRefs: [...macroIds, ...mesoIds, ...microIds],
    acceptance: [
      "Reference camera exposes top, side, and underside layers.",
      "Live-stage exposure leaves fighters and action effects legible.",
      "Contact shadows do not create a false solid arena floor.",
    ],
  },
  {
    id: "interaction-pass",
    goal: "Expose runtime visibility, material-state, and decorative collider metadata.",
    componentRefs: [...macroIds, ...mesoIds, ...microIds],
    acceptance: [
      "Runtime nodes can hide armor, understructure, and energy systems independently.",
      "All collision proxies are non-authoritative triggers.",
      "No normal gameplay animation mutates static stage transforms.",
    ],
  },
  {
    id: "optimization-pass",
    goal: "Merge static same-material geometry and enforce the browser performance budget.",
    componentRefs: [...macroIds, ...mesoIds, ...microIds],
    acceptance: [
      "Near-detail geometry remains at or below 12000 triangles.",
      "Production adapter reduces the structure to at most 8 material draw calls.",
      "Far-detail mode removes micro inlays before silhouette geometry.",
    ],
  },
];
spec.featureReviewTargets = [
  {
    id: "broken-aperture-silhouette",
    name: "Broken outer aperture and four major gaps",
    tier: "critical",
    passIds: ["blockout", "structural-pass"],
    minimumScore: 0.82,
    mustPass: true,
    componentRefs: ["outer-arc-upper-left", "outer-arc-upper-right", "outer-arc-lower-left", "outer-arc-lower-right"],
    evidenceRefs: ["full-object"],
  },
  {
    id: "landmark-triad",
    name: "Crown, crossing prongs, and lower keystone",
    tier: "critical",
    passIds: ["blockout", "form-refinement"],
    minimumScore: 0.8,
    mustPass: true,
    componentRefs: ["crown-gate-left", "inner-prong-left", "inner-prong-right", "lower-keystone-left"],
    evidenceRefs: ["full-object"],
  },
  {
    id: "layered-physical-depth",
    name: "Armor, recessed support, and underside depth",
    tier: "critical",
    passIds: ["structural-pass", "lighting-pass"],
    minimumScore: 0.76,
    mustPass: true,
    componentRefs: ["outer-arc-upper-left", "under-arc-upper-left", "prong-backing-left"],
    evidenceRefs: ["full-object"],
  },
  {
    id: "energy-channel-routing",
    name: "Sparse cyan and violet channel routing",
    tier: "important",
    passIds: ["form-refinement", "material-pass"],
    minimumScore: 0.7,
    mustPass: false,
    componentRefs: ["cyan-channel-upper-left", "cyan-prong-left", "violet-accent-right"],
    evidenceRefs: ["full-object"],
  },
  {
    id: "gameplay-legibility",
    name: "Stage structure remains subordinate to fighters and effects",
    tier: "critical",
    passIds: ["lighting-pass", "optimization-pass"],
    minimumScore: 0.78,
    mustPass: true,
    componentRefs: ["root"],
    evidenceRefs: ["full-object"],
  },
];
spec.selfCorrectLoop.visualAcceptance.threshold = 0.72;
spec.lookDevTargets.qualityPriority = "balanced";
spec.lookDevTargets.materialPass.minimumTextureResolution = 512;
spec.lookDevTargets.materialPass.preferredTextureResolution = 1024;
spec.lookDevTargets.materialPass.referencePbrExtraction = {
  requiredWhenSourceImagePresent: false,
  targetThreshold: 0.7,
  stopOnLowConfidence: false,
  script: "forge/stage1_intake/extract_pbr_evidence.py",
  acceptedLimitation: "The source is a generated concept with baked studio lighting; runtime materials use measured palette and authored PBR values rather than claiming inverse-rendered accuracy.",
};
spec.lodPlan = [
  { tier: "near", distance: 0, strategy: "all armor, support, and energy components" },
  { tier: "gameplay", distance: 12, strategy: "merge by material and disable seam-tab repetition" },
  { tier: "far", distance: 28, strategy: "outer silhouette, crown, prongs, and keystone only" },
];
spec.performanceBudget = {
  qualityPriority: "balanced",
  targetTriangles: 12000,
  maxDrawCalls: 8,
  textureSize: 1024,
  fpsTarget: 60,
  optimizationPolicy: "Protect the broken silhouette and landmark triad first; merge static geometry by material and remove micro inlays for distant views.",
};
spec.lightingFromPhoto = [
  "Reference key light: cool-white area or directional key from upper-left, intensity 2.2, soft shadow.",
  "Reference fill light: deep blue hemisphere fill at approximately 0.55 intensity.",
  "Reference rim light: cyan rear-right rim at approximately 1.1 intensity to separate dark support layers.",
  "Exposure and tone mapping: ACES filmic, exposure near 1.0, preserve cyan and violet below clipping.",
  "Contact shadow: soft ambient occlusion only beneath overlapping armor; no ground-plane shadow because the prop floats around the well.",
];
spec.proceduralStrategy = [
  "Use open rectangular curve sweeps for the four outer arcs rather than a continuous torus.",
  "Represent the crown and inward blades as independent volumetric sweeps so they hold from orbit cameras.",
  "Use extruded custom profiles for the forked lower keystone and large inward caps.",
  "Keep cyan and violet channels as separate low-cost geometry for runtime intensity control.",
  "Merge static same-material geometries in the production adapter after visual approval.",
  "Retain the mathematical gameplay boundary as a separate system; this visual frame never controls knockout logic.",
];
spec.animationAnchors = [
  "root runtime node controls whole-structure visibility and presentation transform",
  "emissive material groups expose intensity for stage pulses without moving geometry",
  "outer, crown, prong, keystone, and understructure semantic nodes support future stage-event toggles",
];
spec.destructionAnchors = [
  "fracture group names remain stable but all groups are non-breakable for alpha",
  "future stage events may detach complete armor modules rather than fracture arbitrary triangles",
];
spec.risks = [
  "The single reference cannot prove exact underside geometry.",
  "Procedural curve-sweep frames may need manual normal correction after browser review.",
  "Unmerged pass-generated geometry exceeds the final draw-call target until the production adapter is applied.",
  "Emissive intensity must be re-evaluated against the live wormhole and combat effects.",
];

fs.writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`);

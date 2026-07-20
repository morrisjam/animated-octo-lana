"""Build the Duelist sprite candidate from one controllable Blender proxy.

Run with Blender 5.2.0:
  blender --background --python art/source/blender/duelist_sprite_v1.py

This source reuses only the deterministic render/export helpers from the Vanguard
lane. Duelist geometry, materials, posing, framing, and outputs remain independent.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import math
import shutil
import sys
from pathlib import Path
from typing import Dict, List, Sequence, Tuple

import bpy
from mathutils import Vector


ASSET_ID = "duelist_sprite_v1"
EXPECTED_BLENDER_VERSION = (5, 2, 0)
FRAME_NAMES = (
    "idle_a",
    "idle_b",
    "boost",
    "launch",
    "guard",
    "special",
    "dunk",
    "helpless",
)
RENDER_SIZE = 384
PORTRAIT_RENDER_SIZE = 512
RUNTIME_FRAME_SIZE = 128
ATLAS_COLUMNS = 4
ATLAS_ROWS = 2

SCRIPT_PATH = Path(__file__).resolve()
REPO_ROOT = SCRIPT_PATH.parents[3]
SOURCE_BLEND_PATH = SCRIPT_PATH.with_suffix(".blend")
CONCEPT_PATH = REPO_ROOT / "art" / "source" / "generated" / "duelist" / "duelist-concept-sheet-v2.png"
FRAME_DIR = REPO_ROOT / "art" / "review" / "duelist_sprite_v1_frames"
REVIEW_ATLAS_PATH = REPO_ROOT / "art" / "review" / "duelist_sprite_v1_atlas.png"
REVIEW_PORTRAIT_PATH = REPO_ROOT / "art" / "review" / "duelist_sprite_v1_portrait.png"
PORTRAIT_SOURCE_PATH = FRAME_DIR / "portrait_source.png"
METRICS_PATH = REPO_ROOT / "art" / "review" / "duelist_sprite_v1.metrics.json"
RUNTIME_DIR = REPO_ROOT / "apps" / "game-web" / "public" / "assets" / "characters" / "duelist"
RUNTIME_ATLAS_PATH = RUNTIME_DIR / "duelist-alpha-atlas-v2.png"
RUNTIME_PORTRAIT_PATH = RUNTIME_DIR / "duelist-alpha-portrait-v2.png"


def load_base_module():
    sys.dont_write_bytecode = True
    source_path = SCRIPT_PATH.with_name("vanguard_sprite_v1.py")
    spec = importlib.util.spec_from_file_location("gravity_well_sprite_helpers", source_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load deterministic character sprite helpers.")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


BASE = load_base_module()

# The shared output helpers intentionally read these module-level contracts.
BASE.ASSET_ID = ASSET_ID
BASE.CONCEPT_PATH = CONCEPT_PATH
BASE.FRAME_DIR = FRAME_DIR
BASE.REVIEW_ATLAS_PATH = REVIEW_ATLAS_PATH
BASE.REVIEW_PORTRAIT_PATH = REVIEW_PORTRAIT_PATH
BASE.PORTRAIT_SOURCE_PATH = PORTRAIT_SOURCE_PATH
BASE.METRICS_PATH = METRICS_PATH
BASE.RUNTIME_DIR = RUNTIME_DIR
BASE.RUNTIME_ATLAS_PATH = RUNTIME_ATLAS_PATH
BASE.RUNTIME_PORTRAIT_PATH = RUNTIME_PORTRAIT_PATH
BASE.RENDER_SIZE = RENDER_SIZE
BASE.RUNTIME_FRAME_SIZE = RUNTIME_FRAME_SIZE
BASE.REVIEW_COLUMNS = ATLAS_COLUMNS
BASE.REVIEW_ROWS = ATLAS_ROWS


def create_profile_prism(
    name: str,
    parent: bpy.types.Object,
    profile: Sequence[Tuple[float, float]],
    depth: float,
    material: bpy.types.Material,
    *,
    location: Tuple[float, float, float] = (0.0, 0.0, 0.0),
    bevel: float = 0.045,
) -> bpy.types.Object:
    """Extrude an X/Z silhouette along Y for readable angular armour."""
    if len(profile) < 3:
        raise ValueError("A profile prism needs at least three points.")
    vertices: List[Tuple[float, float, float]] = []
    for y in (-depth * 0.5, depth * 0.5):
        vertices.extend((x, y, z) for x, z in profile)
    count = len(profile)
    faces: List[Tuple[int, ...]] = [tuple(range(count)), tuple(reversed(range(count, count * 2)))]
    for index in range(count):
        next_index = (index + 1) % count
        faces.append((index, next_index, count + next_index, count + index))
    mesh = bpy.data.meshes.new(name=f"{name}_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.location = location
    obj.data.materials.append(material)
    modifier = obj.modifiers.new(name=f"{name}_edge", type="BEVEL")
    modifier.width = bevel
    modifier.segments = 2
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)
    return obj


def build_duelist() -> BASE.Rig:
    navy = BASE.create_material("duelist_navy", "#07101d", metallic=0.38, roughness=0.28)
    navy_soft = BASE.create_material("duelist_navy_soft", "#111d2d", metallic=0.22, roughness=0.4)
    cobalt = BASE.create_material("duelist_cobalt", "#17345f", metallic=0.42, roughness=0.3)
    cobalt_light = BASE.create_material("duelist_cobalt_light", "#285587", metallic=0.34, roughness=0.32)
    silver = BASE.create_material("duelist_silver", "#cbd4df", metallic=0.5, roughness=0.24)
    coral = BASE.create_material(
        "duelist_coral_emission",
        "#c52d55",
        metallic=0.08,
        roughness=0.2,
        emission_color="#ff416f",
        emission_strength=4.8,
    )
    ice = BASE.create_material(
        "duelist_ice_emission",
        "#3a9aba",
        metallic=0.08,
        roughness=0.22,
        emission_color="#77ddff",
        emission_strength=2.8,
    )

    root = bpy.data.objects.new(ASSET_ID, None)
    bpy.context.collection.objects.link(root)
    root["asset_id"] = ASSET_ID
    root["schema_version"] = "gw.character-sprite-source.v1"
    root["concept_reference"] = CONCEPT_PATH.relative_to(REPO_ROOT).as_posix()
    nodes: Dict[str, bpy.types.Object] = {"root": root}

    pelvis = BASE.empty("rig_pelvis", root, (0.0, 0.0, 3.65))
    torso = BASE.empty("rig_torso", pelvis, (0.0, 0.0, 1.45))
    head = BASE.empty("rig_head", torso, (0.0, 0.0, 1.92))
    nodes.update(pelvis=pelvis, torso=torso, head=head)

    BASE.bevel_box("pelvis_core", pelvis, (0.0, 0.0, 0.0), (0.72, 0.52, 0.48), navy_soft, bevel=0.16)
    create_profile_prism(
        "pelvis_arrow",
        pelvis,
        ((-0.62, 0.28), (0.62, 0.28), (0.38, -0.38), (0.0, -0.58), (-0.38, -0.38)),
        0.22,
        silver,
        location=(0.0, -0.58, 0.02),
        bevel=0.055,
    )
    BASE.bevel_box("torso_core", torso, (0.0, 0.0, 0.0), (1.0, 0.58, 1.14), navy, bevel=0.2)
    BASE.bevel_box(
        "chest_left",
        torso,
        (-0.46, -0.58, 0.25),
        (0.58, 0.15, 0.62),
        cobalt_light,
        bevel=0.14,
        rotation=(0.0, math.radians(-17), 0.0),
    )
    BASE.bevel_box(
        "chest_right",
        torso,
        (0.46, -0.58, 0.25),
        (0.58, 0.15, 0.62),
        cobalt,
        bevel=0.14,
        rotation=(0.0, math.radians(17), 0.0),
    )
    create_profile_prism(
        "chest_v",
        torso,
        ((-0.78, 0.53), (0.0, -0.24), (0.78, 0.53), (0.55, 0.78), (0.0, 0.25), (-0.55, 0.78)),
        0.12,
        silver,
        location=(0.0, -0.79, 0.36),
        bevel=0.04,
    )
    create_profile_prism(
        "chest_coral_mark",
        torso,
        ((-0.48, 0.38), (0.0, -0.05), (0.48, 0.38), (0.34, 0.5), (0.0, 0.2), (-0.34, 0.5)),
        0.08,
        coral,
        location=(0.0, -0.88, 0.22),
        bevel=0.025,
    )
    BASE.bevel_box("abdomen_keel", torso, (0.0, -0.56, -0.72), (0.36, 0.17, 0.48), cobalt, bevel=0.1)

    BASE.bevel_box("helmet", head, (0.0, 0.0, 0.0), (0.58, 0.5, 0.67), cobalt, bevel=0.23)
    create_profile_prism(
        "helmet_face",
        head,
        ((-0.48, 0.35), (0.0, -0.48), (0.48, 0.35), (0.32, 0.58), (-0.32, 0.58)),
        0.14,
        navy,
        location=(0.0, -0.52, -0.02),
        bevel=0.06,
    )
    BASE.bevel_box(
        "diagonal_visor",
        head,
        (0.0, -0.69, 0.05),
        (0.48, 0.055, 0.105),
        coral,
        bevel=0.055,
        rotation=(0.0, math.radians(-18), 0.0),
    )
    create_profile_prism(
        "helmet_fin",
        head,
        ((-0.18, 0.5), (0.0, 1.02), (0.28, 0.5), (0.2, 0.25), (-0.12, 0.22)),
        0.38,
        cobalt_light,
        location=(0.0, 0.0, 0.1),
        bevel=0.04,
    )

    # Fixed shoulder vane remains a readable chase-direction anchor while arms pose.
    create_profile_prism(
        "left_shoulder_vane",
        torso,
        ((0.15, 0.35), (-2.05, 1.05), (-1.62, 0.12), (-0.48, -0.35)),
        0.48,
        cobalt,
        location=(-0.78, 0.08, 0.83),
        bevel=0.08,
    )
    create_profile_prism(
        "left_shoulder_vane_edge",
        torso,
        ((-0.08, 0.46), (-1.75, 0.91), (-1.42, 0.56), (-0.4, 0.08)),
        0.14,
        silver,
        location=(-0.78, -0.28, 0.83),
        bevel=0.035,
    )

    for side, sign in (("left", -1.0), ("right", 1.0)):
        shoulder = BASE.empty(f"rig_{side}_shoulder", torso, (1.2 * sign, 0.0, 0.76))
        elbow = BASE.empty(f"rig_{side}_elbow", shoulder, (0.0, 0.0, -1.42))
        wrist = BASE.empty(f"rig_{side}_wrist", elbow, (0.0, 0.0, -1.28))
        nodes[f"{side}_shoulder"] = shoulder
        nodes[f"{side}_elbow"] = elbow
        nodes[f"{side}_wrist"] = wrist
        BASE.ellipsoid(f"{side}_pauldron", shoulder, (0.0, 0.0, -0.04), (0.62, 0.57, 0.5), cobalt_light if side == "left" else silver)
        BASE.cylinder(f"{side}_upper_arm", shoulder, (0.0, 0.0, -0.78), 0.34, 1.3, navy_soft)
        BASE.bevel_box(f"{side}_upper_plate", shoulder, (0.0, -0.35, -0.72), (0.29, 0.12, 0.54), cobalt, bevel=0.1)
        BASE.cylinder(f"{side}_forearm", elbow, (0.0, 0.0, -0.66), 0.39, 1.14, navy)
        BASE.bevel_box(f"{side}_forearm_plate", elbow, (0.0, -0.39, -0.62), (0.35, 0.13, 0.48), silver, bevel=0.11)
        BASE.ellipsoid(f"{side}_hand", wrist, (0.0, -0.02, -0.18), (0.32, 0.32, 0.38), navy_soft)

    lance = BASE.empty("rig_lance", nodes["right_wrist"], (0.0, -0.54, -0.08))
    nodes["lance"] = lance
    lance_profile = ((-0.26, 0.28), (0.24, 0.28), (0.19, -1.4), (0.0, -2.38), (-0.18, -1.4))
    create_profile_prism("lance_shell", lance, lance_profile, 0.28, cobalt_light, bevel=0.07)
    create_profile_prism(
        "lance_energy",
        lance,
        ((-0.11, 0.05), (0.11, 0.05), (0.09, -1.38), (0.0, -2.13), (-0.09, -1.38)),
        0.1,
        coral,
        location=(0.0, -0.2, -0.04),
        bevel=0.035,
    )

    claw = BASE.empty("rig_claw", nodes["left_wrist"], (0.0, -0.42, -0.18))
    nodes["claw"] = claw
    for index, x in enumerate((-0.27, 0.0, 0.27)):
        create_profile_prism(
            f"claw_tine_{index + 1}",
            claw,
            ((-0.08, 0.12), (0.08, 0.12), (0.05, -0.56), (0.0, -0.82), (-0.05, -0.56)),
            0.12,
            coral if index == 1 else silver,
            location=(x, -0.04 * index, 0.0),
            bevel=0.025,
        )

    for side, sign in (("left", -1.0), ("right", 1.0)):
        hip = BASE.empty(f"rig_{side}_hip", pelvis, (0.5 * sign, 0.0, -0.28))
        knee = BASE.empty(f"rig_{side}_knee", hip, (0.0, 0.0, -1.73))
        ankle = BASE.empty(f"rig_{side}_ankle", knee, (0.0, 0.0, -1.52))
        nodes[f"{side}_hip"] = hip
        nodes[f"{side}_knee"] = knee
        nodes[f"{side}_ankle"] = ankle
        BASE.cylinder(f"{side}_thigh", hip, (0.0, 0.0, -0.88), 0.43, 1.52, navy_soft)
        BASE.bevel_box(f"{side}_thigh_plate", hip, (0.0, -0.4, -0.82), (0.36, 0.14, 0.62), cobalt, bevel=0.11)
        BASE.ellipsoid(f"{side}_knee_guard", knee, (0.0, -0.3, -0.02), (0.43, 0.4, 0.42), silver)
        BASE.cylinder(f"{side}_calf", knee, (0.0, 0.0, -0.78), 0.38, 1.26, navy)
        BASE.bevel_box(f"{side}_shin_plate", knee, (0.0, -0.38, -0.76), (0.34, 0.14, 0.56), cobalt_light, bevel=0.1)
        BASE.bevel_box(f"{side}_boot", ankle, (0.0, -0.24, -0.28), (0.53, 0.72, 0.34), cobalt, bevel=0.14)
        BASE.bevel_box(f"{side}_boot_toe", ankle, (0.0, -0.84, -0.3), (0.5, 0.32, 0.27), silver, bevel=0.12)
        BASE.bevel_box(f"{side}_thruster", ankle, (0.0, 0.48, -0.25), (0.21, 0.12, 0.18), ice, bevel=0.055)

    return BASE.Rig(
        root=root,
        nodes=nodes,
        base_locations={name: node.location.copy() for name, node in nodes.items()},
        base_rotations={name: Vector(node.rotation_euler) for name, node in nodes.items()},
    )


def apply_pose(rig: BASE.Rig, frame_index: int) -> None:
    rig.reset()
    if frame_index == 0:
        rig.rotate("root", y=-5)
        rig.rotate("left_shoulder", y=7, z=-5)
        rig.rotate("right_shoulder", y=-9, z=5)
        rig.rotate("head", y=-4)
    elif frame_index == 1:
        rig.offset("root", z=0.08)
        rig.rotate("root", y=4)
        rig.rotate("torso", y=-5, z=-2)
        rig.rotate("left_shoulder", y=12, z=-8)
        rig.rotate("right_shoulder", y=-14, z=7)
        rig.rotate("head", y=8)
    elif frame_index == 2:
        rig.offset("root", x=-0.72, z=0.42)
        rig.rotate("root", y=24)
        rig.rotate("torso", y=9)
        rig.rotate("left_shoulder", y=62, z=-12)
        rig.rotate("left_elbow", y=18)
        rig.rotate("right_shoulder", y=48, z=9)
        rig.rotate("right_elbow", y=14)
        rig.rotate("left_hip", y=42)
        rig.rotate("left_knee", y=-46)
        rig.rotate("right_hip", y=-36)
        rig.rotate("right_knee", y=38)
    elif frame_index == 3:
        rig.offset("root", x=-1.9, z=0.26)
        rig.rotate("root", y=10)
        rig.rotate("torso", y=-18, z=-5)
        rig.rotate("right_shoulder", y=-96, z=5)
        rig.rotate("right_elbow", y=-5)
        rig.rotate("left_shoulder", y=36, z=-15)
        rig.rotate("left_elbow", y=35)
        rig.rotate("left_hip", y=30)
        rig.rotate("right_hip", y=-26)
    elif frame_index == 4:
        rig.offset("root", z=-0.08)
        rig.rotate("torso", y=-7)
        rig.rotate("right_shoulder", y=-48, z=12)
        rig.rotate("right_elbow", y=74)
        rig.rotate("lance", y=24)
        rig.rotate("left_shoulder", y=-43, z=-12)
        rig.rotate("left_elbow", y=-38)
        rig.rotate("claw", y=-12)
        rig.rotate("left_hip", y=-18)
        rig.rotate("left_knee", y=28)
        rig.rotate("right_hip", y=17)
        rig.rotate("right_knee", y=-24)
    elif frame_index == 5:
        rig.offset("root", x=-3.1, z=0.82)
        rig.rotate("root", y=45, z=-5)
        rig.rotate("torso", y=8)
        rig.rotate("right_shoulder", y=-135, z=4)
        rig.rotate("right_elbow", y=-4)
        rig.rotate("left_shoulder", y=52, z=-18)
        rig.rotate("left_elbow", y=22)
        rig.rotate("left_hip", y=44)
        rig.rotate("left_knee", y=-55)
        rig.rotate("right_hip", y=-38)
        rig.rotate("right_knee", y=46)
    elif frame_index == 6:
        rig.offset("root", x=0.1, z=0.58)
        rig.rotate("root", y=-14)
        rig.rotate("torso", y=13)
        rig.rotate("right_shoulder", y=18, z=5)
        rig.rotate("right_elbow", y=-15)
        rig.rotate("lance", y=-8)
        rig.rotate("left_shoulder", y=-30, z=-10)
        rig.rotate("left_elbow", y=22)
        rig.rotate("left_hip", y=34)
        rig.rotate("left_knee", y=-66)
        rig.rotate("right_hip", y=-29)
        rig.rotate("right_knee", y=62)
    elif frame_index == 7:
        rig.offset("root", x=-2.35, z=2.32)
        rig.rotate("root", y=73, z=9)
        rig.rotate("torso", y=-12, z=-8)
        rig.rotate("left_shoulder", y=52, z=-22)
        rig.rotate("left_elbow", y=-32)
        rig.rotate("right_shoulder", y=-56, z=18)
        rig.rotate("right_elbow", y=28)
        rig.rotate("left_hip", y=-39, z=-14)
        rig.rotate("left_knee", y=48)
        rig.rotate("right_hip", y=44, z=12)
        rig.rotate("right_knee", y=-44)
    else:
        raise ValueError(f"Unsupported Duelist frame index {frame_index}.")


def configure_scene() -> bpy.types.Object:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = RENDER_SIZE
    scene.render.resolution_y = RENDER_SIZE
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 20
    scene.render.film_transparent = True
    scene.render.dither_intensity = 0.0
    scene.render.use_file_extension = True
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.studio_light = "paint.sl"
    shading.color_type = "MATERIAL"
    shading.show_shadows = False
    shading.show_cavity = True
    shading.show_specular_highlight = True
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    scene.world.color = BASE.rgba("#030713")[:3]

    camera_data = bpy.data.cameras.new(name="duelist_sprite_camera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 11.7
    camera = bpy.data.objects.new(name="duelist_sprite_camera", object_data=camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (7.0, -28.0, 8.4)
    BASE.point_camera(camera, (0.0, 0.0, 4.25))
    scene.camera = camera

    lights = (
        ("key", "#dceaff", 1080.0, 7.0, (-7.0, -10.0, 13.0)),
        ("fill", "#638bc7", 620.0, 8.0, (9.0, -4.0, 10.0)),
        ("rim", "#ff416f", 980.0, 6.0, (3.0, 6.0, 11.0)),
    )
    for name, color, energy, size, location in lights:
        light_data = bpy.data.lights.new(name=f"duelist_{name}", type="AREA")
        light_data.color = BASE.rgba(color)[:3]
        light_data.energy = energy
        light_data.shape = "DISK"
        light_data.size = size
        light = bpy.data.objects.new(name=f"duelist_{name}", object_data=light_data)
        bpy.context.collection.objects.link(light)
        light.location = location
        BASE.point_camera(light, (0.0, 0.0, 4.2))
    return camera


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file_handle:
        for chunk in iter(lambda: file_handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalized_text_sha256(path: Path) -> str:
    normalized = path.read_text(encoding="utf-8").replace("\r\n", "\n").replace("\r", "\n")
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def artifact_record(path: Path) -> dict:
    width, height = BASE.image_dimensions(path)
    return {
        "path": path.relative_to(REPO_ROOT).as_posix(),
        "sha256": sha256(path),
        "bytes": path.stat().st_size,
        "widthPixels": width,
        "heightPixels": height,
    }


def main() -> None:
    if tuple(bpy.app.version) != EXPECTED_BLENDER_VERSION:
        expected = ".".join(str(part) for part in EXPECTED_BLENDER_VERSION)
        raise RuntimeError(f"This source is pinned to Blender {expected} but is running under {bpy.app.version_string}.")
    if not CONCEPT_PATH.exists():
        raise RuntimeError(f"Missing Duelist concept reference: {CONCEPT_PATH}")

    FRAME_DIR.mkdir(parents=True, exist_ok=True)
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    REVIEW_ATLAS_PATH.parent.mkdir(parents=True, exist_ok=True)
    BASE.clear_scene()
    bpy.context.preferences.filepaths.save_version = 0
    rig = build_duelist()
    camera = configure_scene()

    apply_pose(rig, 0)
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE_BLEND_PATH), check_existing=False)

    frame_paths: List[Path] = []
    for frame_index, frame_name in enumerate(FRAME_NAMES):
        apply_pose(rig, frame_index)
        bpy.context.view_layer.update()
        frame_path = FRAME_DIR / f"{frame_index:02d}_{frame_name}.png"
        BASE.render_frame(frame_path)
        frame_paths.append(frame_path)

    BASE.write_atlas(frame_paths, REVIEW_ATLAS_PATH, RENDER_SIZE)
    BASE.write_atlas(frame_paths, RUNTIME_ATLAS_PATH, RUNTIME_FRAME_SIZE)

    apply_pose(rig, 0)
    bpy.context.view_layer.update()
    bpy.context.scene.render.resolution_x = PORTRAIT_RENDER_SIZE
    bpy.context.scene.render.resolution_y = PORTRAIT_RENDER_SIZE
    camera.data.ortho_scale = 6.4
    camera.location = (5.6, -23.0, 8.8)
    BASE.point_camera(camera, (0.0, 0.0, 6.15))
    BASE.render_frame(PORTRAIT_SOURCE_PATH)
    BASE.write_scaled_image(PORTRAIT_SOURCE_PATH, RUNTIME_PORTRAIT_PATH, 256)
    shutil.copyfile(RUNTIME_PORTRAIT_PATH, REVIEW_PORTRAIT_PATH)
    PORTRAIT_SOURCE_PATH.unlink()

    metrics = {
        "schemaVersion": "gw.character-sprite-source-metrics.v1",
        "assetId": ASSET_ID,
        "characterId": "duelist",
        "blenderVersion": bpy.app.version_string,
        "renderEngine": bpy.context.scene.render.engine,
        "source": SCRIPT_PATH.relative_to(REPO_ROOT).as_posix(),
        "sourceSha256": normalized_text_sha256(SCRIPT_PATH),
        "sourceBlend": SOURCE_BLEND_PATH.relative_to(REPO_ROOT).as_posix(),
        "sharedRenderHelpers": BASE.SCRIPT_PATH.relative_to(REPO_ROOT).as_posix(),
        "sharedRenderHelpersSha256": normalized_text_sha256(BASE.SCRIPT_PATH),
        "conceptReference": {
            "path": CONCEPT_PATH.relative_to(REPO_ROOT).as_posix(),
            "sha256": sha256(CONCEPT_PATH),
            "bytes": CONCEPT_PATH.stat().st_size,
        },
        "frameOrder": list(FRAME_NAMES),
        "runtimeLayout": {
            "columns": ATLAS_COLUMNS,
            "rows": ATLAS_ROWS,
            "frameWidthPixels": RUNTIME_FRAME_SIZE,
            "frameHeightPixels": RUNTIME_FRAME_SIZE,
            "anchorX": 0.5,
            "anchorY": 0.1,
        },
        "artifacts": {
            "reviewAtlas": artifact_record(REVIEW_ATLAS_PATH),
            "reviewPortrait": artifact_record(REVIEW_PORTRAIT_PATH),
            "runtimeAtlas": artifact_record(RUNTIME_ATLAS_PATH),
            "runtimePortrait": artifact_record(RUNTIME_PORTRAIT_PATH),
        },
    }
    METRICS_PATH.write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()

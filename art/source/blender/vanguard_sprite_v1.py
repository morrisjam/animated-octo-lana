"""Build the Vanguard sprite candidate from one controllable Blender proxy.

Run with Blender 5.2.0:
  blender --background --python art/source/blender/vanguard_sprite_v1.py

The checked-in Python source is authoritative. It emits a review atlas, exact-size
runtime candidates, a source .blend file, and deterministic metadata. The runtime
manifest is intentionally not changed by this script.
"""

from __future__ import annotations

import hashlib
import json
import math
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Tuple

import bpy
from mathutils import Vector


ASSET_ID = "vanguard_sprite_v1"
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
REVIEW_COLUMNS = 4
REVIEW_ROWS = 2

SCRIPT_PATH = Path(__file__).resolve()
REPO_ROOT = SCRIPT_PATH.parents[3]
SOURCE_BLEND_PATH = SCRIPT_PATH.with_suffix(".blend")
CONCEPT_PATH = REPO_ROOT / "art" / "source" / "generated" / "vanguard" / "vanguard-concept-sheet-v2.png"
FRAME_DIR = REPO_ROOT / "art" / "review" / "vanguard_sprite_v1_frames"
REVIEW_ATLAS_PATH = REPO_ROOT / "art" / "review" / "vanguard_sprite_v1_atlas.png"
REVIEW_PORTRAIT_PATH = REPO_ROOT / "art" / "review" / "vanguard_sprite_v1_portrait.png"
PORTRAIT_SOURCE_PATH = FRAME_DIR / "portrait_source.png"
METRICS_PATH = REPO_ROOT / "art" / "review" / "vanguard_sprite_v1.metrics.json"
RUNTIME_DIR = REPO_ROOT / "apps" / "game-web" / "public" / "assets" / "characters" / "vanguard"
RUNTIME_ATLAS_PATH = RUNTIME_DIR / "vanguard-alpha-atlas-v2.png"
RUNTIME_PORTRAIT_PATH = RUNTIME_DIR / "vanguard-alpha-portrait-v2.png"

Color = Tuple[float, float, float, float]


def rgba(hex_color: str, alpha: float = 1.0) -> Color:
    value = hex_color.lstrip("#")
    if len(value) != 6:
        raise ValueError(f"Expected six-digit color, received {hex_color!r}.")
    return (
        int(value[0:2], 16) / 255.0,
        int(value[2:4], 16) / 255.0,
        int(value[4:6], 16) / 255.0,
        alpha,
    )


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file_handle:
        for chunk in iter(lambda: file_handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalized_text_sha256(path: Path) -> str:
    normalized = path.read_text(encoding="utf-8").replace("\r\n", "\n").replace("\r", "\n")
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for block in list(collection):
            collection.remove(block)


def set_principled_input(shader: bpy.types.ShaderNodeBsdfPrincipled, names: Sequence[str], value) -> None:
    for name in names:
        socket = shader.inputs.get(name)
        if socket is not None:
            socket.default_value = value
            return


def create_material(
    name: str,
    base_color: str,
    *,
    metallic: float = 0.0,
    roughness: float = 0.5,
    emission_color: str | None = None,
    emission_strength: float = 0.0,
) -> bpy.types.Material:
    material = bpy.data.materials.new(name=name)
    material.diffuse_color = rgba(base_color)
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    if shader is None:
        raise RuntimeError("Blender did not create a Principled BSDF node.")
    shader.inputs["Base Color"].default_value = rgba(base_color)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    if emission_color is not None:
        set_principled_input(shader, ("Emission Color", "Emission"), rgba(emission_color))
        set_principled_input(shader, ("Emission Strength",), emission_strength)
    return material


def link_local(obj: bpy.types.Object, parent: bpy.types.Object, location: Tuple[float, float, float]) -> bpy.types.Object:
    obj.parent = parent
    obj.location = location
    return obj


def empty(name: str, parent: bpy.types.Object, location: Tuple[float, float, float]) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.18
    return link_local(obj, parent, location)


def apply_bevel(obj: bpy.types.Object, width: float, segments: int = 2) -> None:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    modifier = obj.modifiers.new(name=f"{obj.name}_bevel", type="BEVEL")
    modifier.width = width
    modifier.segments = segments
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)


def bevel_box(
    name: str,
    parent: bpy.types.Object,
    location: Tuple[float, float, float],
    scale: Tuple[float, float, float],
    material: bpy.types.Material,
    *,
    bevel: float = 0.12,
    rotation: Tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=2.0)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    apply_bevel(obj, bevel)
    link_local(obj, parent, location)
    obj.rotation_euler = rotation
    obj.data.materials.append(material)
    return obj


def ellipsoid(
    name: str,
    parent: bpy.types.Object,
    location: Tuple[float, float, float],
    scale: Tuple[float, float, float],
    material: bpy.types.Material,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    link_local(obj, parent, location)
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    obj.select_set(False)
    return obj


def cylinder(
    name: str,
    parent: bpy.types.Object,
    location: Tuple[float, float, float],
    radius: float,
    depth: float,
    material: bpy.types.Material,
    *,
    vertices: int = 12,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth)
    obj = bpy.context.object
    obj.name = name
    link_local(obj, parent, location)
    obj.data.materials.append(material)
    apply_bevel(obj, min(radius * 0.2, 0.1), 2)
    return obj


def arc_band(
    name: str,
    parent: bpy.types.Object,
    material: bpy.types.Material,
    *,
    outer_radius: float,
    inner_radius: float,
    start_degrees: float,
    end_degrees: float,
    depth: float,
    segments: int = 30,
    y_offset: float = 0.0,
) -> bpy.types.Object:
    vertices: List[Tuple[float, float, float]] = []
    faces: List[Tuple[int, int, int, int]] = []
    for side_y in (-depth * 0.5, depth * 0.5):
        for index in range(segments + 1):
            t = index / segments
            angle = math.radians(start_degrees + (end_degrees - start_degrees) * t)
            vertices.append((math.cos(angle) * outer_radius, side_y + y_offset, math.sin(angle) * outer_radius))
            vertices.append((math.cos(angle) * inner_radius, side_y + y_offset, math.sin(angle) * inner_radius))

    side_stride = (segments + 1) * 2
    for index in range(segments):
        front = index * 2
        next_front = front + 2
        back = side_stride + front
        next_back = back + 2
        faces.extend(
            (
                (front, next_front, next_front + 1, front + 1),
                (back + 1, next_back + 1, next_back, back),
                (front, back, next_back, next_front),
                (front + 1, next_front + 1, next_back + 1, back + 1),
            )
        )
    faces.append((0, 1, side_stride + 1, side_stride))
    final_front = segments * 2
    final_back = side_stride + final_front
    faces.append((final_front + 1, final_front, final_back, final_back + 1))

    mesh = bpy.data.meshes.new(name=f"{name}_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.data.materials.append(material)
    bevel = obj.modifiers.new(name=f"{name}_edge", type="BEVEL")
    bevel.width = 0.055
    bevel.segments = 2
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    obj.select_set(False)
    return obj


@dataclass
class Rig:
    root: bpy.types.Object
    nodes: Dict[str, bpy.types.Object]
    base_locations: Dict[str, Vector]
    base_rotations: Dict[str, Vector]

    def reset(self) -> None:
        for name, node in self.nodes.items():
            node.location = self.base_locations[name]
            node.rotation_euler = self.base_rotations[name]

    def rotate(self, name: str, x: float = 0.0, y: float = 0.0, z: float = 0.0) -> None:
        node = self.nodes[name]
        base = self.base_rotations[name]
        node.rotation_euler = (
            base.x + math.radians(x),
            base.y + math.radians(y),
            base.z + math.radians(z),
        )

    def offset(self, name: str, x: float = 0.0, y: float = 0.0, z: float = 0.0) -> None:
        node = self.nodes[name]
        node.location = self.base_locations[name] + Vector((x, y, z))


def build_vanguard() -> Rig:
    ivory = create_material("vanguard_ivory", "#ded9c9", metallic=0.18, roughness=0.34)
    ivory_light = create_material("vanguard_ivory_light", "#f5f0df", metallic=0.12, roughness=0.28)
    graphite = create_material("vanguard_graphite", "#10191c", metallic=0.4, roughness=0.3)
    graphite_soft = create_material("vanguard_graphite_soft", "#263235", metallic=0.24, roughness=0.42)
    teal = create_material("vanguard_petrol_teal", "#294d4d", metallic=0.32, roughness=0.33)
    cyan = create_material(
        "vanguard_mint_emission",
        "#5ac9b2",
        metallic=0.08,
        roughness=0.22,
        emission_color="#7fffe3",
        emission_strength=4.2,
    )
    amber = create_material(
        "vanguard_amber",
        "#a85c1f",
        metallic=0.1,
        roughness=0.3,
        emission_color="#ff9e32",
        emission_strength=2.2,
    )

    root = bpy.data.objects.new(ASSET_ID, None)
    bpy.context.collection.objects.link(root)
    root["asset_id"] = ASSET_ID
    root["schema_version"] = "gw.character-sprite-source.v1"
    root["concept_reference"] = CONCEPT_PATH.relative_to(REPO_ROOT).as_posix()
    nodes: Dict[str, bpy.types.Object] = {"root": root}

    pelvis = empty("rig_pelvis", root, (0.0, 0.0, 3.75))
    torso = empty("rig_torso", pelvis, (0.0, 0.0, 1.55))
    head = empty("rig_head", torso, (0.0, 0.0, 2.15))
    nodes.update(pelvis=pelvis, torso=torso, head=head)

    # Core mass is deliberately grouped into broad value blocks for 128px readability.
    bevel_box("pelvis_core", pelvis, (0.0, 0.0, 0.0), (0.95, 0.65, 0.58), graphite_soft, bevel=0.2)
    bevel_box("pelvis_plate", pelvis, (0.0, -0.58, 0.08), (0.72, 0.16, 0.4), ivory, bevel=0.13)
    bevel_box("torso_core", torso, (0.0, 0.0, 0.0), (1.42, 0.72, 1.25), graphite, bevel=0.24)
    bevel_box("chest_plate", torso, (0.0, -0.7, 0.28), (1.28, 0.19, 0.9), ivory, bevel=0.18)
    bevel_box("chest_keel", torso, (0.0, -0.91, -0.18), (0.43, 0.11, 0.78), teal, bevel=0.1)
    bevel_box("chest_emitter", torso, (0.0, -1.04, 0.18), (0.34, 0.06, 0.11), cyan, bevel=0.06)
    bevel_box("collar_left", torso, (-0.7, -0.52, 1.06), (0.52, 0.28, 0.25), ivory_light, bevel=0.12, rotation=(0.0, math.radians(-8), 0.0))
    bevel_box("collar_right", torso, (0.7, -0.52, 1.06), (0.52, 0.28, 0.25), ivory_light, bevel=0.12, rotation=(0.0, math.radians(8), 0.0))

    bevel_box("helmet", head, (0.0, 0.0, 0.0), (0.72, 0.62, 0.72), ivory_light, bevel=0.3)
    bevel_box("helmet_brow", head, (0.0, -0.59, 0.15), (0.62, 0.12, 0.22), graphite, bevel=0.08)
    bevel_box("visor", head, (0.0, -0.74, 0.12), (0.53, 0.055, 0.09), cyan, bevel=0.06)
    bevel_box("helmet_jaw", head, (0.0, -0.55, -0.35), (0.48, 0.16, 0.22), teal, bevel=0.08)
    bevel_box("helmet_crown", head, (0.0, 0.03, 0.68), (0.25, 0.35, 0.12), teal, bevel=0.07)

    for side, sign in (("left", -1.0), ("right", 1.0)):
        shoulder = empty(f"rig_{side}_shoulder", torso, (1.55 * sign, 0.0, 0.94))
        elbow = empty(f"rig_{side}_elbow", shoulder, (0.0, 0.0, -1.55))
        wrist = empty(f"rig_{side}_wrist", elbow, (0.0, 0.0, -1.38))
        nodes[f"{side}_shoulder"] = shoulder
        nodes[f"{side}_elbow"] = elbow
        nodes[f"{side}_wrist"] = wrist
        ellipsoid(f"{side}_pauldron", shoulder, (0.0, 0.0, -0.08), (0.9, 0.8, 0.72), ivory)
        bevel_box(f"{side}_pauldron_teal", shoulder, (0.0, -0.72, -0.03), (0.46, 0.15, 0.46), teal, bevel=0.13)
        cylinder(f"{side}_upper_arm", shoulder, (0.0, 0.0, -0.86), 0.46, 1.45, graphite_soft)
        bevel_box(f"{side}_upper_plate", shoulder, (0.0, -0.43, -0.82), (0.39, 0.16, 0.58), ivory, bevel=0.12)
        cylinder(f"{side}_forearm", elbow, (0.0, 0.0, -0.72), 0.56 if side == "right" else 0.5, 1.25, teal)
        bevel_box(f"{side}_forearm_plate", elbow, (0.0, -0.48, -0.68), (0.48, 0.17, 0.52), ivory, bevel=0.14)
        ellipsoid(f"{side}_hand", wrist, (0.0, -0.04, -0.24), (0.48 if side == "right" else 0.38, 0.42, 0.48), graphite)

    # The left crescent is a permanent silhouette anchor; runtime VFX adds timing cues.
    shield = empty("rig_shield", nodes["left_wrist"], (-0.2, -0.62, -0.05))
    nodes["shield"] = shield
    arc_band(
        "shield_crescent_shell",
        shield,
        ivory,
        outer_radius=1.88,
        inner_radius=1.22,
        start_degrees=56.0,
        end_degrees=304.0,
        depth=0.26,
        y_offset=0.0,
    )
    arc_band(
        "shield_crescent_energy",
        shield,
        cyan,
        outer_radius=1.63,
        inner_radius=1.39,
        start_degrees=61.0,
        end_degrees=299.0,
        depth=0.12,
        y_offset=-0.22,
    )

    impact_gauntlet = empty("rig_impact_gauntlet", nodes["right_wrist"], (0.0, 0.0, -0.18))
    nodes["impact_gauntlet"] = impact_gauntlet
    bevel_box("impact_gauntlet_shell", impact_gauntlet, (0.0, -0.05, -0.18), (0.66, 0.58, 0.64), ivory, bevel=0.2)
    bevel_box("impact_gauntlet_face", impact_gauntlet, (0.0, -0.62, -0.2), (0.42, 0.12, 0.38), teal, bevel=0.12)
    bevel_box("impact_gauntlet_charge", impact_gauntlet, (0.0, -0.76, -0.2), (0.24, 0.045, 0.2), amber, bevel=0.07)

    for side, sign in (("left", -1.0), ("right", 1.0)):
        hip = empty(f"rig_{side}_hip", pelvis, (0.68 * sign, 0.0, -0.34))
        knee = empty(f"rig_{side}_knee", hip, (0.0, 0.0, -1.86))
        ankle = empty(f"rig_{side}_ankle", knee, (0.0, 0.0, -1.62))
        nodes[f"{side}_hip"] = hip
        nodes[f"{side}_knee"] = knee
        nodes[f"{side}_ankle"] = ankle
        cylinder(f"{side}_thigh", hip, (0.0, 0.0, -0.96), 0.59, 1.65, graphite_soft)
        bevel_box(f"{side}_thigh_plate", hip, (0.0, -0.5, -0.87), (0.5, 0.18, 0.7), ivory, bevel=0.14)
        ellipsoid(f"{side}_knee_guard", knee, (0.0, -0.38, -0.05), (0.56, 0.5, 0.5), teal)
        cylinder(f"{side}_calf", knee, (0.0, 0.0, -0.85), 0.52, 1.35, graphite)
        bevel_box(f"{side}_shin_plate", knee, (0.0, -0.5, -0.83), (0.48, 0.18, 0.64), ivory, bevel=0.14)
        bevel_box(f"{side}_boot", ankle, (0.0, -0.24, -0.34), (0.72, 0.96, 0.42), teal, bevel=0.18)
        bevel_box(f"{side}_boot_toe", ankle, (0.0, -0.98, -0.38), (0.68, 0.38, 0.34), ivory, bevel=0.16)
        bevel_box(f"{side}_thruster", ankle, (0.0, 0.64, -0.31), (0.3, 0.14, 0.22), amber, bevel=0.07)

    pose_nodes = {name: node for name, node in nodes.items()}
    return Rig(
        root=root,
        nodes=pose_nodes,
        base_locations={name: node.location.copy() for name, node in pose_nodes.items()},
        base_rotations={name: Vector(node.rotation_euler) for name, node in pose_nodes.items()},
    )


def apply_pose(rig: Rig, frame_index: int) -> None:
    rig.reset()
    if frame_index == 0:
        rig.rotate("root", y=-2)
        rig.rotate("left_shoulder", y=7, z=-4)
        rig.rotate("right_shoulder", y=-5, z=3)
        rig.rotate("left_hip", y=-3)
        rig.rotate("right_hip", y=4)
    elif frame_index == 1:
        rig.offset("root", z=0.08)
        rig.rotate("root", y=2)
        rig.rotate("torso", y=-3, z=1)
        rig.rotate("left_shoulder", y=11, z=-5)
        rig.rotate("right_shoulder", y=-8, z=5)
        rig.rotate("head", y=4)
    elif frame_index == 2:
        rig.offset("root", x=-0.55, z=0.34)
        rig.rotate("root", y=18)
        rig.rotate("torso", y=5)
        rig.rotate("left_shoulder", y=55, z=-6)
        rig.rotate("left_elbow", y=14)
        rig.rotate("right_shoulder", y=62, z=6)
        rig.rotate("right_elbow", y=12)
        rig.rotate("left_hip", y=35)
        rig.rotate("left_knee", y=-30)
        rig.rotate("right_hip", y=-23)
        rig.rotate("right_knee", y=28)
    elif frame_index == 3:
        rig.offset("root", x=-0.22, z=0.18)
        rig.rotate("root", y=7)
        rig.rotate("torso", y=-12, z=-3)
        rig.rotate("right_shoulder", y=-92, z=4)
        rig.rotate("right_elbow", y=-8)
        rig.rotate("left_shoulder", y=30, z=-8)
        rig.rotate("left_elbow", y=18)
        rig.rotate("left_hip", y=24)
        rig.rotate("right_hip", y=-18)
    elif frame_index == 4:
        rig.offset("root", z=-0.12)
        rig.rotate("torso", y=-5)
        rig.rotate("left_shoulder", y=-42, z=-8)
        rig.rotate("left_elbow", y=-34)
        rig.rotate("shield", y=16, z=-5)
        rig.rotate("right_shoulder", y=-28, z=8)
        rig.rotate("right_elbow", y=72)
        rig.rotate("left_hip", y=-16)
        rig.rotate("left_knee", y=24)
        rig.rotate("right_hip", y=15)
        rig.rotate("right_knee", y=-20)
    elif frame_index == 5:
        rig.offset("root", z=-0.18)
        rig.rotate("torso", y=-3)
        rig.rotate("left_shoulder", y=69, z=-8)
        rig.rotate("left_elbow", y=-12)
        rig.rotate("shield", y=-12)
        rig.rotate("right_shoulder", y=-68, z=8)
        rig.rotate("right_elbow", y=10)
        rig.rotate("left_hip", y=-24)
        rig.rotate("left_knee", y=38)
        rig.rotate("right_hip", y=24)
        rig.rotate("right_knee", y=-38)
    elif frame_index == 6:
        rig.offset("root", x=0.18, z=0.56)
        rig.rotate("root", y=-11)
        rig.rotate("torso", y=10)
        rig.rotate("right_shoulder", y=28, z=4)
        rig.rotate("right_elbow", y=-20)
        rig.rotate("left_shoulder", y=-20, z=-5)
        rig.rotate("left_elbow", y=26)
        rig.rotate("left_hip", y=31)
        rig.rotate("left_knee", y=-63)
        rig.rotate("right_hip", y=-24)
        rig.rotate("right_knee", y=58)
    elif frame_index == 7:
        rig.offset("root", x=-2.65, z=0.68)
        rig.rotate("root", y=67, z=8)
        rig.rotate("torso", y=-11, z=-7)
        rig.rotate("left_shoulder", y=46, z=-18)
        rig.rotate("left_elbow", y=-28)
        rig.rotate("right_shoulder", y=-58, z=16)
        rig.rotate("right_elbow", y=35)
        rig.rotate("left_hip", y=-34, z=-12)
        rig.rotate("left_knee", y=45)
        rig.rotate("right_hip", y=41, z=10)
        rig.rotate("right_knee", y=-42)
    else:
        raise ValueError(f"Unsupported Vanguard frame index {frame_index}.")


def point_camera(camera: bpy.types.Object, target: Tuple[float, float, float]) -> None:
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()


def configure_scene() -> bpy.types.Object:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
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
    # The 3x source render is box-filtered into the runtime atlas, so temporal
    # jitter is unnecessary and would make identical headless runs drift.
    scene.eevee.taa_render_samples = 1
    scene.eevee.taa_samples = 1
    scene.eevee.use_taa_reprojection = False
    scene.eevee.use_shadow_jitter_viewport = False
    scene.eevee.use_shadows = False
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    scene.world.color = rgba("#05080b")[:3]

    camera_data = bpy.data.cameras.new(name="vanguard_sprite_camera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 12.2
    camera = bpy.data.objects.new(name="vanguard_sprite_camera", object_data=camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (7.8, -28.0, 8.6)
    point_camera(camera, (0.0, 0.0, 4.45))
    scene.camera = camera

    lights = (
        ("key", "#d7f7f1", 1200.0, 7.0, (-7.0, -10.0, 14.0)),
        ("fill", "#8aa7b0", 700.0, 8.0, (9.0, -4.0, 10.0)),
        ("rim", "#68ffe1", 1050.0, 6.0, (3.0, 6.0, 12.0)),
    )
    for name, color, energy, size, location in lights:
        light_data = bpy.data.lights.new(name=f"vanguard_{name}", type="AREA")
        light_data.color = rgba(color)[:3]
        light_data.energy = energy
        light_data.shape = "DISK"
        light_data.size = size
        light = bpy.data.objects.new(name=f"vanguard_{name}", object_data=light_data)
        bpy.context.collection.objects.link(light)
        light.location = location
        point_camera(light, (0.0, 0.0, 4.4))
    return camera


def render_frame(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def read_image_pixels(path: Path) -> Tuple[int, int, List[float]]:
    image = bpy.data.images.load(str(path), check_existing=False)
    width, height = image.size
    pixels = list(image.pixels[:])
    bpy.data.images.remove(image)
    return width, height, pixels


def box_downsample(source: Sequence[float], source_size: int, target_size: int) -> List[float]:
    if source_size % target_size != 0:
        raise RuntimeError(f"Cannot box downsample {source_size}px into {target_size}px.")
    factor = source_size // target_size
    sample_count = factor * factor
    output = [0.0] * (target_size * target_size * 4)
    for target_y in range(target_size):
        for target_x in range(target_size):
            sums = [0.0, 0.0, 0.0, 0.0]
            for sample_y in range(factor):
                source_y = target_y * factor + sample_y
                for sample_x in range(factor):
                    source_x = target_x * factor + sample_x
                    source_index = (source_y * source_size + source_x) * 4
                    for channel in range(4):
                        sums[channel] += source[source_index + channel]
            target_index = (target_y * target_size + target_x) * 4
            for channel in range(4):
                output[target_index + channel] = sums[channel] / sample_count
    return output


def write_atlas(frame_paths: Sequence[Path], destination: Path, cell_size: int) -> None:
    atlas_width = cell_size * REVIEW_COLUMNS
    atlas_height = cell_size * REVIEW_ROWS
    atlas_pixels = [0.0] * (atlas_width * atlas_height * 4)
    for frame_index, frame_path in enumerate(frame_paths):
        width, height, source_pixels = read_image_pixels(frame_path)
        if width != height or width != RENDER_SIZE:
            raise RuntimeError(f"Frame {frame_path} is {width}x{height}; expected {RENDER_SIZE}x{RENDER_SIZE}.")
        cell_pixels = source_pixels if cell_size == RENDER_SIZE else box_downsample(source_pixels, RENDER_SIZE, cell_size)
        row = frame_index // REVIEW_COLUMNS
        column = frame_index % REVIEW_COLUMNS
        output_y_offset = (REVIEW_ROWS - 1 - row) * cell_size
        for y in range(cell_size):
            source_start = y * cell_size * 4
            destination_start = ((output_y_offset + y) * atlas_width + column * cell_size) * 4
            atlas_pixels[destination_start : destination_start + cell_size * 4] = cell_pixels[
                source_start : source_start + cell_size * 4
            ]

    destination.parent.mkdir(parents=True, exist_ok=True)
    image = bpy.data.images.new(
        name=f"{ASSET_ID}_{cell_size}",
        width=atlas_width,
        height=atlas_height,
        alpha=True,
        float_buffer=False,
    )
    image.pixels = atlas_pixels
    image.file_format = "PNG"
    image.filepath_raw = str(destination)
    image.save()
    bpy.data.images.remove(image)


def write_scaled_image(source_path: Path, destination: Path, target_size: int) -> None:
    width, height, source_pixels = read_image_pixels(source_path)
    if width != height:
        raise RuntimeError(f"Portrait source is {width}x{height}; expected a square image.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    image = bpy.data.images.new(name=f"{ASSET_ID}_portrait", width=target_size, height=target_size, alpha=True)
    image.pixels = box_downsample(source_pixels, width, target_size)
    image.file_format = "PNG"
    image.filepath_raw = str(destination)
    image.save()
    bpy.data.images.remove(image)


def image_dimensions(path: Path) -> Tuple[int, int]:
    image = bpy.data.images.load(str(path), check_existing=False)
    dimensions = tuple(image.size)
    bpy.data.images.remove(image)
    return dimensions


def artifact_record(path: Path) -> dict:
    width, height = image_dimensions(path)
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
        raise RuntimeError(f"Missing Vanguard concept reference: {CONCEPT_PATH}")

    FRAME_DIR.mkdir(parents=True, exist_ok=True)
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    REVIEW_ATLAS_PATH.parent.mkdir(parents=True, exist_ok=True)
    clear_scene()
    bpy.context.preferences.filepaths.save_version = 0
    rig = build_vanguard()
    camera = configure_scene()

    # Preserve the inspectable proxy in its neutral pose before producing frames.
    apply_pose(rig, 0)
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE_BLEND_PATH), check_existing=False)

    frame_paths: List[Path] = []
    for frame_index, frame_name in enumerate(FRAME_NAMES):
        apply_pose(rig, frame_index)
        frame_path = FRAME_DIR / f"{frame_index:02d}_{frame_name}.png"
        render_frame(frame_path)
        frame_paths.append(frame_path)

    write_atlas(frame_paths, REVIEW_ATLAS_PATH, RENDER_SIZE)
    write_atlas(frame_paths, RUNTIME_ATLAS_PATH, RUNTIME_FRAME_SIZE)

    apply_pose(rig, 0)
    bpy.context.scene.render.resolution_x = PORTRAIT_RENDER_SIZE
    bpy.context.scene.render.resolution_y = PORTRAIT_RENDER_SIZE
    camera.data.ortho_scale = 6.4
    camera.location = (6.0, -24.0, 9.2)
    point_camera(camera, (0.0, 0.0, 6.45))
    render_frame(PORTRAIT_SOURCE_PATH)
    write_scaled_image(PORTRAIT_SOURCE_PATH, RUNTIME_PORTRAIT_PATH, 256)
    shutil.copyfile(RUNTIME_PORTRAIT_PATH, REVIEW_PORTRAIT_PATH)
    PORTRAIT_SOURCE_PATH.unlink()

    metrics = {
        "schemaVersion": "gw.character-sprite-source-metrics.v1",
        "assetId": ASSET_ID,
        "characterId": "vanguard",
        "blenderVersion": bpy.app.version_string,
        "renderEngine": bpy.context.scene.render.engine,
        "source": SCRIPT_PATH.relative_to(REPO_ROOT).as_posix(),
        "sourceSha256": normalized_text_sha256(SCRIPT_PATH),
        "sourceBlend": SOURCE_BLEND_PATH.relative_to(REPO_ROOT).as_posix(),
        "conceptReference": {
            "path": CONCEPT_PATH.relative_to(REPO_ROOT).as_posix(),
            "sha256": sha256(CONCEPT_PATH),
            "bytes": CONCEPT_PATH.stat().st_size,
        },
        "frameOrder": list(FRAME_NAMES),
        "runtimeLayout": {
            "columns": REVIEW_COLUMNS,
            "rows": REVIEW_ROWS,
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

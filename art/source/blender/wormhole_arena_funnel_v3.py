"""Build the Blender 5.2 authored Gravity Well funnel candidate.

Run with Blender 5.2.0 LTS:
  blender --background --python art/source/blender/wormhole_arena_funnel_v3.py
"""

from __future__ import annotations

import hashlib
import json
import math
import struct
from pathlib import Path

import bpy
from mathutils import Vector


ASSET_ID = "wormhole_arena_funnel_v3"
EXPECTED_BLENDER_VERSION = (5, 2, 0)
TRIANGLE_BUDGET = 12_000
VERTEX_BUDGET = 14_000
GLB_BYTE_BUDGET = 384 * 1024

SCRIPT_PATH = Path(__file__).resolve()
REPO_ROOT = SCRIPT_PATH.parents[3]
SOURCE_BLEND_PATH = SCRIPT_PATH.with_suffix(".blend")
RUNTIME_DIR = REPO_ROOT / "apps" / "game-web" / "public" / "assets" / "stages" / "wormhole"
RUNTIME_GLB_PATH = RUNTIME_DIR / "wormhole-arena-funnel-v3.glb"
REVIEW_PREVIEW_PATH = REPO_ROOT / "art" / "review" / "wormhole_arena_funnel_v3.png"
REVIEW_METRICS_PATH = REPO_ROOT / "art" / "review" / "wormhole_arena_funnel_v3.metrics.json"


def assert_blender_version() -> None:
    if tuple(bpy.app.version) != EXPECTED_BLENDER_VERSION:
        expected = ".".join(str(part) for part in EXPECTED_BLENDER_VERSION)
        raise RuntimeError(
            f"This source is pinned to Blender {expected} but is running under {bpy.app.version_string}."
        )


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


def rgba(hex_color: str, alpha: float = 1.0) -> tuple[float, float, float, float]:
    value = hex_color.lstrip("#")
    return (
        int(value[0:2], 16) / 255.0,
        int(value[2:4], 16) / 255.0,
        int(value[4:6], 16) / 255.0,
        alpha,
    )


def create_material(
    name: str,
    base_color: str,
    emission_color: str,
    *,
    alpha: float,
    metallic: float,
    roughness: float,
) -> bpy.types.Material:
    material = bpy.data.materials.new(name=name)
    material.use_nodes = True
    material.diffuse_color = rgba(base_color, alpha)
    if alpha < 1.0:
        material.surface_render_method = "BLENDED"

    principled = material.node_tree.nodes.get("Principled BSDF")
    if principled is None:
        raise RuntimeError("Blender did not create a Principled BSDF node.")
    principled.inputs["Base Color"].default_value = rgba(base_color, alpha)
    principled.inputs["Emission Color"].default_value = rgba(emission_color, 1.0)
    principled.inputs["Emission Strength"].default_value = 1.0
    principled.inputs["Metallic"].default_value = metallic
    principled.inputs["Roughness"].default_value = roughness
    principled.inputs["Alpha"].default_value = alpha
    return material


def create_mesh_object(
    *,
    name: str,
    parent: bpy.types.Object,
    material: bpy.types.Material,
    vertices: list[tuple[float, float, float]],
    faces: list[tuple[int, ...]],
    smooth: bool = False,
) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(name=f"{name}_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update(calc_edges=True)
    for polygon in mesh.polygons:
        polygon.use_smooth = smooth
    while mesh.uv_layers:
        mesh.uv_layers.remove(mesh.uv_layers[0])

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.data.materials.append(material)
    return obj


def funnel_radius(depth: float) -> float:
    t = max(0.0, min(1.0, (depth - 3.0) / 154.0))
    return 7.5 + 66.5 * math.pow(1.0 - t, 0.86)


def warped_point(radius: float, depth: float, angle: float, phase: float) -> tuple[float, float, float]:
    radius_warp = 1.0 + math.sin(angle * 3.0 + phase) * 0.023
    radius_warp += math.sin(angle * 7.0 - phase * 0.7) * 0.009
    vertical_scale = 0.855 + math.sin(depth * 0.033 + phase) * 0.016
    depth_warp = math.sin(angle * 2.0 + phase) * 1.05
    centre_x = math.sin(depth * 0.031) * 1.45
    centre_y = math.sin(depth * 0.022 + 0.7) * 0.9
    return (
        centre_x + math.cos(angle) * radius * radius_warp,
        depth + depth_warp,
        centre_y + math.sin(angle) * radius * radius_warp * vertical_scale,
    )


def create_funnel_panel(
    *,
    name: str,
    parent: bpy.types.Object,
    material: bpy.types.Material,
    start_degrees: float,
    end_degrees: float,
    outer_depth: float,
    inner_depth: float,
    segments: int,
    phase: float,
) -> bpy.types.Object:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    outer_radius = funnel_radius(outer_depth)
    inner_radius = funnel_radius(inner_depth)

    for index in range(segments + 1):
        t = index / segments
        angle = math.radians(start_degrees + (end_degrees - start_degrees) * t)
        edge_fade = math.sin(t * math.pi)
        local_outer = outer_radius - (1.0 - edge_fade) * 0.55
        local_inner = inner_radius - (1.0 - edge_fade) * 0.34
        vertices.append(warped_point(local_outer, outer_depth, angle, phase))
        vertices.append(warped_point(local_inner, inner_depth, angle, phase + 0.37))

    for index in range(segments):
        current = index * 2
        following = current + 2
        faces.append((current, current + 1, following + 1, following))

    return create_mesh_object(
        name=name,
        parent=parent,
        material=material,
        vertices=vertices,
        faces=faces,
    )


def create_arc_prism(
    *,
    name: str,
    parent: bpy.types.Object,
    material: bpy.types.Material,
    start_degrees: float,
    end_degrees: float,
    radius: float,
    radial_width: float,
    front_depth: float,
    thickness: float,
    segments: int,
    phase: float,
) -> bpy.types.Object:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []

    for index in range(segments + 1):
        t = index / segments
        angle = math.radians(start_degrees + (end_degrees - start_degrees) * t)
        wobble = math.sin(angle * 4.0 + phase) * 0.8 + math.sin(angle * 9.0) * 0.24
        local_radius = radius + wobble
        local_width = radial_width * (0.78 + math.sin(t * math.pi) * 0.22)
        for radial, depth in (
            (local_radius - local_width * 0.5, front_depth),
            (local_radius + local_width * 0.5, front_depth),
            (local_radius - local_width * 0.5, front_depth + thickness),
            (local_radius + local_width * 0.5, front_depth + thickness),
        ):
            vertices.append(warped_point(radial, depth, angle, phase))

    for index in range(segments):
        current = index * 4
        following = current + 4
        faces.extend((
            (current, current + 1, following + 1, following),
            (current + 2, following + 2, following + 3, current + 3),
            (current, following, following + 2, current + 2),
            (current + 1, current + 3, following + 3, following + 1),
        ))
    faces.append((0, 2, 3, 1))
    final = segments * 4
    faces.append((final, final + 1, final + 3, final + 2))

    return create_mesh_object(
        name=name,
        parent=parent,
        material=material,
        vertices=vertices,
        faces=faces,
        smooth=True,
    )


def create_lip_shelf(
    *,
    name: str,
    parent: bpy.types.Object,
    material: bpy.types.Material,
    start_degrees: float,
    end_degrees: float,
    outer_radius: float,
    inner_radius: float,
    outer_depth: float,
    inner_depth: float,
    segments: int,
    phase: float,
) -> bpy.types.Object:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    for index in range(segments + 1):
        t = index / segments
        angle = math.radians(start_degrees + (end_degrees - start_degrees) * t)
        edge_fade = math.sin(t * math.pi)
        local_inner = inner_radius + (1.0 - edge_fade) * 0.8
        local_outer = outer_radius - (1.0 - edge_fade) * 0.35
        vertices.append(warped_point(local_inner, inner_depth, angle, phase + 0.4))
        vertices.append(warped_point(local_outer, outer_depth, angle, phase))
    for index in range(segments):
        current = index * 2
        following = current + 2
        faces.append((current, current + 1, following + 1, following))
    return create_mesh_object(
        name=name,
        parent=parent,
        material=material,
        vertices=vertices,
        faces=faces,
        smooth=True,
    )


def create_depth_arc(
    *,
    name: str,
    parent: bpy.types.Object,
    material: bpy.types.Material,
    depth: float,
    start_degrees: float,
    end_degrees: float,
    width: float,
    segments: int,
    phase: float,
) -> bpy.types.Object:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    radius = funnel_radius(depth)
    for index in range(segments + 1):
        t = index / segments
        angle = math.radians(start_degrees + (end_degrees - start_degrees) * t)
        local_width = width * (0.72 + math.sin(t * math.pi) * 0.28)
        vertices.append(warped_point(radius - local_width * 0.5, depth, angle, phase))
        vertices.append(warped_point(radius + local_width * 0.5, depth, angle, phase))
    for index in range(segments):
        current = index * 2
        following = current + 2
        faces.append((current, current + 1, following + 1, following))
    return create_mesh_object(
        name=name,
        parent=parent,
        material=material,
        vertices=vertices,
        faces=faces,
        smooth=True,
    )


def create_spiral_ribbon(
    *,
    name: str,
    parent: bpy.types.Object,
    material: bpy.types.Material,
    phase: float,
    turns: float,
    start_t: float,
    end_t: float,
    width: float,
    points: int,
) -> bpy.types.Object:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []

    for index in range(points):
        local_t = index / (points - 1)
        t = start_t + (end_t - start_t) * local_t
        eased = 1.0 - math.pow(1.0 - t, 1.08)
        depth = 7.0 + 150.0 * eased
        radius = funnel_radius(depth) + math.sin(t * math.pi * 5.0 + phase) * 0.65
        angle = phase + t * math.pi * 2.0 * turns + math.sin(t * math.pi * 2.0) * 0.08
        half_angle = width / max(12.0, radius) * 0.5
        vertices.append(warped_point(radius, depth - 0.18, angle - half_angle, phase))
        vertices.append(warped_point(radius, depth + 0.18, angle + half_angle, phase))

    for index in range(points - 1):
        current = index * 2
        following = current + 2
        faces.append((current, current + 1, following + 1, following))
    return create_mesh_object(
        name=name,
        parent=parent,
        material=material,
        vertices=vertices,
        faces=faces,
        smooth=True,
    )


def create_shard(
    *,
    name: str,
    parent: bpy.types.Object,
    material: bpy.types.Material,
    depth: float,
    angle_degrees: float,
    size: float,
    phase: float,
) -> bpy.types.Object:
    radius = funnel_radius(depth) + 0.55
    angle = math.radians(angle_degrees)
    tangent = Vector((-math.sin(angle), 0.0, math.cos(angle)))
    center = Vector(warped_point(radius, depth, angle, phase))
    inward = Vector(warped_point(funnel_radius(depth + size * 2.4), depth + size * 2.4, angle, phase)) - center
    if inward.length > 0.001:
        inward.normalize()
    vertices = [
        tuple(center - tangent * size * 0.65),
        tuple(center + tangent * size * 0.58),
        tuple(center + inward * size * 1.4 + tangent * size * 0.08),
    ]
    return create_mesh_object(
        name=name,
        parent=parent,
        material=material,
        vertices=vertices,
        faces=[(0, 1, 2)],
    )


def join_objects(name: str, objects: list[bpy.types.Object], parent: bpy.types.Object) -> bpy.types.Object:
    if not objects:
        raise RuntimeError(f"Cannot join empty object group {name}.")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = name
    joined.data.name = f"{name}_mesh"
    joined.parent = parent
    joined.select_set(False)
    return joined


def point_camera(camera: bpy.types.Object, target: tuple[float, float, float]) -> None:
    direction = Vector(target) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def configure_preview(root: bpy.types.Object) -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = 64
    scene.render.resolution_x = 960
    scene.render.resolution_y = 540
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.7
    scene.view_settings.gamma = 1.0

    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = rgba("#01040b", 1.0)
    background.inputs["Strength"].default_value = 0.012

    camera_data = bpy.data.cameras.new("review_camera")
    camera_data.lens = 47
    camera = bpy.data.objects.new("review_camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (0.0, -242.0, 106.0)
    point_camera(camera, (0.0, 45.0, -1.5))
    scene.camera = camera

    near_data = bpy.data.lights.new(name="near_lip_key", type="AREA")
    near_data.color = rgba("#65dcff")[:3]
    near_data.energy = 620.0
    near_data.shape = "DISK"
    near_data.size = 74.0
    near = bpy.data.objects.new(name="near_lip_key", object_data=near_data)
    bpy.context.collection.objects.link(near)
    near.location = (0.0, -34.0, -64.0)
    point_camera(near, (0.0, 18.0, -18.0))

    shaft_data = bpy.data.lights.new(name="shaft_fill", type="POINT")
    shaft_data.color = rgba("#6f57ff")[:3]
    shaft_data.energy = 430.0
    shaft_data.shadow_soft_size = 26.0
    shaft = bpy.data.objects.new(name="shaft_fill", object_data=shaft_data)
    bpy.context.collection.objects.link(shaft)
    shaft.location = (0.0, 88.0, 3.0)

    root["preview_camera_pitch_degrees"] = 28.0


def mesh_metrics(objects: list[bpy.types.Object]) -> tuple[int, int]:
    vertices = 0
    triangles = 0
    for obj in objects:
        vertices += len(obj.data.vertices)
        triangles += sum(max(0, len(polygon.vertices) - 2) for polygon in obj.data.polygons)
    return vertices, triangles


def inspect_exported_glb(path: Path) -> tuple[int, int]:
    payload = path.read_bytes()
    magic, version, declared_length = struct.unpack_from("<III", payload, 0)
    if magic != 0x46546C67 or version != 2 or declared_length != len(payload):
        raise RuntimeError("Exported GLB header is invalid.")
    offset = 12
    document = None
    while offset < len(payload):
        chunk_length, chunk_type = struct.unpack_from("<II", payload, offset)
        chunk_start = offset + 8
        chunk_end = chunk_start + chunk_length
        if chunk_end > len(payload):
            raise RuntimeError("Exported GLB chunk exceeds its declared length.")
        if chunk_type == 0x4E4F534A:
            document = json.loads(payload[chunk_start:chunk_end].decode("utf-8").rstrip(" \0"))
        offset = chunk_end
    if document is None:
        raise RuntimeError("Exported GLB is missing its JSON chunk.")

    accessors = document.get("accessors", [])
    vertices = 0
    triangles = 0
    for mesh in document.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            if primitive.get("mode", 4) != 4:
                raise RuntimeError("Exported GLB contains a non-triangle primitive.")
            position_count = accessors[primitive["attributes"]["POSITION"]]["count"]
            element_count = accessors[primitive["indices"]]["count"] if "indices" in primitive else position_count
            if element_count % 3 != 0:
                raise RuntimeError("Exported GLB triangle element count is invalid.")
            vertices += position_count
            triangles += element_count // 3
    return vertices, triangles


def relative(path: Path) -> str:
    return path.relative_to(REPO_ROOT).as_posix()


def main() -> None:
    assert_blender_version()
    clear_scene()
    bpy.context.preferences.filepaths.save_version = 0
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    REVIEW_PREVIEW_PATH.parent.mkdir(parents=True, exist_ok=True)

    root = bpy.data.objects.new(ASSET_ID, None)
    bpy.context.collection.objects.link(root)
    root["asset_id"] = ASSET_ID
    root["schema_version"] = "gw.blender-stage-source.v1"
    root["units"] = "game_units"
    root["game_plane"] = "XY"
    root["game_depth_axis"] = "negative_Z"
    root["triangle_budget"] = TRIANGLE_BUDGET
    root["design_intent"] = "foreshortened broken funnel; asymmetric near shelf; open off-centre throat"

    shell_material = create_material(
        "funnel_shadow",
        "#010611",
        "#071c31",
        alpha=0.24,
        metallic=0.05,
        roughness=0.64,
    )
    lip_material = create_material(
        "arena_lip_ice",
        "#071624",
        "#3997b4",
        alpha=0.56,
        metallic=0.16,
        roughness=0.36,
    )
    shelf_material = create_material(
        "arena_lip_shelf",
        "#020b15",
        "#0c344c",
        alpha=0.46,
        metallic=0.04,
        roughness=0.7,
    )
    cyan_material = create_material(
        "spiral_cyan",
        "#061b2b",
        "#278caf",
        alpha=0.52,
        metallic=0.05,
        roughness=0.42,
    )
    violet_material = create_material(
        "spiral_violet",
        "#120b2c",
        "#5f51bd",
        alpha=0.48,
        metallic=0.05,
        roughness=0.44,
    )
    shard_material = create_material(
        "funnel_shards",
        "#07192a",
        "#83dcf2",
        alpha=0.78,
        metallic=0.04,
        roughness=0.5,
    )

    shell_parts: list[bpy.types.Object] = []
    shell_bands = (
        (5.0, 27.0),
        (31.0, 54.0),
        (59.0, 83.0),
        (89.0, 116.0),
        (123.0, 153.0),
    )
    patch_starts = (13.0, 128.0, 251.0)
    patch_spans = (38.0, 44.0, 34.0)
    for band_index, (outer_depth, inner_depth) in enumerate(shell_bands):
        rotation = band_index * 23.0
        for patch_index, (start, span) in enumerate(zip(patch_starts, patch_spans)):
            shell_parts.append(
                create_funnel_panel(
                    name=f"shell_{band_index + 1:02d}_{patch_index + 1:02d}",
                    parent=root,
                    material=shell_material,
                    start_degrees=start + rotation,
                    end_degrees=start + rotation + span,
                    outer_depth=outer_depth,
                    inner_depth=inner_depth,
                    segments=8,
                    phase=band_index * 0.7 + patch_index * 1.3,
                )
            )

    shelf_parts: list[bpy.types.Object] = []
    shelf_specs = (
        (193.0, 230.0, 75.0, 62.0, -0.15, 7.2, 0.2),
        (239.0, 286.0, 76.0, 60.5, -0.25, 8.4, 0.7),
        (297.0, 337.0, 75.2, 62.5, -0.1, 6.8, 1.2),
        (347.0, 359.0, 74.0, 65.0, 0.05, 4.8, 1.6),
    )
    for index, (start, end, outer, inner, outer_depth, inner_depth, phase) in enumerate(shelf_specs):
        shelf_parts.append(
            create_lip_shelf(
                name=f"lip_shelf_{index + 1:02d}",
                parent=root,
                material=shelf_material,
                start_degrees=start,
                end_degrees=end,
                outer_radius=outer,
                inner_radius=inner,
                outer_depth=outer_depth,
                inner_depth=inner_depth,
                segments=max(6, round((end - start) / 3.0)),
                phase=phase,
            )
        )

    lip_parts: list[bpy.types.Object] = []
    lip_specs = (
        (193.0, 230.0, 75.0, 1.45, 0.2, 1.0),
        (239.0, 286.0, 76.0, 1.75, 0.7, 1.25),
        (297.0, 337.0, 75.2, 1.35, 1.2, 0.95),
        (347.0, 359.0, 74.0, 1.0, 1.6, 0.7),
    )
    for index, (start, end, radius, width, phase, thickness) in enumerate(lip_specs):
        lip_parts.append(
            create_arc_prism(
                name=f"lip_fragment_{index + 1:02d}",
                parent=root,
                material=lip_material,
                start_degrees=start,
                end_degrees=end,
                radius=radius,
                radial_width=width,
                front_depth=0.8 + index * 0.18,
                thickness=thickness,
                segments=max(5, round((end - start) / 3.0)),
                phase=phase,
            )
        )

    rail_parts: list[bpy.types.Object] = []
    rail_windows = ((0.04, 0.26), (0.38, 0.61), (0.74, 0.94))
    for rail_index in range(2):
        material = cyan_material if rail_index == 0 else violet_material
        for window_index, (start_t, end_t) in enumerate(rail_windows):
            rail_parts.append(
                create_spiral_ribbon(
                    name=f"spiral_{rail_index + 1:02d}_{window_index + 1:02d}",
                    parent=root,
                    material=material,
                    phase=rail_index * math.pi * 0.67 + 0.18,
                    turns=0.72 + rail_index * 0.075,
                    start_t=start_t,
                    end_t=end_t,
                    width=0.72 - rail_index * 0.1,
                    points=18,
                )
            )

    depth_parts: list[bpy.types.Object] = []
    depth_specs = (
        (17.0, 24.0, 66.0, 1.0),
        (31.0, 146.0, 194.0, 1.6),
        (49.0, 262.0, 308.0, 2.2),
        (71.0, 61.0, 101.0, 2.8),
        (96.0, 181.0, 220.0, 3.4),
        (124.0, 301.0, 334.0, 4.0),
        (148.0, 108.0, 138.0, 4.6),
    )
    for index, (depth, start, end, phase) in enumerate(depth_specs):
        depth_parts.append(
            create_depth_arc(
                name=f"depth_break_{index + 1:02d}",
                parent=root,
                material=cyan_material if index % 2 == 0 else violet_material,
                depth=depth,
                start_degrees=start,
                end_degrees=end,
                width=max(0.42, 0.78 - index * 0.045),
                segments=max(5, round((end - start) / 4.0)),
                phase=phase,
            )
        )

    shard_parts: list[bpy.types.Object] = []
    for index in range(18):
        depth = 14.0 + float((index * 37) % 132)
        angle = 19.0 + float((index * 137) % 360)
        shard_parts.append(
            create_shard(
                name=f"wall_shard_{index + 1:02d}",
                parent=root,
                material=shard_material,
                depth=depth,
                angle_degrees=angle,
                size=0.42 + (index % 5) * 0.12,
                phase=index * 0.31,
            )
        )

    export_objects = [
        join_objects("funnel_shell", shell_parts, root),
        join_objects("near_lip_shelf", shelf_parts, root),
        join_objects("broken_arena_lip", lip_parts, root),
        join_objects("tapered_spiral_seams", rail_parts, root),
        join_objects("broken_depth_marks", depth_parts, root),
        join_objects("wall_shards", shard_parts, root),
    ]

    source_vertices, source_triangles = mesh_metrics(export_objects)
    if source_vertices > VERTEX_BUDGET or source_triangles > TRIANGLE_BUDGET:
        raise RuntimeError(
            f"Generated source mesh exceeds budget: {source_vertices}/{VERTEX_BUDGET} vertices, "
            f"{source_triangles}/{TRIANGLE_BUDGET} triangles."
        )

    configure_preview(root)
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE_BLEND_PATH), check_existing=False)

    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for obj in export_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(RUNTIME_GLB_PATH),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_texcoords=False,
        export_normals=True,
        export_tangents=False,
    )

    glb_bytes = RUNTIME_GLB_PATH.stat().st_size
    runtime_vertices, runtime_triangles = inspect_exported_glb(RUNTIME_GLB_PATH)
    if runtime_vertices > VERTEX_BUDGET or runtime_triangles > TRIANGLE_BUDGET:
        raise RuntimeError(
            f"Exported runtime mesh exceeds budget: {runtime_vertices}/{VERTEX_BUDGET} vertices, "
            f"{runtime_triangles}/{TRIANGLE_BUDGET} triangles."
        )
    if glb_bytes > GLB_BYTE_BUDGET:
        raise RuntimeError(f"Generated GLB is {glb_bytes} bytes; budget is {GLB_BYTE_BUDGET} bytes.")

    bpy.context.scene.render.filepath = str(REVIEW_PREVIEW_PATH)
    bpy.ops.render.render(write_still=True)

    metrics = {
        "schemaVersion": "gw.blender-stage-source-metrics.v1",
        "assetId": ASSET_ID,
        "blenderVersion": bpy.app.version_string,
        "sourceScript": relative(SCRIPT_PATH),
        "sourceBlend": relative(SOURCE_BLEND_PATH),
        "runtimeGlb": relative(RUNTIME_GLB_PATH),
        "reviewPreview": relative(REVIEW_PREVIEW_PATH),
        "coordinateContract": {
            "blenderPlane": "XZ",
            "blenderDepth": "+Y",
            "runtimePlane": "XY",
            "runtimeDepth": "-Z",
            "arenaRadius": 72,
        },
        "metrics": {
            "objects": len(export_objects),
            "materials": len({
                slot.material.name
                for obj in export_objects
                for slot in obj.material_slots
                if slot.material is not None
            }),
            "sourceVertices": source_vertices,
            "sourceTriangles": source_triangles,
            "vertices": runtime_vertices,
            "triangles": runtime_triangles,
            "glbBytes": glb_bytes,
            "glbSha256": hashlib.sha256(RUNTIME_GLB_PATH.read_bytes()).hexdigest(),
        },
        "budgets": {
            "vertices": VERTEX_BUDGET,
            "triangles": TRIANGLE_BUDGET,
            "glbBytes": GLB_BYTE_BUDGET,
        },
    }
    REVIEW_METRICS_PATH.write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()

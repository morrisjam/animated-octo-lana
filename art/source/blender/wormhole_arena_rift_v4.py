"""Build the Blender 5.2 authored Gravity Well rift candidate.

Run with Blender 5.2.0 LTS:
  blender --background --python art/source/blender/wormhole_arena_rift_v4.py
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector


ASSET_ID = "wormhole_arena_rift_v4"
EXPECTED_BLENDER_VERSION = (5, 2, 0)
TRIANGLE_BUDGET = 12_000
VERTEX_BUDGET = 14_000
GLB_BYTE_BUDGET = 384 * 1024

SCRIPT_PATH = Path(__file__).resolve()
REPO_ROOT = SCRIPT_PATH.parents[3]
SOURCE_BLEND_PATH = SCRIPT_PATH.with_suffix(".blend")
RUNTIME_DIR = REPO_ROOT / "apps" / "game-web" / "public" / "assets" / "stages" / "wormhole"
RUNTIME_GLB_PATH = RUNTIME_DIR / "wormhole-arena-rift-v4.glb"
REVIEW_PREVIEW_PATH = REPO_ROOT / "art" / "review" / "wormhole_arena_rift_v4.png"
REVIEW_METRICS_PATH = REPO_ROOT / "art" / "review" / "wormhole_arena_rift_v4.metrics.json"


def load_shared_helpers():
    helper_path = SCRIPT_PATH.with_name("wormhole_arena_funnel_v3.py")
    spec = importlib.util.spec_from_file_location("gravity_well_wormhole_funnel_v3", helper_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load shared stage helpers from {helper_path}.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


shared = load_shared_helpers()


def assert_blender_version() -> None:
    if tuple(bpy.app.version) != EXPECTED_BLENDER_VERSION:
        expected = ".".join(str(part) for part in EXPECTED_BLENDER_VERSION)
        raise RuntimeError(
            f"This source is pinned to Blender {expected} but is running under {bpy.app.version_string}."
        )


def rift_radius(depth: float) -> float:
    t = max(0.0, min(1.0, (depth - 2.0) / 156.0))
    return 6.4 + 68.2 * math.pow(1.0 - t, 0.84)


def rift_point(radius: float, depth: float, angle: float, phase: float) -> tuple[float, float, float]:
    radius_warp = 1.0 + math.sin(angle * 3.0 + phase) * 0.018
    radius_warp += math.sin(depth * 0.046 + angle * 5.0) * 0.008
    vertical_scale = 0.82 + math.sin(depth * 0.025 + phase) * 0.014
    centre_x = math.sin(depth * 0.029 + 0.35) * 1.7
    centre_z = math.sin(depth * 0.021 + 0.9) * 1.05
    return (
        centre_x + math.cos(angle) * radius * radius_warp,
        depth + math.sin(angle * 2.0 + phase) * 0.72,
        centre_z + math.sin(angle) * radius * radius_warp * vertical_scale,
    )


def create_longitudinal_ribbon(
    *,
    name: str,
    parent: bpy.types.Object,
    material: bpy.types.Material,
    base_angle_degrees: float,
    twist_degrees: float,
    start_t: float,
    end_t: float,
    near_width: float,
    far_width: float,
    radius_offset: float,
    phase: float,
    points: int,
) -> bpy.types.Object:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []

    for index in range(points):
        local_t = index / (points - 1)
        t = start_t + (end_t - start_t) * local_t
        eased = 1.0 - math.pow(1.0 - t, 1.07)
        depth = 2.5 + 155.0 * eased
        radius = rift_radius(depth) + radius_offset
        centre_angle = math.radians(base_angle_degrees + twist_degrees * t)
        centre_angle += math.sin(t * math.pi * 2.0 + phase) * 0.035
        taper = 0.22 + math.pow(math.sin(local_t * math.pi), 0.55) * 0.78
        width = (near_width + (far_width - near_width) * t) * taper
        half_angle = width / max(10.0, radius) * 0.5
        vertices.append(rift_point(radius, depth, centre_angle - half_angle, phase))
        vertices.append(rift_point(radius, depth, centre_angle + half_angle, phase + 0.19))

    for index in range(points - 1):
        current = index * 2
        following = current + 2
        faces.append((current, current + 1, following + 1, following))

    return shared.create_mesh_object(
        name=name,
        parent=parent,
        material=material,
        vertices=vertices,
        faces=faces,
        smooth=True,
    )


def create_shelf_sector(
    *,
    name: str,
    parent: bpy.types.Object,
    material: bpy.types.Material,
    start_degrees: float,
    end_degrees: float,
    outer_radius: float,
    inner_radius: float,
    inner_depth: float,
    phase: float,
    segments: int,
) -> bpy.types.Object:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []

    for index in range(segments + 1):
        t = index / segments
        angle = math.radians(start_degrees + (end_degrees - start_degrees) * t)
        end_taper = 0.35 + math.sin(t * math.pi) * 0.65
        local_inner = inner_radius + (1.0 - end_taper) * 2.4
        local_outer = outer_radius - (1.0 - end_taper) * 0.8
        vertices.append(rift_point(local_inner, inner_depth, angle, phase + 0.31))
        vertices.append(rift_point(local_outer, -0.7, angle, phase))

    for index in range(segments):
        current = index * 2
        following = current + 2
        faces.append((current, current + 1, following + 1, following))

    return shared.create_mesh_object(
        name=name,
        parent=parent,
        material=material,
        vertices=vertices,
        faces=faces,
        smooth=True,
    )


def create_arc_strip(
    *,
    name: str,
    parent: bpy.types.Object,
    material: bpy.types.Material,
    start_degrees: float,
    end_degrees: float,
    radius: float,
    width: float,
    depth: float,
    phase: float,
    segments: int,
) -> bpy.types.Object:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []

    for index in range(segments + 1):
        t = index / segments
        angle = math.radians(start_degrees + (end_degrees - start_degrees) * t)
        taper = 0.2 + math.pow(math.sin(t * math.pi), 0.5) * 0.8
        local_width = width * taper
        vertices.append(rift_point(radius - local_width * 0.5, depth, angle, phase))
        vertices.append(rift_point(radius + local_width * 0.5, depth, angle, phase + 0.12))

    for index in range(segments):
        current = index * 2
        following = current + 2
        faces.append((current, current + 1, following + 1, following))

    return shared.create_mesh_object(
        name=name,
        parent=parent,
        material=material,
        vertices=vertices,
        faces=faces,
        smooth=True,
    )


def create_flow_shard(
    *,
    name: str,
    parent: bpy.types.Object,
    material: bpy.types.Material,
    depth: float,
    angle_degrees: float,
    length: float,
    width: float,
    phase: float,
) -> bpy.types.Object:
    radius = rift_radius(depth) + 0.5
    angle = math.radians(angle_degrees)
    centre = Vector(rift_point(radius, depth, angle, phase))
    tangent = Vector((-math.sin(angle), 0.0, math.cos(angle)))
    inward_point = Vector(rift_point(rift_radius(depth + length), depth + length, angle, phase + 0.2))
    inward = inward_point - centre
    if inward.length > 0.001:
        inward.normalize()
    vertices = [
        tuple(centre - tangent * width * 0.5),
        tuple(centre + tangent * width * 0.5),
        tuple(centre + inward * length + tangent * width * 0.16),
    ]
    return shared.create_mesh_object(
        name=name,
        parent=parent,
        material=material,
        vertices=vertices,
        faces=[(0, 1, 2)],
    )


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
    scene.view_settings.exposure = 0.85
    scene.view_settings.gamma = 1.0

    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = shared.rgba("#01040a", 1.0)
    background.inputs["Strength"].default_value = 0.01

    camera_data = bpy.data.cameras.new("review_camera")
    camera_data.lens = 49
    camera = bpy.data.objects.new("review_camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (0.0, -244.0, 122.0)
    shared.point_camera(camera, (0.0, 43.0, -2.5))
    scene.camera = camera

    near_data = bpy.data.lights.new(name="combat_shelf_key", type="AREA")
    near_data.color = shared.rgba("#7ee9ff")[:3]
    near_data.energy = 760.0
    near_data.shape = "DISK"
    near_data.size = 68.0
    near = bpy.data.objects.new(name="combat_shelf_key", object_data=near_data)
    bpy.context.collection.objects.link(near)
    near.location = (0.0, -30.0, -58.0)
    shared.point_camera(near, (0.0, 20.0, -16.0))

    shaft_data = bpy.data.lights.new(name="rift_fill", type="POINT")
    shaft_data.color = shared.rgba("#6658ff")[:3]
    shaft_data.energy = 520.0
    shaft_data.shadow_soft_size = 28.0
    shaft = bpy.data.objects.new(name="rift_fill", object_data=shaft_data)
    bpy.context.collection.objects.link(shaft)
    shaft.location = (2.0, 102.0, -2.0)

    for index, (x, z, color) in enumerate(((-13.0, 5.0, "#54dbff"), (11.0, 1.0, "#ff5fbd"))):
        marker_material = shared.create_material(
            f"review_fighter_{index + 1:02d}",
            color,
            color,
            alpha=0.92,
            metallic=0.08,
            roughness=0.32,
        )
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=2.4, location=(x, -2.2, z))
        marker = bpy.context.object
        marker.name = f"review_fighter_{index + 1:02d}"
        marker.scale.z = 1.7
        marker.data.materials.append(marker_material)

    root["preview_camera_pitch_degrees"] = 24.0


def relative(path: Path) -> str:
    return path.relative_to(REPO_ROOT).as_posix()


def main() -> None:
    assert_blender_version()
    shared.clear_scene()
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
    root["design_intent"] = "asymmetric combat shelf; converging longitudinal ribs; open drifting throat"

    wall_material = shared.create_material(
        "rift_wall_shadow",
        "#020812",
        "#0a2940",
        alpha=0.25,
        metallic=0.04,
        roughness=0.7,
    )
    shelf_material = shared.create_material(
        "combat_shelf",
        "#020b13",
        "#12405b",
        alpha=0.54,
        metallic=0.08,
        roughness=0.62,
    )
    cyan_material = shared.create_material(
        "rift_edge_cyan",
        "#062235",
        "#43c4e5",
        alpha=0.68,
        metallic=0.06,
        roughness=0.38,
    )
    violet_material = shared.create_material(
        "rift_edge_violet",
        "#140d31",
        "#7565db",
        alpha=0.56,
        metallic=0.05,
        roughness=0.42,
    )
    shard_material = shared.create_material(
        "flow_sparks",
        "#0b2432",
        "#9beaff",
        alpha=0.78,
        metallic=0.02,
        roughness=0.46,
    )

    ribbon_windows = ((0.015, 0.27), (0.34, 0.59), (0.66, 0.84), (0.89, 0.99))
    rib_specs = (
        (214.0, 112.0, 0.1),
        (304.0, -94.0, 0.9),
        (38.0, 126.0, 1.7),
        (132.0, -108.0, 2.6),
    )
    wall_parts: list[bpy.types.Object] = []
    edge_parts: list[bpy.types.Object] = []
    for rib_index, (angle, twist, phase) in enumerate(rib_specs):
        for window_index, (start_t, end_t) in enumerate(ribbon_windows):
            wall_parts.append(
                create_longitudinal_ribbon(
                    name=f"wall_rib_{rib_index + 1:02d}_{window_index + 1:02d}",
                    parent=root,
                    material=wall_material,
                    base_angle_degrees=angle,
                    twist_degrees=twist,
                    start_t=start_t,
                    end_t=end_t,
                    near_width=15.5 - rib_index * 0.8,
                    far_width=2.5,
                    radius_offset=-0.2,
                    phase=phase,
                    points=16,
                )
            )
            edge_parts.append(
                create_longitudinal_ribbon(
                    name=f"flow_edge_{rib_index + 1:02d}_{window_index + 1:02d}",
                    parent=root,
                    material=cyan_material if rib_index % 2 == 0 else violet_material,
                    base_angle_degrees=angle + (4.6 if twist >= 0 else -4.6),
                    twist_degrees=twist,
                    start_t=start_t,
                    end_t=end_t,
                    near_width=0.8,
                    far_width=0.22,
                    radius_offset=0.24,
                    phase=phase + 0.23,
                    points=16,
                )
            )

    shelf_parts: list[bpy.types.Object] = []
    shelf_edge_parts: list[bpy.types.Object] = []
    shelf_specs = (
        (198.0, 236.0, 76.0, 58.0, 8.4, 0.25),
        (245.0, 287.0, 77.0, 56.5, 10.2, 0.8),
        (297.0, 339.0, 75.5, 59.0, 7.6, 1.35),
    )
    for index, (start, end, outer, inner, depth, phase) in enumerate(shelf_specs):
        segments = max(8, round((end - start) / 2.8))
        shelf_parts.append(
            create_shelf_sector(
                name=f"combat_shelf_{index + 1:02d}",
                parent=root,
                material=shelf_material,
                start_degrees=start,
                end_degrees=end,
                outer_radius=outer,
                inner_radius=inner,
                inner_depth=depth,
                phase=phase,
                segments=segments,
            )
        )
        shelf_edge_parts.append(
            create_arc_strip(
                name=f"shelf_edge_{index + 1:02d}",
                parent=root,
                material=cyan_material if index != 1 else violet_material,
                start_degrees=start,
                end_degrees=end,
                radius=outer,
                width=1.0,
                depth=-0.95,
                phase=phase,
                segments=segments,
            )
        )

    shard_parts: list[bpy.types.Object] = []
    for index in range(24):
        depth = 10.0 + float((index * 43) % 142)
        angle = 11.0 + float((index * 151) % 360)
        shard_parts.append(
            create_flow_shard(
                name=f"flow_shard_{index + 1:02d}",
                parent=root,
                material=shard_material if index % 3 else violet_material,
                depth=depth,
                angle_degrees=angle,
                length=1.1 + (index % 5) * 0.38,
                width=0.28 + (index % 4) * 0.11,
                phase=index * 0.37,
            )
        )

    export_objects = [
        shared.join_objects("converging_wall_ribs", wall_parts, root),
        shared.join_objects("broken_rib_edges", edge_parts, root),
        shared.join_objects("asymmetric_combat_shelf", shelf_parts, root),
        shared.join_objects("broken_shelf_edge", shelf_edge_parts, root),
        shared.join_objects("longitudinal_flow_shards", shard_parts, root),
    ]

    source_vertices, source_triangles = shared.mesh_metrics(export_objects)
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
    runtime_vertices, runtime_triangles = shared.inspect_exported_glb(RUNTIME_GLB_PATH)
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

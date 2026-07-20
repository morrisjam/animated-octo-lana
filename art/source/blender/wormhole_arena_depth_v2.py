"""Build and export the authored Gravity Well arena depth candidate.

Run with Blender 2.92.0:
  blender --background --python art/source/blender/wormhole_arena_depth_v2.py
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import math
import sys
from pathlib import Path

import bpy


ASSET_ID = "wormhole_arena_depth_v2"
EXPECTED_BLENDER_VERSION = (2, 92, 0)
TRIANGLE_BUDGET = 10_000
VERTEX_BUDGET = 12_000
GLB_BYTE_BUDGET = 320 * 1024

SCRIPT_PATH = Path(__file__).resolve()
REPO_ROOT = SCRIPT_PATH.parents[3]
SOURCE_BLEND_PATH = SCRIPT_PATH.with_suffix(".blend")
RUNTIME_DIR = REPO_ROOT / "apps" / "game-web" / "public" / "assets" / "stages" / "wormhole"
RUNTIME_GLB_PATH = RUNTIME_DIR / "wormhole-arena-depth-v2.glb"
REVIEW_PREVIEW_PATH = REPO_ROOT / "art" / "review" / "wormhole_arena_depth_v2.png"
REVIEW_METRICS_PATH = REPO_ROOT / "art" / "review" / "wormhole_arena_depth_v2.metrics.json"


def load_base_module():
    sys.dont_write_bytecode = True
    source_path = SCRIPT_PATH.with_name("wormhole_arena_lip_v1.py")
    spec = importlib.util.spec_from_file_location("gravity_well_wormhole_v1", source_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load the pinned V1 Blender helpers.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.ASSET_ID = ASSET_ID
    module.SCRIPT_PATH = SCRIPT_PATH
    module.SOURCE_BLEND_PATH = SOURCE_BLEND_PATH
    module.RUNTIME_GLB_PATH = RUNTIME_GLB_PATH
    module.REVIEW_PREVIEW_PATH = REVIEW_PREVIEW_PATH
    module.REVIEW_METRICS_PATH = REVIEW_METRICS_PATH
    return module


BASE = load_base_module()


def create_twist_rail(
    *,
    name: str,
    parent: bpy.types.Object,
    material: bpy.types.Material,
    phase: float,
    turns: float,
    outer_radius: float,
    inner_radius: float,
    start_depth: float,
    end_depth: float,
    thickness: float,
    points: int,
) -> bpy.types.Object:
    curve_data = bpy.data.curves.new(name=f"{name}_curve", type="CURVE")
    curve_data.dimensions = "3D"
    curve_data.resolution_u = 1
    curve_data.bevel_depth = thickness
    curve_data.bevel_resolution = 1
    curve_data.resolution_v = 1
    curve_data.use_fill_caps = True

    spline = curve_data.splines.new("POLY")
    spline.points.add(points - 1)
    for index, point in enumerate(spline.points):
        t = index / (points - 1)
        eased = 1.0 - math.pow(1.0 - t, 1.18)
        radius = outer_radius + (inner_radius - outer_radius) * eased
        angle = phase + t * math.pi * 2.0 * turns + math.sin(t * math.pi * 2.0 + phase) * 0.08
        depth = start_depth + (end_depth - start_depth) * t
        radial_wobble = 1.0 + math.sin(t * math.pi * 5.0 + phase * 1.7) * 0.035
        point.co = (
            math.cos(angle) * radius * radial_wobble,
            depth,
            math.sin(angle) * radius * (0.93 + math.sin(t * math.pi * 3.0) * 0.03) * radial_wobble,
            1.0,
        )

    obj = bpy.data.objects.new(name, curve_data)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.data.materials.append(material)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.view_layer.objects.active
    while obj.data.uv_layers:
        obj.data.uv_layers.remove(obj.data.uv_layers[0])
    bpy.ops.object.shade_smooth()
    obj.select_set(False)
    return obj


def configure_preview(root: bpy.types.Object) -> None:
    BASE.configure_preview(root)
    scene = bpy.context.scene
    camera = scene.camera
    camera.data.lens = 47
    camera.location = (0.0, -238.0, 102.0)
    BASE.point_camera(camera, (0.0, 46.0, 0.0))

    depth_light_data = bpy.data.lights.new(name="shaft_depth_fill", type="POINT")
    depth_light_data.color = BASE.rgba("#735cff")[:3]
    depth_light_data.energy = 260.0
    depth_light_data.shadow_soft_size = 28.0
    depth_light = bpy.data.objects.new(name="shaft_depth_fill", object_data=depth_light_data)
    bpy.context.collection.objects.link(depth_light)
    depth_light.location = (0.0, 62.0, 2.0)
    root["preview_camera_pitch_degrees"] = 28.0


def main() -> None:
    if tuple(bpy.app.version) != EXPECTED_BLENDER_VERSION:
        expected = ".".join(str(part) for part in EXPECTED_BLENDER_VERSION)
        raise RuntimeError(
            "This source is pinned to Blender {} but is running under {}.".format(
                expected,
                bpy.app.version_string,
            )
        )

    BASE.clear_scene()
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

    near_lip = BASE.create_emissive_material(
        "lip_near_ice",
        "#0a3150",
        "#46c9ec",
        metallic=0.2,
        roughness=0.28,
    )
    shaft_cyan = BASE.create_emissive_material(
        "shaft_rail_cyan",
        "#071d32",
        "#258fb9",
        alpha=0.72,
        metallic=0.08,
        roughness=0.4,
    )
    shaft_violet = BASE.create_emissive_material(
        "shaft_rail_violet",
        "#140d35",
        "#6550c8",
        alpha=0.66,
        metallic=0.08,
        roughness=0.42,
    )
    depth_band = BASE.create_emissive_material(
        "depth_band",
        "#06152d",
        "#2f72a5",
        alpha=0.52,
        metallic=0.04,
        roughness=0.48,
    )

    export_objects = [
        BASE.create_arc_ribbon(
            name="near_lip_primary",
            parent=root,
            material=near_lip,
            start_degrees=198.0,
            end_degrees=286.0,
            segments=38,
            radius=74.2,
            width=3.5,
            front_depth=0.8,
            thickness=1.7,
            phase=0.55,
            radius_wobble=2.8,
        ),
        BASE.create_arc_ribbon(
            name="near_lip_secondary",
            parent=root,
            material=near_lip,
            start_degrees=306.0,
            end_degrees=342.0,
            segments=16,
            radius=76.0,
            width=2.75,
            front_depth=1.45,
            thickness=1.25,
            phase=1.4,
            radius_wobble=3.1,
        ),
    ]

    for index in range(4):
        export_objects.append(
            create_twist_rail(
                name=f"shaft_twist_{index + 1:02d}",
                parent=root,
                material=shaft_cyan if index % 2 == 0 else shaft_violet,
                phase=index * math.pi * 0.5 + (0.18 if index % 2 else 0.0),
                turns=1.36 + index * 0.07,
                outer_radius=68.0 - index * 1.4,
                inner_radius=14.0 + index * 1.8,
                start_depth=5.0 + index * 2.0,
                end_depth=150.0 - index * 4.0,
                thickness=0.52 - index * 0.035,
                points=54,
            )
        )

    band_specs = (
        (18.0, 63.0, 18.0, 94.0, 1.45, 0.2),
        (38.0, 55.0, 126.0, 204.0, 1.3, 0.9),
        (61.0, 46.5, 238.0, 318.0, 1.15, 1.6),
        (87.0, 37.5, 44.0, 126.0, 1.0, 2.3),
        (116.0, 28.5, 162.0, 247.0, 0.86, 3.0),
    )
    for index, (depth, radius, start, end, width, phase) in enumerate(band_specs):
        export_objects.append(
            BASE.create_arc_ribbon(
                name=f"depth_band_{index + 1:02d}",
                parent=root,
                material=depth_band,
                start_degrees=start,
                end_degrees=end,
                segments=14,
                radius=radius,
                width=width,
                front_depth=depth,
                thickness=max(0.45, width * 0.62),
                phase=phase,
                radius_wobble=1.1 + index * 0.16,
            )
        )

    source_vertices, source_triangles = BASE.mesh_metrics(export_objects)
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
    )

    glb_bytes = RUNTIME_GLB_PATH.stat().st_size
    runtime_vertices, runtime_triangles = BASE.inspect_exported_glb(RUNTIME_GLB_PATH)
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
        "sourceScript": BASE.relative(SCRIPT_PATH),
        "sourceBlend": BASE.relative(SOURCE_BLEND_PATH),
        "runtimeGlb": BASE.relative(RUNTIME_GLB_PATH),
        "reviewPreview": BASE.relative(REVIEW_PREVIEW_PATH),
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

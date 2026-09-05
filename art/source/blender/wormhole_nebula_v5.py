"""Author the Nebula Well mesh. Run with Blender 5.2 in background mode.

The GLB is deliberately texture-free. The game supplies a flowing nebula
material; the saved Blender scene provides an editable geometry source.
"""

import hashlib
import importlib.util
import json
import math
from pathlib import Path

import bpy

HERE = Path(__file__).resolve()
ROOT = HERE.parents[3]
ASSET_ID = "wormhole_nebula_v5"
GLB = ROOT / "apps/game-web/public/assets/stages/wormhole/wormhole-nebula-v5.glb"
METRICS = ROOT / "art/review/wormhole_nebula_v5.metrics.json"
spec = importlib.util.spec_from_file_location("stage_helpers", HERE.with_name("wormhole_arena_funnel_v3.py"))
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)


def surface_point(t, angle):
    # A circular mouth is a gameplay landmark. Only the deeper throat bends.
    depth = 2.0 + 180.0 * t ** 0.78
    radius = 72.0 * math.exp(-4.3 * t)
    warp = 1.0 + 0.065 * math.sin(3.0 * angle + t * 8.0) * math.sin(t * math.pi)
    warp += 0.028 * math.sin(7.0 * angle - t * 11.0) * math.sin(t * math.pi)
    return (
        9.0 * t * t + radius * warp * math.cos(angle),
        depth,
        -4.0 * t * t + radius * warp * math.sin(angle),
    )


def main():
    shared.assert_blender_version()
    shared.clear_scene()
    bpy.context.preferences.filepaths.save_version = 0
    root = bpy.data.objects.new(ASSET_ID, None)
    bpy.context.collection.objects.link(root)
    root["asset_id"] = ASSET_ID
    root["schema_version"] = "gw.blender-stage-source.v1"
    root["game_plane"] = "XY"
    root["game_depth_axis"] = "negative_Z"
    root["design_intent"] = "continuous bent nebula throat; fixed 72-unit circular mouth"
    root["runtime_material"] = "nebula_flow_v1"

    material = shared.create_material("nebula_shell", "#020713", "#081b2b", alpha=1.0, metallic=0.0, roughness=1.0)
    material.use_backface_culling = False
    angular, longitudinal = 128, 40
    vertices = [surface_point(j / longitudinal, i * math.tau / angular)
                for j in range(longitudinal + 1) for i in range(angular)]
    faces = []
    for j in range(longitudinal):
        for i in range(angular):
            a = j * angular + i
            b = j * angular + (i + 1) % angular
            faces.append((a, b, b + angular, a + angular))
    shell = shared.create_mesh_object(name="nebula_continuous_throat", parent=root,
                                     material=material, vertices=vertices, faces=faces, smooth=True)
    shell["material_role"] = "nebula_flow_v1"
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    shell.select_set(True)
    bpy.context.view_layer.objects.active = root
    GLB.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(GLB), export_format="GLB", use_selection=True,
                             export_yup=True, export_apply=True, export_cameras=False,
                             export_lights=False, export_extras=True, export_texcoords=False,
                             export_normals=True, export_tangents=False)
    vertex_count, triangle_count = shared.inspect_exported_glb(GLB)
    byte_count = GLB.stat().st_size
    assert vertex_count <= 6000 and triangle_count <= 11000 and byte_count <= 256 * 1024

    # A geometry-inspection view, not a claim to match the game's animated shader.
    shared.configure_preview(root)
    bpy.context.scene.camera.location = (0, -174, 57)
    shared.point_camera(bpy.context.scene.camera, (0, 10, 0))
    bpy.ops.wm.save_as_mainfile(filepath=str(HERE.with_suffix(".blend")), check_existing=False)
    METRICS.parent.mkdir(parents=True, exist_ok=True)
    metrics = {
        "schemaVersion": "gw.blender-stage-source-metrics.v1", "assetId": ASSET_ID,
        "blenderVersion": bpy.app.version_string,
        "sourceScript": HERE.relative_to(ROOT).as_posix(),
        "sourceBlend": HERE.with_suffix(".blend").relative_to(ROOT).as_posix(),
        "runtimeGlb": GLB.relative_to(ROOT).as_posix(),
        "coordinateContract": {"blenderPlane": "XZ", "blenderDepth": "+Y",
                               "runtimePlane": "XY", "runtimeDepth": "-Z", "arenaRadius": 72},
        "metrics": {"vertices": vertex_count, "triangles": triangle_count, "glbBytes": byte_count,
                    "glbSha256": hashlib.sha256(GLB.read_bytes()).hexdigest(), "objects": 1, "materials": 1},
        "budgets": {"vertices": 6000, "triangles": 11000, "glbBytes": 256 * 1024},
    }
    METRICS.write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()

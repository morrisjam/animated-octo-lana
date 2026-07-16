"""Build and export the authored Gravity Well arena lip.

Run with Blender 2.92.0:
  blender --background --python art/source/blender/wormhole_arena_lip_v1.py
"""

from __future__ import annotations

import hashlib
import json
import math
import struct
from pathlib import Path

import bpy
from mathutils import Vector


ASSET_ID = "wormhole_arena_lip_v1"
EXPECTED_BLENDER_VERSION = (2, 92, 0)
TRIANGLE_BUDGET = 6_000
VERTEX_BUDGET = 7_000
GLB_BYTE_BUDGET = 192 * 1024

SCRIPT_PATH = Path(__file__).resolve()
REPO_ROOT = SCRIPT_PATH.parents[3]
SOURCE_BLEND_PATH = SCRIPT_PATH.with_suffix(".blend")
RUNTIME_DIR = REPO_ROOT / "apps" / "game-web" / "public" / "assets" / "stages" / "wormhole"
RUNTIME_GLB_PATH = RUNTIME_DIR / "wormhole-arena-lip-v1.glb"
REVIEW_PREVIEW_PATH = REPO_ROOT / "art" / "review" / "wormhole_arena_lip_v1.png"
REVIEW_METRICS_PATH = REPO_ROOT / "art" / "review" / "wormhole_arena_lip_v1.metrics.json"


def assert_blender_version() -> None:
    if tuple(bpy.app.version) != EXPECTED_BLENDER_VERSION:
        expected = ".".join(str(part) for part in EXPECTED_BLENDER_VERSION)
        raise RuntimeError(
            "This source is pinned to Blender {} but is running under {}.".format(
                expected,
                bpy.app.version_string,
            )
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


def create_emissive_material(
    name: str,
    base_color: str,
    emission_color: str,
    *,
    alpha: float = 1.0,
    metallic: float = 0.15,
    roughness: float = 0.32,
) -> bpy.types.Material:
    material = bpy.data.materials.new(name=name)
    material.use_nodes = True
    material.diffuse_color = rgba(base_color, alpha)
    material.blend_method = "BLEND" if alpha < 1.0 else "OPAQUE"
    material.use_screen_refraction = False
    material.show_transparent_back = True

    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = rgba(base_color, alpha)
    principled.inputs["Emission"].default_value = rgba(emission_color, 1.0)
    principled.inputs["Metallic"].default_value = metallic
    principled.inputs["Roughness"].default_value = roughness
    principled.inputs["Alpha"].default_value = alpha
    return material


def create_arc_ribbon(
    *,
    name: str,
    parent: bpy.types.Object,
    material: bpy.types.Material,
    start_degrees: float,
    end_degrees: float,
    segments: int,
    radius: float,
    width: float,
    front_depth: float,
    thickness: float,
    phase: float,
    radius_wobble: float,
) -> bpy.types.Object:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []

    for index in range(segments + 1):
        t = index / segments
        angle = math.radians(start_degrees + (end_degrees - start_degrees) * t)
        radial_noise = (
            math.sin(angle * 3.0 + phase) * radius_wobble
            + math.sin(angle * 7.0 - phase * 0.6) * radius_wobble * 0.38
        )
        local_radius = radius + radial_noise
        local_width = width * (0.86 + math.sin(t * math.pi) * 0.14)
        inner_radius = local_radius - local_width * 0.5
        outer_radius = local_radius + local_width * 0.5
        depth_ripple = math.sin(angle * 4.0 + phase) * 0.34
        front_y = front_depth + depth_ripple
        back_y = front_y + thickness * (0.9 + math.sin(t * math.pi) * 0.1)

        for radial, depth in (
            (inner_radius, front_y),
            (outer_radius, front_y),
            (inner_radius, back_y),
            (outer_radius, back_y),
        ):
            vertices.append((math.cos(angle) * radial, depth, math.sin(angle) * radial))

    for index in range(segments):
        current = index * 4
        following = (index + 1) * 4
        # Front faces point toward the game camera after Blender's Y-up GLTF conversion.
        faces.append((current, current + 1, following + 1, following))
        faces.append((current + 2, following + 2, following + 3, current + 3))
        faces.append((current, following, following + 2, current + 2))
        faces.append((current + 1, current + 3, following + 3, following + 1))

    faces.append((0, 2, 3, 1))
    final = segments * 4
    faces.append((final, final + 1, final + 3, final + 2))

    mesh = bpy.data.meshes.new(name=f"{name}_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update(calc_edges=True)
    for polygon in mesh.polygons:
        polygon.use_smooth = True

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.data.materials.append(material)

    bevel = obj.modifiers.new(name="edge_softening", type="BEVEL")
    bevel.width = min(0.58, width * 0.1)
    bevel.segments = 2
    bevel.affect = "EDGES"
    bevel.harden_normals = False
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    obj.select_set(False)
    return obj


def create_depth_rib(
    *,
    name: str,
    parent: bpy.types.Object,
    material: bpy.types.Material,
    angle_degrees: float,
    outer_radius: float,
    inner_radius: float,
    width: float,
    phase: float,
) -> bpy.types.Object:
    angle = math.radians(angle_degrees)
    tangent = Vector((-math.sin(angle), 0.0, math.cos(angle))) * (width * 0.5)
    outer = Vector((math.cos(angle) * outer_radius, 2.4, math.sin(angle) * outer_radius))
    inner = Vector((math.cos(angle) * inner_radius, 11.5 + math.sin(phase) * 1.2, math.sin(angle) * inner_radius))
    thickness = 0.7
    vertices = []
    for point in (outer - tangent, outer + tangent, inner + tangent * 0.55, inner - tangent * 0.55):
        vertices.append(tuple(point))
    for point in (outer - tangent, outer + tangent, inner + tangent * 0.55, inner - tangent * 0.55):
        vertices.append((point.x, point.y + thickness, point.z))
    faces = [
        (0, 1, 2, 3),
        (4, 7, 6, 5),
        (0, 4, 5, 1),
        (1, 5, 6, 2),
        (2, 6, 7, 3),
        (3, 7, 4, 0),
    ]
    mesh = bpy.data.meshes.new(name=f"{name}_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update(calc_edges=True)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.data.materials.append(material)
    bevel = obj.modifiers.new(name="rib_softening", type="BEVEL")
    bevel.width = 0.32
    bevel.segments = 2
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    obj.select_set(False)
    return obj


def point_camera(camera: bpy.types.Object, target: tuple[float, float, float]) -> None:
    direction = Vector(target) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def configure_preview(root: bpy.types.Object) -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.use_gtao = True
    scene.eevee.gtao_distance = 7.0
    scene.eevee.gtao_factor = 1.2
    scene.eevee.use_bloom = True
    scene.eevee.bloom_intensity = 0.07
    scene.eevee.bloom_radius = 4.5
    scene.render.resolution_x = 960
    scene.render.resolution_y = 540
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.filepath = str(REVIEW_PREVIEW_PATH)
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0

    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = rgba("#01040b", 1.0)
    background.inputs["Strength"].default_value = 0.025

    camera_data = bpy.data.cameras.new("review_camera")
    camera_data.lens = 50
    camera = bpy.data.objects.new("review_camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (0.0, -275.0, 95.0)
    point_camera(camera, (0.0, 2.5, 0.0))
    scene.camera = camera

    area_data = bpy.data.lights.new(name="near_lip_key", type="AREA")
    area_data.color = rgba("#70ddff")[:3]
    area_data.energy = 720.0
    area_data.size = 85.0
    area = bpy.data.objects.new(name="near_lip_key", object_data=area_data)
    bpy.context.collection.objects.link(area)
    area.location = (0.0, -48.0, -58.0)
    point_camera(area, (0.0, 0.0, -32.0))

    rim_data = bpy.data.lights.new(name="far_violet_fill", type="AREA")
    rim_data.color = rgba("#7652ff")[:3]
    rim_data.energy = 460.0
    rim_data.size = 64.0
    rim = bpy.data.objects.new(name="far_violet_fill", object_data=rim_data)
    bpy.context.collection.objects.link(rim)
    rim.location = (24.0, 18.0, 64.0)
    point_camera(rim, (0.0, 4.0, 28.0))

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

    cyan = create_emissive_material("lip_near_cyan", "#0b2848", "#269fc8", metallic=0.18)
    rib = create_emissive_material("depth_rib", "#07152e", "#25679d", alpha=0.62, roughness=0.46)

    export_objects = [
        create_arc_ribbon(
            name="near_lip_primary",
            parent=root,
            material=cyan,
            start_degrees=208.0,
            end_degrees=286.0,
            segments=34,
            radius=73.8,
            width=3.2,
            front_depth=1.2,
            thickness=1.45,
            phase=0.4,
            radius_wobble=2.2,
        ),
        create_arc_ribbon(
            name="near_lip_secondary",
            parent=root,
            material=cyan,
            start_degrees=306.0,
            end_degrees=337.0,
            segments=14,
            radius=75.5,
            width=2.6,
            front_depth=1.8,
            thickness=1.2,
            phase=1.2,
            radius_wobble=2.8,
        ),
    ]

    for index, angle in enumerate((224.0, 249.0, 273.0, 320.0)):
        export_objects.append(
            create_depth_rib(
                name=f"depth_rib_{index + 1:02d}",
                parent=root,
                material=rib,
                angle_degrees=angle,
                outer_radius=70.2,
                inner_radius=59.0 + (index % 2) * 2.0,
                width=0.9 + (index % 2) * 0.18,
                phase=index * 0.7,
            )
        )

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

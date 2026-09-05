import * as THREE from 'three';

// Loaded with the authored GLB, not in the initial game bundle. The shell stays
// fixed; only its light field flows. World coordinates avoid a UV seam.
export function applyNebulaStageMaterial(root: THREE.Object3D): void {
  const replaced = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      replaced.add(material);
    }
    object.material = new THREE.ShaderMaterial({
      name: 'nebula_flow_v1',
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 }, uTint: { value: new THREE.Color('#ffffff') } },
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uOpacity;
        uniform vec3 uTint;
        varying vec3 vWorld;
        float hash(vec3 p) {
          p = fract(p * .1031);
          p += dot(p, p.yzx + 33.33);
          return fract((p.x + p.y) * p.z);
        }
        float noise3(vec3 p) {
          vec3 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                         mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                         mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        float fbm(vec3 p) {
          float f = .5 * noise3(p);
          p = p * 2.03 + vec3(3.1, 7.2, 1.8);
          f += .25 * noise3(p);
          p = p * 2.01 + vec3(5.4, 2.2, 9.1);
          f += .125 * noise3(p);
          return f + .0625 * noise3(p * 2.02);
        }
        void main() {
          float depth = clamp((-vWorld.z - 2.0) / 180.0, 0.0, 1.0);
          float t = pow(depth, 1.0 / .78);
          vec2 centered = vWorld.xy - vec2(9.0, -4.0) * t * t;
          float angle = atan(centered.y, centered.x);
          float phase = angle + 5.5 * t - uTime * .035 * (.2 + t);
          vec3 p = vec3(cos(phase) * 2.4, sin(phase) * 2.4, t * 8.0 - uTime * .055);
          float cloud = fbm(p);
          float wisps = fbm(p * vec3(2.8, 2.8, .65) + cloud * 2.2);
          float wave = sin(phase * 9.0 + t * 26.0 + cloud * 12.0);
          float detail = fbm(p * vec3(7.0, 7.0, 2.0) + wisps * 3.0);
          float filaments = pow(max(0.0, wave), 22.0) * smoothstep(.28, .65, wisps);
          float glow = smoothstep(.38, .78, cloud) * (.1 + 1.2 * detail * detail);
          float inner = smoothstep(.16, .75, t);
          vec3 cool = mix(vec3(.025,.072,.115), vec3(.075,.24,.32), inner);
          vec3 warm = vec3(.31,.22,.12);
          vec3 light = mix(cool, warm, smoothstep(.53,.8,cloud) * .55);
          vec3 color = vec3(.0004,.001,.003) + light * glow * 1.2;
          color += vec3(.12,.3,.36) * filaments * (.12 + .6 * inner) * detail;
          color *= 1.0 - smoothstep(.80, 1.0, t);
          float edgeFade = smoothstep(0.0, .025, t);
          gl_FragColor = vec4(color * uTint, uOpacity * edgeFade);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    // Runtime clones materials for per-stage tint/opacity. Read the current
    // material here so the callback never updates a disposed original clone.
    object.onBeforeRender = () => {
      const material = object.material as THREE.ShaderMaterial;
      material.uniforms.uTime.value = root.parent?.parent?.userData.gameTime ?? 0;
      material.uniforms.uOpacity.value = material.opacity;
    };
  });
  for (const material of replaced) material.dispose();
}

import * as THREE from 'https://unpkg.com/three@0.161.0/build/three.module.js';

const canvas = document.querySelector('#game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#040816');

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(0, 0, 90);

const ambient = new THREE.AmbientLight('#b6c8ff', 0.5);
const keyLight = new THREE.DirectionalLight('#d5e4ff', 1.3);
keyLight.position.set(24, 16, 35);
scene.add(ambient, keyLight);

const arenaSize = 50;
const boundary = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(-arenaSize, -arenaSize, 0),
  new THREE.Vector3(arenaSize, -arenaSize, 0),
  new THREE.Vector3(arenaSize, arenaSize, 0),
  new THREE.Vector3(-arenaSize, arenaSize, 0),
]), new THREE.LineBasicMaterial({ color: '#4766a8' }));
scene.add(boundary);

const centerGeo = new THREE.SphereGeometry(7, 32, 32);
const centerMat = new THREE.MeshStandardMaterial({ color: '#7f3fff', emissive: '#5b1fcf', emissiveIntensity: 1.2, metalness: 0.2, roughness: 0.6 });
const gravityWell = new THREE.Mesh(centerGeo, centerMat);
scene.add(gravityWell);

const ring = new THREE.Mesh(
  new THREE.TorusGeometry(12, 0.45, 20, 64),
  new THREE.MeshBasicMaterial({ color: '#9f82ff', transparent: true, opacity: 0.5 }),
);
ring.rotation.x = Math.PI / 2;
scene.add(ring);

const stars = new THREE.Points(
  new THREE.BufferGeometry(),
  new THREE.PointsMaterial({ color: '#99a8ff', size: 0.35 }),
);
{
  const pts = [];
  for (let i = 0; i < 1500; i++) {
    pts.push((Math.random() - 0.5) * 300, (Math.random() - 0.5) * 300, -10 - Math.random() * 120);
  }
  stars.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
}
scene.add(stars);

const keys = new Set();
window.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

const ui = {
  p1Fuel: document.querySelector('#p1Fuel'),
  p2Fuel: document.querySelector('#p2Fuel'),
  p1Breaks: document.querySelector('#p1Breaks'),
  p2Breaks: document.querySelector('#p2Breaks'),
  status: document.querySelector('#status'),
};

function makeMech(color, wingColor) {
  const mech = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.4, 2.7, 8, 14), new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.55 }));
  body.rotation.z = Math.PI / 2;
  mech.add(body);

  const core = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 16), new THREE.MeshStandardMaterial({ color: '#fff', emissive: color, emissiveIntensity: 1.6 }));
  core.position.z = 1;
  mech.add(core);

  const wingGeo = new THREE.ConeGeometry(1.2, 3.4, 3);
  const wingMat = new THREE.MeshStandardMaterial({ color: wingColor, transparent: true, opacity: 0.6, emissive: wingColor, emissiveIntensity: 0.25 });
  const leftWing = new THREE.Mesh(wingGeo, wingMat);
  leftWing.position.set(-0.8, 0, -0.2);
  leftWing.rotation.set(Math.PI / 2, 0, Math.PI * 0.2);
  mech.add(leftWing);

  const rightWing = leftWing.clone();
  rightWing.position.x *= -1;
  rightWing.rotation.z *= -1;
  mech.add(rightWing);

  return mech;
}

function createPlayer(id, color, wingColor, controls, spawn) {
  const mesh = makeMech(color, wingColor);
  scene.add(mesh);
  return {
    id,
    mesh,
    controls,
    pos: new THREE.Vector2(spawn.x, spawn.y),
    vel: new THREE.Vector2(),
    radius: 2.25,
    fuel: 100,
    launchBreaks: 2,
    stunned: 0,
    helpless: 0,
    parry: 0,
    endLag: 0,
    chain: 0,
    superBoost: 0,
    superDir: new THREE.Vector2(),
    superTime: 0,
    superDistance: 0,
    superTurnPenalty: 0,
    cool: { shot: 0, launch: 0, dunk: 0, boost: 0 },
  };
}

const p1 = createPlayer('P1', '#58b6ff', '#7db7ff', {
  up: 'w', down: 's', left: 'a', right: 'd',
  boost: 'f', superBoost: 'g', shot: 'r', launch: 't', dunk: 'y', parry: 'h', break: 'j',
}, { x: -30, y: 6 });

const p2 = createPlayer('P2', '#ff74b8', '#ff9fd0', {
  up: 'i', down: 'k', left: 'j', right: 'l',
  boost: 'o', superBoost: 'p', shot: '[', launch: ']', dunk: '\\', parry: "'", break: ';',
}, { x: 30, y: -6 });

const players = [p1, p2];
const projectiles = [];
let winner = null;
let gameTime = 0;

function down(key) { return keys.has(key); }

function tryConsumeFuel(player, amount) {
  if (player.fuel < amount) return false;
  player.fuel = Math.max(0, player.fuel - amount);
  return true;
}

function launch(attacker, target) {
  const delta = target.pos.clone().sub(attacker.pos);
  const dist = delta.length();
  if (dist > attacker.radius + target.radius + 2.8 || attacker.cool.launch > 0 || attacker.endLag > 0) return;
  attacker.cool.launch = 0.65;

  if (target.parry > 0) {
    attacker.stunned = 0.75;
    target.parry = 0;
    return;
  }

  const dir = delta.normalize();
  const launchPower = 28 + attacker.chain * 4;
  const infx = ((down(attacker.controls.left) ? -1 : 0) + (down(attacker.controls.right) ? 1 : 0)) * 0.2;
  const infy = ((down(attacker.controls.down) ? -1 : 0) + (down(attacker.controls.up) ? 1 : 0)) * 0.2;
  dir.add(new THREE.Vector2(infx, infy)).normalize();

  target.vel.copy(dir.multiplyScalar(launchPower));
  target.helpless = 1.2;
  target.stunned = 0;
  target.fuel = Math.max(0, target.fuel - 8);
  attacker.chain += 1;
}

function dunk(attacker, target) {
  if (attacker.cool.dunk > 0 || attacker.endLag > 0) return;
  const dist = attacker.pos.distanceTo(target.pos);
  if (dist > 8) return;
  attacker.cool.dunk = 1.15;

  if (!tryConsumeFuel(attacker, 16)) {
    attacker.endLag = 0.8;
    return;
  }

  if (target.fuel <= 0 || target.helpless > 0.2) {
    winner = attacker.id;
    ui.status.classList.add('win');
    ui.status.textContent = `${attacker.id} executed the Rite-ending Dunk!`;
  } else {
    target.fuel = Math.max(0, target.fuel - 16);
    attacker.endLag = 0.45;
  }
}

function shoot(attacker, target) {
  if (attacker.cool.shot > 0 || attacker.helpless > 0 || attacker.endLag > 0) return;
  if (!tryConsumeFuel(attacker, 5)) return;

  attacker.cool.shot = 0.32;
  const dir = target.pos.clone().sub(attacker.pos).normalize();
  projectiles.push({
    owner: attacker,
    pos: attacker.pos.clone().addScaledVector(dir, attacker.radius + 0.9),
    vel: dir.multiplyScalar(42),
    life: 2,
    mesh: (() => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 10), new THREE.MeshStandardMaterial({ color: '#fff', emissive: attacker.id === 'P1' ? '#58b6ff' : '#ff74b8', emissiveIntensity: 1.8 }));
      scene.add(m);
      return m;
    })(),
  });
}

function activateBoost(player, target) {
  if (player.cool.boost > 0 || player.helpless > 0) return;
  const dir = target.pos.clone().sub(player.pos).normalize();
  player.vel.addScaledVector(dir, 20);
  player.cool.boost = 0.55;
}

function activateSuperBoost(player, target) {
  if (player.superBoost > 0 || player.helpless > 0 || player.endLag > 0) return;
  if (!tryConsumeFuel(player, 6)) return;
  player.superBoost = 0.9;
  player.superTime = 0;
  player.superDistance = 0;
  player.superTurnPenalty = 0;
  player.superDir.copy(target.pos.clone().sub(player.pos).normalize());
}

function movement(player, dt) {
  const c = player.controls;
  if (player.stunned > 0 || player.helpless > 0 || winner) return;

  if (down(c.parry) && player.parry <= 0 && player.endLag <= 0) {
    player.parry = 0.18;
    player.endLag = 0.22;
  }

  if (down(c.shot)) shoot(player, player === p1 ? p2 : p1);
  if (down(c.launch)) launch(player, player === p1 ? p2 : p1);
  if (down(c.dunk)) dunk(player, player === p1 ? p2 : p1);
  if (down(c.boost)) activateBoost(player, player === p1 ? p2 : p1);
  if (down(c.superBoost)) activateSuperBoost(player, player === p1 ? p2 : p1);

  if (down(c.break) && player.helpless > 0 && player.launchBreaks > 0) {
    player.launchBreaks -= 1;
    player.helpless = 0;
    player.stunned = 0.4;
    player.vel.multiplyScalar(0.3);
  }

  const input = new THREE.Vector2(
    (down(c.right) ? 1 : 0) - (down(c.left) ? 1 : 0),
    (down(c.up) ? 1 : 0) - (down(c.down) ? 1 : 0),
  );

  const toCenter = player.pos.clone().multiplyScalar(-1).normalize();
  const tangent = new THREE.Vector2(-toCenter.y, toCenter.x);

  if (input.lengthSq() > 0) {
    const accel = tangent.multiplyScalar(input.x * 38).add(toCenter.multiplyScalar(input.y * -30));
    player.vel.addScaledVector(accel, dt);
    if (Math.abs(input.x) + Math.abs(input.y) > 0) {
      player.fuel = Math.max(0, player.fuel - dt * 0.65);
    }
  }

  if (player.superBoost > 0) {
    player.superTime += dt;
    const desired = input.lengthSq() > 0 ? input.normalize() : player.superDir.clone();
    const turn = 1 - Math.max(-1, Math.min(1, player.superDir.dot(desired)));
    player.superTurnPenalty += turn * dt * 3;
    player.superDir.lerp(desired, 0.2).normalize();

    const wave = new THREE.Vector2(-player.superDir.y, player.superDir.x).multiplyScalar(Math.sin(player.superTime * 26) * 6);
    const step = player.superDir.clone().multiplyScalar(52).add(wave);
    player.vel.lerp(step, 0.24);
    player.superDistance += step.length() * dt;

    player.superBoost -= dt;
    if (player.superBoost <= 0) {
      const travelCost = player.superDistance * 0.05;
      const commitPenalty = player.cool.launch > 0 || player.cool.dunk > 0 ? 0 : 2.5;
      player.fuel = Math.max(0, player.fuel - travelCost - player.superTurnPenalty - commitPenalty);
    }
  }
}

function clampAndWrap(player) {
  const outX = Math.abs(player.pos.x) > arenaSize + 4;
  const outY = Math.abs(player.pos.y) > arenaSize + 4;
  if (outX || outY) {
    player.pos.x = THREE.MathUtils.euclideanModulo(player.pos.x + arenaSize, arenaSize * 2) - arenaSize;
    player.pos.y = THREE.MathUtils.euclideanModulo(player.pos.y + arenaSize, arenaSize * 2) - arenaSize;
    player.fuel = Math.max(0, player.fuel - 10);
  }
}

function updatePlayer(player, dt) {
  player.stunned = Math.max(0, player.stunned - dt);
  player.helpless = Math.max(0, player.helpless - dt);
  player.parry = Math.max(0, player.parry - dt);
  player.endLag = Math.max(0, player.endLag - dt);

  for (const key of Object.keys(player.cool)) {
    player.cool[key] = Math.max(0, player.cool[key] - dt);
  }

  if (player.fuel <= 0) player.vel.multiplyScalar(0.992);

  player.pos.addScaledVector(player.vel, dt);
  player.vel.multiplyScalar(0.94);

  if (!winner) {
    const r = player.pos.length();
    if (r < 14) {
      const push = player.pos.clone().normalize().multiplyScalar((14 - r) * 4.2);
      player.vel.add(push);
    }
  }

  clampAndWrap(player);

  player.mesh.position.set(player.pos.x, player.pos.y, 0);
  const enemy = player === p1 ? p2 : p1;
  player.mesh.lookAt(enemy.pos.x, enemy.pos.y, 0);
  player.mesh.rotation.x = Math.PI / 2;
}

function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i -= 1) {
    const p = projectiles[i];
    p.life -= dt;
    p.pos.addScaledVector(p.vel, dt);
    p.mesh.position.set(p.pos.x, p.pos.y, 0.4);

    const target = p.owner === p1 ? p2 : p1;
    if (p.pos.distanceTo(target.pos) < target.radius + 0.8 && target.parry <= 0) {
      target.stunned = 0.7;
      target.fuel = Math.max(0, target.fuel - 4);
      p.life = 0;
    }

    if (Math.abs(p.pos.x) > arenaSize + 10 || Math.abs(p.pos.y) > arenaSize + 10) p.life = 0;

    if (p.life <= 0) {
      scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      projectiles.splice(i, 1);
    }
  }
}

function updateCamera() {
  const mid = p1.pos.clone().add(p2.pos).multiplyScalar(0.5);
  const distance = p1.pos.distanceTo(p2.pos);
  const targetZ = THREE.MathUtils.clamp(70 + distance * 0.5 + Math.abs(p1.pos.y - p2.pos.y) * 0.3, 70, 120);
  camera.position.lerp(new THREE.Vector3(mid.x * 0.25, mid.y * 0.35, targetZ), 0.08);
  camera.lookAt(mid.x * 0.2, mid.y * 0.2, 0);
}

function updateUI() {
  ui.p1Fuel.style.width = `${p1.fuel}%`;
  ui.p2Fuel.style.width = `${p2.fuel}%`;
  ui.p1Breaks.textContent = `Breaks: ${p1.launchBreaks}`;
  ui.p2Breaks.textContent = `Breaks: ${p2.launchBreaks}`;

  if (!winner) {
    if (p1.helpless > 0 || p2.helpless > 0) {
      ui.status.textContent = 'Launch state active — intercept or spend a launch break.';
    } else {
      ui.status.textContent = 'Neutral state — orbit, bait, and look for launch into dunk.';
    }
  }
}

const clock = new THREE.Clock();
function tick() {
  const dt = Math.min(clock.getDelta(), 0.033);
  gameTime += dt;
  gravityWell.rotation.y += dt * 0.8;
  ring.rotation.z += dt * 0.65;

  if (!winner) {
    movement(p1, dt);
    movement(p2, dt);
  }

  updatePlayer(p1, dt);
  updatePlayer(p2, dt);
  updateProjectiles(dt);
  updateCamera();
  updateUI();

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

tick();

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

/* APEX Kart Club — original primitive geometry, procedural textures and audio.
   No modules or server required. Three.js is bundled locally under its MIT license. */
'use strict';
const CONFIG = {
  race: { laps: 3, aiCount: 5, countdown: 3, checkpoints: 12 },
  track: { width: 13, samples: 960, wallMargin: 3.8 },
  vehicle: { maxSpeed: 34, acceleration: 15, brakePower: 28, reverseSpeed: 8, steering: 2.15, grip: 9, drag: .32 },
  drift: { minSpeed: 11, grip: 2.5, chargeRate: 36, boostChargeRate: 24, maxCharge: 100, speedLoss: 1.7 },
  boost: { duration: 1.8, multiplier: 1.4, capacity: 2 },
  camera: { distance: 7.5, height: 3.8, fov: 66, damping: 7 },
  items: { respawn: 4, capacity: 2, shieldDuration: 3,
    // missile, water, slip, shield, boost. Adjust weights to tune the balance.
    weights: { front: [12, 12, 20, 28, 28], middle: [24, 23, 17, 18, 18], back: [30, 28, 12, 14, 16] } },
  effects: { particles: 120, skidMarks: 180 }
};
const ITEM_TYPES = ['missile', 'water', 'slip', 'shield', 'boost'];
const ITEM_INFO = { missile: ['↟', '추적 로켓'], water: ['◉', '물폭탄'], slip: ['≈', '슬립 패드'], shield: ['⬡', '실드'], boost: ['↗', '부스터'] };
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (v, n) => ((v % n) + n) % n;
const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const formatTime = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(3).padStart(6, '0')}`;

class InputManager {
  constructor(game) {
    this.keys = new Set(); this.pressed = new Set();
    const supported = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', 'shift', 'space', 'control', 'e', 'escape', 'r', 'f2'];
    window.addEventListener('keydown', e => {
      const k = e.code === 'Space' ? 'space' : e.key.toLowerCase();
      if (!supported.includes(k)) return;
      e.preventDefault();
      if (!e.repeat) { this.pressed.add(k); if (k === 'escape') game.pause(); if (k === 'f2') $('debug').hidden = !$('debug').hidden; }
      this.keys.add(k);
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code === 'Space' ? 'space' : e.key.toLowerCase()));
    window.addEventListener('blur', () => { this.clear(); if (game.race.state === 'racing' || game.race.state === 'countdown') game.pause(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.clear(); if (game.race.state === 'racing' || game.race.state === 'countdown') game.pause(); } });
    document.querySelectorAll('[data-key]').forEach(b => {
      b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture(e.pointerId); this.keys.add(b.dataset.key); this.pressed.add(b.dataset.key); });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => b.addEventListener(type, () => this.keys.delete(b.dataset.key)));
    });
  }
  down(...keys) { return keys.some(k => this.keys.has(k)); }
  tap(...keys) { return keys.some(k => this.pressed.has(k)); }
  clear() { this.keys.clear(); this.pressed.clear(); }
}

class AudioEngine {
  constructor() { this.enabled = false; this.ctx = null; }
  toggle() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.engine = this.ctx.createOscillator(); this.engine.type = 'sawtooth';
      this.gain = this.ctx.createGain(); this.gain.gain.value = 0;
      const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 320;
      this.engine.connect(filter); filter.connect(this.gain); this.gain.connect(this.ctx.destination); this.engine.start();
    }
    this.ctx.resume(); this.enabled = !this.enabled; $('sound').textContent = `소리 ${this.enabled ? 'ON' : 'OFF'}`;
  }
  tone(freq = 440, duration = .1, type = 'sine') {
    if (!this.enabled || !this.ctx) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain(), t = this.ctx.currentTime;
    o.type = type; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * .65, t + duration);
    g.gain.setValueAtTime(.08, t); g.gain.exponentialRampToValueAtTime(.001, t + duration);
    o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t + duration);
    o.onended = () => { o.disconnect(); g.disconnect(); };
  }
  update(v, active) {
    if (!this.ctx) return;
    this.engine.frequency.setTargetAtTime(42 + v.speed * 3, this.ctx.currentTime, .05);
    this.gain.gain.setTargetAtTime(this.enabled && active ? (v.isDrifting ? .045 : .025) : 0, this.ctx.currentTime, .08);
  }
}

class Track {
  constructor(scene) {
    this.scene = scene; this.n = CONFIG.track.samples; this.width = CONFIG.track.width;
    const points = [[0,0],[0,-85],[22,-145],[90,-162],[140,-127],[106,-77],[144,-36],[197,-71],[229,-22],[208,49],[151,62],[119,111],[46,132],[-34,96],[-54,40],[-24,38],[0,40],[0,18]];
    this.curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(p[0], 0, p[1])), true, 'centripetal');
    this.length = this.curve.getLength();
    this.points = []; this.tangents = []; this.normals = [];
    for (let i = 0; i < this.n; i++) {
      const t = i / this.n, p = this.curve.getPointAt(t), tangent = this.curve.getTangentAt(t).normalize();
      p.y = .08 + 2.8 * Math.exp(-Math.pow((t - .43) / .035, 2)) + 1.5 * Math.exp(-Math.pow((t - .74) / .055, 2));
      this.points.push(p); this.tangents.push(tangent); this.normals.push(new THREE.Vector3(tangent.z, 0, -tangent.x));
    }
    this.checkpoints = Array.from({ length: CONFIG.race.checkpoints }, (_, i) => this.frame(i / CONFIG.race.checkpoints));
    this.build();
    $('tracklength').textContent = `${(this.length / 1000).toFixed(2)} KM`;
  }
  frame(t, offset = 0) {
    const fi = wrap(t, 1) * this.n, i = Math.floor(fi), j = (i + 1) % this.n, f = fi - i;
    const p = this.points[i].clone().lerp(this.points[j], f), tangent = this.tangents[i].clone().lerp(this.tangents[j], f).normalize();
    const normal = new THREE.Vector3(tangent.z, 0, -tangent.x); p.addScaledVector(normal, offset);
    return { p, tangent, normal, yaw: Math.atan2(tangent.x, tangent.z), index: i };
  }
  nearest(pos, hint = null) {
    let best = Infinity, idx = 0;
    const search = range => { for (let k = 0; k < range; k++) {
      const i = hint === null ? k : wrap(hint + k - Math.floor(range / 2), this.n), p = this.points[i];
      const d = (pos.x - p.x) ** 2 + (pos.z - p.z) ** 2;
      if (d < best) { best = d; idx = i; }
    } };
    search(hint === null ? this.n : 100);
    if (best > 400 && hint !== null) { hint = null; search(this.n); }
    const p = this.points[idx], normal = this.normals[idx];
    return { index: idx, t: idx / this.n, p, tangent: this.tangents[idx], normal, offset: (pos.x - p.x) * normal.x + (pos.z - p.z) * normal.z, distance: Math.sqrt(best) };
  }
  ribbon(inner, outer, color, texture = null) {
    const verts = [], uvs = [], ids = [];
    for (let i = 0; i <= this.n; i++) {
      const p = this.points[i % this.n], normal = this.normals[i % this.n];
      for (const offset of [inner, outer]) { verts.push(p.x + normal.x * offset, p.y, p.z + normal.z * offset); uvs.push(offset === inner ? 0 : 1, i * this.length / this.n / 12); }
      if (i < this.n) { const b = i * 2; ids.push(b,b+2,b+1,b+1,b+2,b+3); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(verts,3)); g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2)); g.setIndex(ids); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({color, map:texture, side:THREE.DoubleSide})); this.scene.add(m); return m;
  }
  build() {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2200,2200), new THREE.MeshLambertMaterial({color:0x7caa68})); ground.rotation.x = -Math.PI/2; ground.position.y = -.06; this.scene.add(ground);
    const textureCanvas = document.createElement('canvas'); textureCanvas.width = textureCanvas.height = 128;
    const c = textureCanvas.getContext('2d'); c.fillStyle = '#687577'; c.fillRect(0,0,128,128);
    let seed = 42; const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i=0;i<2400;i++){c.fillStyle=rand()>.5?'#ffffff0c':'#0000000c'; c.fillRect(rand()*128,rand()*128,1,1);}
    const texture = new THREE.CanvasTexture(textureCanvas); texture.wrapS=texture.wrapT=THREE.RepeatWrapping; texture.colorSpace=THREE.SRGBColorSpace;
    this.ribbon(-this.width/2-1.1,this.width/2+1.1,0xd9cfac);
    this.ribbon(-this.width/2,this.width/2,0xffffff,texture).position.y=.015;
    for (const side of [-1,1]) this.ribbon(side*this.width/2,side*(this.width/2-.15),0xf1e9c8).position.y=.025;
    // Small center dashes, generous lane width, and warm/mint curbs.
    const curbG = new THREE.BoxGeometry(.65,.14,1.9), dashG = new THREE.BoxGeometry(.12,.02,2.8);
    const curbM = [new THREE.MeshLambertMaterial({color:0xf4dfaa}),new THREE.MeshLambertMaterial({color:0x3a8b80})];
    const curbCount = Math.floor(this.length/2);
    curbM.forEach((m,k) => {
      const mesh = new THREE.InstancedMesh(curbG,m,curbCount); let count=0; const o=new THREE.Object3D();
      for(let i=k;i<curbCount;i+=2)for(const side of [-1,1]){const f=this.frame(i/curbCount,side*(this.width/2+.35));o.position.copy(f.p);o.rotation.y=f.yaw; o.updateMatrix(); mesh.setMatrixAt(count++,o.matrix);}
      mesh.count=count;this.scene.add(mesh);
    });
    const dash = new THREE.InstancedMesh(dashG,new THREE.MeshLambertMaterial({color:0xc4cdbe}),Math.ceil(this.length/9));const o=new THREE.Object3D();
    for(let i=0;i<dash.count;i++){const f=this.frame(i/dash.count);o.position.copy(f.p);o.position.y+=.035;o.rotation.y=f.yaw;o.updateMatrix();dash.setMatrixAt(i,o.matrix);}this.scene.add(dash);
    const count=350, trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.35,.5,3,5),new THREE.MeshLambertMaterial({color:0x81664b}),count);
    const crowns=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,0),new THREE.MeshLambertMaterial({color:0x4f9368,flatShading:true}),count);
    const tops=new THREE.InstancedMesh(new THREE.ConeGeometry(1,1,6),new THREE.MeshLambertMaterial({color:0x326e58}),count);
    const color=new THREE.Color();
    for(let i=0;i<count;i++){
      const t=rand(), side=rand()>.5?1:-1, f=this.frame(t,side*(11+rand()*58));
      if(this.nearest(f.p).distance<9){i--;continue;}
      const size=2+rand()*2.8;o.position.copy(f.p);o.position.y=1.45;o.scale.set(.8,1,.8);o.rotation.set(0,rand()*6,0);o.updateMatrix();trunks.setMatrixAt(i,o.matrix);
      o.position.y=3.6+size*.3;o.scale.set(size,size*.85,size);o.updateMatrix();crowns.setMatrixAt(i,o.matrix);color.setHSL(.32+rand()*.09,.3+rand()*.2,.27+rand()*.18);crowns.setColorAt(i,color);
      o.position.y+=size*.7;o.scale.set(size*.85,size*2.4,size*.85);o.updateMatrix();tops.setMatrixAt(i,o.matrix); tops.setColorAt(i,color);
    }
    this.scene.add(trunks,crowns,tops);
    const rocks=new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1,0),new THREE.MeshLambertMaterial({color:0x929a85,flatShading:true}),90);
    for(let i=0;i<90;i++){const f=this.frame(rand(),(rand()>.5?1:-1)*(9+rand()*14));o.position.copy(f.p);o.position.y=.5;o.scale.set(1+rand()*1.6,.6+rand(),.8+rand());o.rotation.set(rand(),rand()*6,0);o.updateMatrix();rocks.setMatrixAt(i,o.matrix);}this.scene.add(rocks);
    // Fences remain beyond the collision margin. One instanced draw per part.
    const fenceCount=Math.ceil(this.length/5)*2, post=new THREE.InstancedMesh(new THREE.BoxGeometry(.18,1.2,.18),new THREE.MeshLambertMaterial({color:0xd4bc85}),fenceCount);
    const rail=new THREE.InstancedMesh(new THREE.BoxGeometry(.13,.17,5.2),new THREE.MeshLambertMaterial({color:0xa89167}),fenceCount*2);
    for(let i=0;i<fenceCount/2;i++)for(let s=0;s<2;s++){const f=this.frame(i/(fenceCount/2),(s?1:-1)*11);o.scale.set(1,1,1);o.rotation.set(0,f.yaw,0);o.position.copy(f.p);o.position.y+=.6;o.updateMatrix();post.setMatrixAt(i*2+s,o.matrix);
      for(let j=0;j<2;j++){o.position.y=f.p.y+.35+j*.5;o.updateMatrix();rail.setMatrixAt((i*2+s)*2+j,o.matrix);}}
    this.scene.add(post,rail);
    for(let i=0;i<18;i++){const mountain=new THREE.Mesh(new THREE.ConeGeometry(50+rand()*50,50+rand()*70,5),new THREE.MeshLambertMaterial({color:i%2?0x83a9a0:0x7b9d92,flatShading:true}));const a=i/18*Math.PI*2;mountain.position.set(85+Math.sin(a)*530,15,Math.cos(a)*530);this.scene.add(mountain);}
    // Start banner, original typography rendered with Canvas.
    const start=this.frame(0); const arch=new THREE.Group();arch.position.copy(start.p);arch.rotation.y=start.yaw;
    for(const s of [-1,1]){const pole=Game.box(.3,6.7,.3,0x315d58);pole.position.set(s*7.2,3.35,0);arch.add(pole);}
    const board=Game.box(14.7,1.5,.35,0x204842);board.position.y=6.2;arch.add(board);
    const banner=Game.textPlane('APEX  /  EVERGREEN PARK',13.6,1.2,'#204842','#edf4d7');banner.position.set(0,6.2,.19);arch.add(banner);const backBanner=banner.clone();backBanner.position.z=-.19;backBanner.rotation.y=Math.PI;arch.add(backBanner);this.scene.add(arch);
    for(let x=0;x<18;x++)for(let z=0;z<3;z++){const m=Game.box(this.width/18,.03,.6,(x+z)%2?0x234d49:0xefedcd);m.position.copy(start.p).addScaledVector(start.normal,(x+.5)*this.width/18-this.width/2).addScaledVector(start.tangent,(z-1)*.6);m.position.y+=.045;m.rotation.y=start.yaw;this.scene.add(m);}
    for(let i=1;i<CONFIG.race.checkpoints;i++){
      const f=this.checkpoints[i];
      for(const side of [-1,1]){const g=new THREE.Group();g.position.copy(f.p).addScaledVector(f.normal,side*7.8);g.rotation.y=f.yaw;const pole=Game.box(.14,3,.14,0xf3dfb1);pole.position.y=1.5;g.add(pole);const flag=Game.box(.9,.65,.08,0x4bb8a0);flag.position.set(side*.4,2.55,0);g.add(flag);this.scene.add(g);}
    }
    // Covered forest tunnel with open sides and ample camera clearance.
    const tunnel=this.frame(.66);const tunnelGroup=new THREE.Group();tunnelGroup.position.copy(tunnel.p);tunnelGroup.rotation.y=tunnel.yaw;
    for(let z=-10;z<=10;z+=4){for(const side of [-1,1]){const p=Game.box(.6,8,.65,0x73968b);p.position.set(side*7.6,4,z);tunnelGroup.add(p);}const r=Game.box(15.8,.6,.7,0x527f73);r.position.set(0,8,z);tunnelGroup.add(r);}
    const roof=Game.box(16.4,.4,24,0x406d61);roof.position.y=8.5;tunnelGroup.add(roof);this.scene.add(tunnelGroup);
    // Bridge above a small pond, placed along the raised portion of the road.
    const bridge=this.frame(.43);const pond=new THREE.Mesh(new THREE.CircleGeometry(20,32),new THREE.MeshLambertMaterial({color:0x73bfc0,transparent:true,opacity:.85}));pond.rotation.x=-Math.PI/2;pond.position.set(bridge.p.x,.005,bridge.p.z);this.scene.add(pond);
    for(const side of [-1,1])for(let i=-5;i<=5;i++){const f=this.frame(.43+i*2.3/this.length,side*7.4);const pillar=Game.box(.25,1.2,.25,0xd6b780);pillar.position.copy(f.p);pillar.position.y+=.6;this.scene.add(pillar);const r=Game.box(.18,.2,2.8,0xd6b780);r.position.copy(f.p);r.position.y+=1.1;r.rotation.y=f.yaw;this.scene.add(r);}
    for(const t of [.12,.27,.52,.81,.92]){const f=this.frame(t,9);const sign=new THREE.Group();sign.position.copy(f.p);sign.rotation.y=f.yaw;const p=Game.box(.15,2,.15,0x796747);p.position.y=1;sign.add(p);const b=Game.textPlane('→  FIND YOUR LINE',3.7,1,'#f2dfab','#24534b');b.position.y=2.2;sign.add(b);this.scene.add(sign);}
  }
}

class Vehicle {
  constructor(game,index,color) {
    this.game=game;this.index=index;this.color=color;this.isPlayer=index===0;
    this.pos=new THREE.Vector3();this.prev=new THREE.Vector3();this.velocity=new THREE.Vector3();
    this.forward=new THREE.Vector3();this.side=new THREE.Vector3();this.mesh=this.build(color);game.scene.add(this.mesh);
    this.ai={maxSpeed:28+index*.75,acceleration:12+index*.45,corneringSkill:.68+index*.045,line:(index%3-1)*2.15};
    this.reset();
  }
  build(color) {
    const g=new THREE.Group(), chassis=new THREE.Group();g.add(chassis);this.chassis=chassis;
    const body=Game.box(1.15,.34,1.75,color);body.position.y=.5;chassis.add(body);
    const nose=Game.box(.9,.22,.65,color);nose.position.set(0,.56,1.05);chassis.add(nose);
    const trim=Game.box(.32,.035,1.8,0xf2efd6);trim.position.set(0,.69,.35);chassis.add(trim);
    const bumper=Game.box(1.6,.17,.2,0x273f42);bumper.position.set(0,.32,1.35);chassis.add(bumper);
    const back=Game.box(1.35,.18,.22,0x273f42);back.position.set(0,.35,-1.0);chassis.add(back);
    const wing=Game.box(1.55,.1,.4,color);wing.position.set(0,.9,-.93);chassis.add(wing);
    for(const s of [-1,1]){const support=Game.box(.08,.43,.08,0x273f42);support.position.set(s*.52,.67,-.93);chassis.add(support);const light=Game.box(.27,.06,.05,0xffa783);light.position.set(s*.48,.52,-1.12);chassis.add(light);}
    this.wheels=[];
    for(const x of [-.76,.76])for(const z of [-.67,.78]){const w=new THREE.Group();const tire=new THREE.Mesh(new THREE.CylinderGeometry(.32,.32,.27,12),Game.mat(0x253a3b));tire.rotation.z=Math.PI/2;w.add(tire);const hub=new THREE.Mesh(new THREE.CylinderGeometry(.16,.16,.28,8),Game.mat(0xe3dab4));hub.rotation.z=Math.PI/2;w.add(hub);w.position.set(x,.32,z);g.add(w);this.wheels.push(w);}
    const seat=Game.box(.64,.55,.35,0x263c3d);seat.position.set(0,.88,-.34);chassis.add(seat);
    const driver=new THREE.Mesh(new THREE.CapsuleGeometry(.24,.28,3,8),Game.mat(0xf4e4ba));driver.position.set(0,1.03,-.12);chassis.add(driver);
    const helmet=new THREE.Mesh(new THREE.SphereGeometry(.34,12,8),Game.mat(color));helmet.position.set(0,1.51,-.11);chassis.add(helmet);
    const visor=Game.box(.46,.14,.13,0x294b52);visor.position.set(0,1.51,.19);chassis.add(visor);
    const helmetStripe=Game.box(.07,.04,.5,0xfff2ca);helmetStripe.position.set(0,1.83,-.1);chassis.add(helmetStripe);
    const shadow=new THREE.Mesh(new THREE.CircleGeometry(1.12,20),new THREE.MeshBasicMaterial({color:0x153f32,transparent:true,opacity:.2,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.scale.set(.9,1.35,1);shadow.position.y=.025;g.add(shadow);
    this.shieldMesh=new THREE.Mesh(new THREE.SphereGeometry(1.6,16,12),new THREE.MeshBasicMaterial({color:0x92e9d2,transparent:true,opacity:.2,wireframe:true,depthWrite:false}));this.shieldMesh.position.y=.8;this.shieldMesh.visible=false;g.add(this.shieldMesh);
    return g;
  }
  reset() {
    const row=Math.floor(this.index/2),lane=(this.index%2?1:-1)*1.8;
    const f=this.game.track.frame((-(2-row)*3.7-4)/this.game.track.length,lane);
    this.pos.copy(f.p);this.prev.copy(f.p);this.yaw=f.yaw;this.velocity.set(0,0,0);this.speed=0;this.steering=0;
    this.trackIndex=f.index;this.completedLaps=0;this.nextCP=1;this.lastCP=0;this.lapStart=0;this.bestLap=Infinity;this.checkpointAge=0;
    this.totalProgress=-(2-row)*3.7/this.game.track.length;this.finished=false;this.finishTime=null;this.rank=6;
    this.isDrifting=false;this.driftDirection=0;this.driftTime=0;this.driftCharge=0;this.boostEnergy=0;this.boosters=0;
    this.boostTime=0;this.miniTurbo=0;this.stun=0;this.spin=0;this.shield=0;this.inventory=[];this.itemCooldown=1.5+this.index;this.collisionCooldown=0;this.offroad=false;this.fxTime=0;
    this.sync(0);
  }
  control(dt) {
    const input=this.game.input;
    if(this.isPlayer)return { throttle:input.down('w','arrowup')?1:0,brake:input.down('s','arrowdown')?1:0,steer:(input.down('d','arrowright')?1:0)-(input.down('a','arrowleft')?1:0),drift:input.down('shift') };
    const track=this.game.track,near=track.nearest(this.pos,this.trackIndex),look=track.frame(near.t+(5+this.speed*.42)/track.length,this.ai.line+Math.sin(this.game.race.elapsed*.4+this.index)*.35);
    const target=Math.atan2(look.p.x-this.pos.x,look.p.z-this.pos.z),error=angleDiff(target,this.yaw);
    const steer=clamp(-error*2.1,-1,1);
    const future=track.frame(near.t+24/track.length),curve=Math.abs(angleDiff(future.yaw,Math.atan2(near.tangent.x,near.tangent.z)));
    const targetSpeed=this.ai.maxSpeed/(1+curve*(1.35-this.ai.corneringSkill));
    return { throttle:this.speed<targetSpeed?1:.15,brake:this.speed>targetSpeed+3?.25:0,steer,drift:curve>.45&&Math.abs(steer)>.3&&this.speed>16 };
  }
  update(dt) {
    this.checkpointAge+=dt;
    // Recover an AI knocked past a gate instead of making it circle an entire lap.
    if(!this.isPlayer&&this.checkpointAge>14)this.resetCheckpoint();
    this.prev.copy(this.pos);this.collisionCooldown=Math.max(0,this.collisionCooldown-dt);this.itemCooldown-=dt;
    this.boostTime=Math.max(0,this.boostTime-dt);this.miniTurbo=Math.max(0,this.miniTurbo-dt);this.shield=Math.max(0,this.shield-dt);
    const track=this.game.track,near=track.nearest(this.pos,this.trackIndex);this.trackIndex=near.index;this.offroad=near.distance>track.width/2+.4;
    const c=this.control(dt);this.steering=damp(this.steering,c.steer,10,dt);
    if(this.isPlayer && this.game.input.tap('r'))this.resetCheckpoint();
    if(this.stun>0){this.stun=Math.max(0,this.stun-dt);c.throttle=0;c.steer=0;c.drift=false;this.velocity.multiplyScalar(Math.exp(-2*dt));this.spin+=dt*8;}
    else this.spin=damp(this.spin,0,12,dt);
    const drifting=c.drift&&Math.abs(c.steer)>.1&&this.speed>CONFIG.drift.minSpeed&&!this.offroad&&this.stun<=0;
    if(drifting){
      if(!this.isDrifting){this.driftDirection=Math.sign(c.steer);this.driftTime=0;this.game.audio.tone(150,.1,'triangle');}
      this.driftTime+=dt;this.driftCharge=clamp(this.driftCharge+CONFIG.drift.chargeRate*dt,0,100);
      if(this.game.race.mode==='speed'&&this.boosters<CONFIG.boost.capacity){this.boostEnergy+=CONFIG.drift.boostChargeRate*dt;if(this.boostEnergy>=100){this.boostEnergy-=100;this.boosters++;if(this.isPlayer)this.game.toast('BOOST READY  /  SPACE');}}
    }else if(this.isDrifting){
      if(this.driftCharge>=24){this.miniTurbo=this.driftCharge>=80?1.1:this.driftCharge>=50?.7:.4;this.velocity.addScaledVector(this.forward,2.5+this.driftCharge*.045);if(this.isPlayer)this.game.toast(this.driftCharge>=80?'SUPER MINI TURBO':'MINI TURBO');this.game.audio.tone(600,.2);}
      this.driftCharge=0;this.driftTime=0;
    }
    this.isDrifting=drifting;
    if(this.isPlayer&&this.game.input.tap('space'))this.useBoost();
    if(!this.isPlayer&&this.boosters>0&&Math.abs(c.steer)<.15)this.useBoost();
    if(this.game.race.mode==='item'){
      if(this.isPlayer&&this.game.input.tap('e','control'))this.game.items.use(this);
      if(!this.isPlayer&&this.inventory.length&&this.itemCooldown<=0){const item=this.inventory[0],ahead=this.game.items.target(this),behind=this.game.vehicles.some(v=>v!==this&&v.totalProgress<this.totalProgress&&this.pos.distanceTo(v.pos)<16);
        if((item==='missile'&&ahead)||item==='water'||(item==='slip'&&behind)||item==='shield'||(item==='boost'&&Math.abs(c.steer)<.3)){this.game.items.use(this);this.itemCooldown=3+Math.random()*3;}}
    }
    const vcfg=CONFIG.vehicle,boost=this.boostTime>0||this.miniTurbo>0;
    this.yaw-=this.steering*vcfg.steering/(1+Math.abs(this.speed)*.035)*Math.min(1,Math.abs(this.speed)/4)*(this.speed<0?-1:1)*(drifting?1.23:1)*dt;
    this.forward.set(Math.sin(this.yaw),0,Math.cos(this.yaw));this.side.set(this.forward.z,0,-this.forward.x);
    let forwardSpeed=this.velocity.dot(this.forward),lateralSpeed=this.velocity.dot(this.side);
    const acceleration=this.isPlayer?vcfg.acceleration:this.ai.acceleration;
    forwardSpeed+=c.throttle*acceleration*(this.offroad?.45:boost?1.85:1)*dt;
    if(c.brake){forwardSpeed-=vcfg.brakePower*c.brake*dt;if(forwardSpeed<-vcfg.reverseSpeed)forwardSpeed=-vcfg.reverseSpeed;}
    forwardSpeed*=Math.exp(-(vcfg.drag+(this.offroad?1.5:0)+(drifting?.16:0))*dt);
    if(drifting)forwardSpeed-=CONFIG.drift.speedLoss*dt;
    const max=this.offroad?14:vcfg.maxSpeed*(boost?CONFIG.boost.multiplier:1);
    forwardSpeed=clamp(forwardSpeed,-vcfg.reverseSpeed,max);
    lateralSpeed*=Math.exp(-(drifting?CONFIG.drift.grip:vcfg.grip)*dt);
    this.velocity.copy(this.forward).multiplyScalar(forwardSpeed).addScaledVector(this.side,lateralSpeed);
    this.pos.addScaledVector(this.velocity,dt);this.speed=forwardSpeed;
    const after=track.nearest(this.pos,this.trackIndex);this.trackIndex=after.index;this.pos.y=after.p.y;
    if(after.distance>track.width/2+CONFIG.track.wallMargin){
      this.pos.copy(after.p).addScaledVector(after.normal,Math.sign(after.offset)*(track.width/2+CONFIG.track.wallMargin-.15));
      const vn=this.velocity.dot(after.normal);this.velocity.addScaledVector(after.normal,-vn*1.45).multiplyScalar(.7);
      if(this.collisionCooldown<=0){this.game.audio.tone(80,.13,'square');this.collisionCooldown=.4;}
    }
    this.game.race.progress(this);
    this.fxTime+=dt;
    if(this.fxTime>.045){this.fxTime=0;if(drifting){this.game.effects.drift(this);}if(boost)this.game.effects.exhaust(this);}
    this.sync(dt);
  }
  useBoost() {
    if(this.boosters<=0||this.boostTime>0||this.stun>0)return;
    this.boosters--;this.boostTime=CONFIG.boost.duration;this.game.audio.tone(330,.28,'sawtooth');
    if(this.isPlayer)this.game.toast('FULL BOOST');
  }
  resetCheckpoint() {
    const f=this.game.track.checkpoints[this.lastCP];this.pos.copy(f.p).addScaledVector(f.tangent,2);this.prev.copy(this.pos);this.yaw=f.yaw;this.velocity.set(0,0,0);this.speed=0;this.stun=0;this.spin=0;this.isDrifting=false;this.driftCharge=0;this.trackIndex=f.index;this.checkpointAge=0;
    if(this.isPlayer){this.game.snapCamera();this.game.toast('체크포인트로 복귀했습니다');}
  }
  sync(dt) {
    this.mesh.position.copy(this.pos);this.mesh.rotation.y=this.yaw+this.spin;
    this.chassis.rotation.z=damp(this.chassis.rotation.z,this.isDrifting?this.steering*.11:this.steering*.025,9,dt);
    this.wheels.forEach((w,i)=>{w.rotation.y=i%2?this.steering*.35:0;w.children.forEach(c=>c.rotation.x-=this.speed*dt*2);});
    this.shieldMesh.visible=this.shield>0;this.shieldMesh.rotation.y+=dt;
  }
}

class RaceManager {
  constructor(game){this.game=game;this.state='menu';this.mode='speed';this.elapsed=0;this.countdown=3;this.previousCountdown=4;this.pausedFrom=null;}
  start(mode){
    this.mode=mode;this.elapsed=0;this.countdown=CONFIG.race.countdown;this.previousCountdown=4;this.state='countdown';
    this.game.input.clear();this.game.items.reset(mode);this.game.effects.clear();this.game.vehicles.forEach(v=>v.reset());this.game.snapCamera();
    ['menu','result','pausemenu'].forEach(id=>$(id).hidden=true);$('itempanel').hidden=mode!=='item';$('racemode').textContent=mode==='speed'?'SPEED RACE':'ITEM RACE';$('countdown').textContent='3';
  }
  update(dt){
    if(this.state==='countdown'){
      this.countdown-=dt;const number=Math.ceil(this.countdown);
      if(number!==this.previousCountdown){this.previousCountdown=number;this.game.audio.tone(number>0?400:850,.16);}
      $('countdown').textContent=number>0?number:'GO!';
      if(this.countdown<=0){this.state='racing';this.game.toast('GO!  /  좋은 레이스 되세요');$('countdown').textContent='';}
      return;
    }
    if(this.state!=='racing')return;
    this.elapsed+=dt;
    this.game.vehicles.forEach(v=>{if(!v.finished)v.update(dt);});
    // Soft symmetric contact avoids karts becoming wedged together.
    const vs=this.game.vehicles;
    for(let i=0;i<vs.length;i++)for(let j=i+1;j<vs.length;j++){
      const a=vs[i],b=vs[j],dx=a.pos.x-b.pos.x,dz=a.pos.z-b.pos.z,d=Math.hypot(dx,dz);
      if(d<1.55&&d>.001&&!a.finished&&!b.finished){const push=(1.55-d)*.5,nx=dx/d,nz=dz/d;a.pos.x+=nx*push;a.pos.z+=nz*push;b.pos.x-=nx*push;b.pos.z-=nz*push;a.velocity.multiplyScalar(.985);b.velocity.multiplyScalar(.985);}
    }
    this.game.items.update(dt);this.rank();
    if(this.game.player.finished)this.finish();
  }
  progress(v){
    const cp=this.game.track.checkpoints[v.nextCP],ax=v.prev.x-cp.p.x,az=v.prev.z-cp.p.z,bx=v.pos.x-cp.p.x,bz=v.pos.z-cp.p.z;
    const before=ax*cp.tangent.x+az*cp.tangent.z,after=bx*cp.tangent.x+bz*cp.tangent.z;
    const lateral=Math.abs(bx*cp.normal.x+bz*cp.normal.z);
    if(before<0&&after>=0&&lateral<=CONFIG.track.width/2+1){
      v.lastCP=v.nextCP;v.checkpointAge=0;
      if(v.nextCP===0){
        v.completedLaps++;const lapTime=this.elapsed-v.lapStart;v.bestLap=Math.min(v.bestLap,lapTime);v.lapStart=this.elapsed;
        if(v.completedLaps>=CONFIG.race.laps){v.finished=true;v.finishTime=this.elapsed;v.totalProgress=CONFIG.race.laps;return;}
        if(v.isPlayer){this.game.toast(v.completedLaps===2?'FINAL LAP':'LAP 2  /  계속 달려요');this.game.audio.tone(780,.2);}
      }
      v.nextCP=(v.nextCP+1)%CONFIG.race.checkpoints;
    }
    // Bound progress within the validated checkpoint sector; shortcuts cannot improve ranking.
    const sectors=CONFIG.race.checkpoints,sector=v.nextCP===0?sectors-1:v.nextCP-1;
    const t=v.trackIndex/this.game.track.n;
    const fraction=clamp(t*sectors-sector,0,.999);
    v.totalProgress=v.completedLaps+(sector+fraction)/sectors;
    if(v.completedLaps===0&&v.lastCP===0&&t>.9)v.totalProgress=-(1-t);
  }
  rank(){
    const sorted=[...this.game.vehicles].sort((a,b)=>{
      if(a.finished&&b.finished)return a.finishTime-b.finishTime;
      if(a.finished)return -1;if(b.finished)return 1;return b.totalProgress-a.totalProgress;
    });sorted.forEach((v,i)=>v.rank=i+1);
  }
  finish(){
    this.state='finished';const p=this.game.player;$('result').hidden=false;$('resultposition').textContent=`${p.rank} / 6`;$('resulttime').textContent=formatTime(this.elapsed);$('resultbest').textContent=formatTime(p.bestLap);$('resulttitle').textContent=p.rank===1?'당신이 오늘의 챔피언.':'멋진 레이스였습니다.';this.game.audio.tone(880,.4);this.game.input.clear();
  }
  menu(){this.state='menu';this.elapsed=0;this.game.input.clear();this.game.items.reset('speed');this.game.effects.clear();this.game.vehicles.forEach(v=>v.reset());this.game.snapCamera();$('menu').hidden=false;['result','pausemenu','itempanel'].forEach(id=>$(id).hidden=true);$('countdown').textContent='';}
}

class ItemManager {
  constructor(game){this.game=game;this.boxes=[];this.objects=[];
    const geo=new THREE.BoxGeometry(1.15,1.15,1.15),mat=new THREE.MeshLambertMaterial({color:0x75e2ca,transparent:true,opacity:.66});
    for(const t of [.08,.24,.4,.55,.72,.88])for(const offset of [-3,0,3]){const f=game.track.frame(t,offset),mesh=new THREE.Mesh(geo,mat);mesh.position.copy(f.p);mesh.position.y+=1.15;const edges=new THREE.LineSegments(new THREE.EdgesGeometry(geo),new THREE.LineBasicMaterial({color:0xecffdc}));mesh.add(edges);const mark=Game.textPlane('?',.75,.75,'#367b70','#f4f0c6');mark.position.z=.58;mesh.add(mark);game.scene.add(mesh);this.boxes.push({mesh,p:f.p.clone(),cooldown:0,phase:t*100+offset});}
    this.reset('speed');
  }
  remove(o){this.game.scene.remove(o.mesh);o.mesh.traverse(child=>{if(child.geometry)child.geometry.dispose();if(child.material){const ms=Array.isArray(child.material)?child.material:[child.material];ms.forEach(m=>{if(m.userData.transient)m.dispose();});}});}
  reset(mode){this.objects.forEach(o=>this.remove(o));this.objects=[];this.boxes.forEach(b=>{b.cooldown=0;b.mesh.visible=mode==='item';});}
  roll(rank){const weights=rank<=2?CONFIG.items.weights.front:rank<=4?CONFIG.items.weights.middle:CONFIG.items.weights.back;let r=Math.random()*weights.reduce((a,b)=>a+b,0);for(let i=0;i<weights.length;i++){r-=weights[i];if(r<0)return ITEM_TYPES[i];}return 'boost';}
  target(owner){return this.game.vehicles.filter(v=>v!==owner&&!v.finished&&v.totalProgress>owner.totalProgress).sort((a,b)=>a.totalProgress-b.totalProgress)[0]||null;}
  use(owner){
    if(!owner.inventory.length||owner.stun>0)return;
    const type=owner.inventory.shift();this.game.audio.tone(520,.14);
    if(owner.isPlayer)this.game.toast(`${ITEM_INFO[type][0]}  ${ITEM_INFO[type][1]}`);
    if(type==='boost'){owner.boostTime=2;return;}
    if(type==='shield'){owner.shield=CONFIG.items.shieldDuration;return;}
    let mesh,pos=owner.pos.clone(),target=null;
    const f=new THREE.Vector3(Math.sin(owner.yaw),0,Math.cos(owner.yaw));
    if(type==='missile'){
      target=this.target(owner);mesh=new THREE.Group();const rocket=new THREE.Mesh(new THREE.ConeGeometry(.22,.9,8),Game.mat(0xef9e7f));rocket.rotation.x=Math.PI/2;mesh.add(rocket);const flame=new THREE.Mesh(new THREE.ConeGeometry(.14,.5,6),Game.mat(0xffd98c));flame.rotation.x=-Math.PI/2;flame.position.z=-.55;mesh.add(flame);pos.addScaledVector(f,2);pos.y+=.8;
    }else if(type==='water'){
      mesh=new THREE.Mesh(new THREE.SphereGeometry(.5,12,8),Game.mat(0x71d4ee));pos.addScaledVector(f,9);const near=this.game.track.nearest(pos);pos.y=near.p.y+4;
    }else{
      mesh=new THREE.Mesh(new THREE.CylinderGeometry(.95,.95,.08,6),Game.mat(0xdbabf3));pos.addScaledVector(f,-2.8);pos.y+=.07;
    }
    mesh.position.copy(pos);this.game.scene.add(mesh);this.objects.push({type,mesh,owner,target,life:type==='slip'?16:type==='water'?1.1:5,dir:f,baseY:type==='water'?pos.y-4:pos.y});
  }
  hit(v,spin=false){
    if(v.shield>0){v.shield=0;this.game.effects.burst(v.pos,0x92f4d7,14);if(v.isPlayer)this.game.toast('SHIELD BLOCK');return;}
    v.velocity.multiplyScalar(.23);v.speed*=.23;v.stun=spin?1.0:1.25;v.spin=spin?.3:0;v.boostTime=0;v.miniTurbo=0;this.game.effects.burst(v.pos,0xade9ef,18);
    if(v.isPlayer){this.game.toast(spin?'슬립 패드!':'아이템에 맞았습니다');this.game.audio.tone(100,.2,'square');}
  }
  update(dt){
    if(this.game.race.mode!=='item')return;
    for(const box of this.boxes){box.cooldown=Math.max(0,box.cooldown-dt);box.mesh.visible=box.cooldown<=0;box.mesh.rotation.y+=dt;box.mesh.rotation.z=.2;box.mesh.position.y=box.p.y+1.1+Math.sin(this.game.race.elapsed*2+box.phase)*.15;
      if(box.cooldown>0)continue;
      for(const v of this.game.vehicles){if(v.finished||v.inventory.length>=CONFIG.items.capacity)continue;
        if(Math.hypot(v.pos.x-box.p.x,v.pos.z-box.p.z)<1.65){v.inventory.push(this.roll(v.rank));box.cooldown=CONFIG.items.respawn;box.mesh.visible=false;if(v.isPlayer){this.game.audio.tone(940,.1);this.game.toast('ITEM ACQUIRED');}break;}}
    }
    for(let i=this.objects.length-1;i>=0;i--){const o=this.objects[i];o.life-=dt;let remove=false;
      if(o.type==='water')o.mesh.position.y=o.baseY+.5+3.5*Math.pow(Math.max(0,o.life)/1.1,2);
      if(o.type==='missile'){
        if(o.target&&!o.target.finished&&this.game.vehicles.includes(o.target)){const dir=o.target.pos.clone().add(new THREE.Vector3(0,.65,0)).sub(o.mesh.position).normalize();o.dir.lerp(dir,1-Math.exp(-6*dt)).normalize();}
        o.mesh.position.addScaledVector(o.dir,54*dt);o.mesh.rotation.y=Math.atan2(o.dir.x,o.dir.z);
        const near=this.game.track.nearest(o.mesh.position);if(near.distance>CONFIG.track.width/2+CONFIG.track.wallMargin)remove=true;
        for(const v of this.game.vehicles)if(v!==o.owner&&!v.finished&&v.pos.distanceTo(o.mesh.position)<1.8){this.hit(v);remove=true;break;}
      }else if(o.type==='water'&&o.life<=0){
        const p=o.mesh.position;for(const v of this.game.vehicles)if(!v.finished&&Math.hypot(v.pos.x-p.x,v.pos.z-p.z)<6.5)this.hit(v);
        this.game.effects.burst(p,0x82dcee,24);this.game.effects.ring(p,6.5);remove=true;
      }else if(o.type==='slip'){
        for(const v of this.game.vehicles)if(v!==o.owner&&!v.finished&&Math.hypot(v.pos.x-o.mesh.position.x,v.pos.z-o.mesh.position.z)<1.4){this.hit(v,true);remove=true;break;}
      }
      if(remove||o.life<=0){this.remove(o);this.objects.splice(i,1);}
    }
  }
}

class Effects {
  constructor(game){
    this.game=game;this.cursor=0;this.skidCursor=0;this.particles=[];this.skids=[];
    const geo=new THREE.IcosahedronGeometry(.1,0);
    for(let i=0;i<CONFIG.effects.particles;i++){const mat=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,depthWrite:false});const m=new THREE.Mesh(geo,mat);m.visible=false;game.scene.add(m);this.particles.push({mesh:m,life:0,maxLife:1,vel:new THREE.Vector3()});}
    const skidGeo=new THREE.PlaneGeometry(.19,.7),skidMat=new THREE.MeshBasicMaterial({color:0x263a35,transparent:true,opacity:.3,depthWrite:false,side:THREE.DoubleSide});
    for(let i=0;i<CONFIG.effects.skidMarks;i++){const m=new THREE.Mesh(skidGeo,skidMat);m.rotation.x=-Math.PI/2;m.visible=false;game.scene.add(m);this.skids.push({mesh:m,life:0});}
    this.rings=[];
  }
  spawn(pos,color,size,life,vx=0,vy=1,vz=0){const p=this.particles[this.cursor++%this.particles.length];p.mesh.position.copy(pos);p.mesh.scale.setScalar(size);p.mesh.material.color.setHex(color);p.mesh.visible=true;p.life=p.maxLife=life;p.vel.set(vx,vy,vz);}
  drift(v){
    const color=v.driftCharge>80?0xefb4ed:v.driftCharge>50?0xffcc8e:v.driftCharge>24?0x99efe1:0xcbd6c4;
    for(const side of [-1,1]){const pos=v.pos.clone().addScaledVector(v.forward,-.8).addScaledVector(v.side,side*.75);pos.y+=.18;this.spawn(pos,color,1.4,.5,-v.velocity.x*.12,.6,-v.velocity.z*.12);
      const skid=this.skids[this.skidCursor++%this.skids.length];skid.mesh.position.copy(pos);skid.mesh.position.y=v.pos.y+.046;skid.mesh.rotation.set(-Math.PI/2,0,-v.yaw);skid.mesh.visible=true;skid.life=8;}
  }
  exhaust(v){const pos=v.pos.clone().addScaledVector(v.forward,-1.2);pos.y+=.45;this.spawn(pos,v.boostTime>0?0xffd48d:0x9df4e3,1.8,.35,-v.forward.x*6,.1,-v.forward.z*6);}
  burst(pos,color,count){for(let i=0;i<count;i++)this.spawn(pos,color,1+Math.random()*2,.5+Math.random()*.3,(Math.random()-.5)*8,Math.random()*5,(Math.random()-.5)*8);}
  ring(pos,radius){const mat=new THREE.MeshBasicMaterial({color:0x7bcfe6,transparent:true,opacity:.55,side:THREE.DoubleSide,depthWrite:false});const mesh=new THREE.Mesh(new THREE.RingGeometry(radius*.85,radius,40),mat);mesh.rotation.x=-Math.PI/2;mesh.position.copy(pos);mesh.position.y=this.game.track.nearest(pos).p.y+.12;this.game.scene.add(mesh);this.rings.push({mesh,life:.6});}
  update(dt){for(const p of this.particles){if(p.life<=0)continue;p.life-=dt;p.mesh.visible=p.life>0;p.mesh.position.addScaledVector(p.vel,dt);p.mesh.material.opacity=Math.max(0,p.life/p.maxLife);p.mesh.scale.multiplyScalar(1+dt);}
    for(const s of this.skids)if(s.life>0){s.life-=dt;s.mesh.visible=s.life>0;}
    for(let i=this.rings.length-1;i>=0;i--){const r=this.rings[i];r.life-=dt;r.mesh.material.opacity=Math.max(0,r.life*.8);if(r.life<=0){this.game.scene.remove(r.mesh);r.mesh.geometry.dispose();r.mesh.material.dispose();this.rings.splice(i,1);}}
  }
  clear(){this.particles.forEach(p=>{p.life=0;p.mesh.visible=false;});this.skids.forEach(s=>{s.life=0;s.mesh.visible=false;});this.rings.forEach(r=>{this.game.scene.remove(r.mesh);r.mesh.geometry.dispose();r.mesh.material.dispose();});this.rings=[];}
}

class UIManager {
  constructor(game){this.game=game;this.map=$('minimap').getContext('2d');this.fx=$('effects').getContext('2d');this.bars=[];
    for(let i=0;i<22;i++){const b=document.createElement('i');$('speedbars').appendChild(b);this.bars.push(b);}
    const points=game.track.points;this.bounds={minX:Math.min(...points.map(p=>p.x))-14,maxX:Math.max(...points.map(p=>p.x))+14,minZ:Math.min(...points.map(p=>p.z))-14,maxZ:Math.max(...points.map(p=>p.z))+14};
    this.mapBackground=document.createElement('canvas');this.mapBackground.width=440;this.mapBackground.height=300;this.drawMapTrack();this.t=0;
  }
  mapPoint(p){const b=this.bounds,scale=Math.min(398/(b.maxX-b.minX),268/(b.maxZ-b.minZ));return{x:220+(p.x-(b.minX+b.maxX)/2)*scale,y:150+(p.z-(b.minZ+b.maxZ)/2)*scale};}
  drawMapTrack(){const c=this.mapBackground.getContext('2d');c.clearRect(0,0,440,300);c.beginPath();this.game.track.points.forEach((p,i)=>{const m=this.mapPoint(p);i?c.lineTo(m.x,m.y):c.moveTo(m.x,m.y);});c.closePath();c.lineJoin='round';c.strokeStyle='#c9e1cc28';c.lineWidth=15;c.stroke();c.strokeStyle='#d2e6cd';c.lineWidth=4;c.stroke();const m=this.mapPoint(this.game.track.points[0]);c.fillStyle='#ffdda6';c.fillRect(m.x-4,m.y-4,8,8);}
  update(dt){
    const g=this.game,p=g.player,r=g.race;this.t+=dt;
    if(this.t>.07){this.t=0;
      $('speed').textContent=String(Math.round(Math.abs(p.speed)*3.6)).padStart(3,'0');$('gear').textContent=p.speed<-.5?'R':p.speed<1?'N':Math.min(6,Math.ceil(p.speed/8));
      $('mode').textContent=p.stun>0?'RECOVERING':p.boostTime>0?'FULL BOOST':p.miniTurbo>0?'MINI TURBO':p.isDrifting?'DRIFTING':p.offroad?'OFF ROAD':r.state==='racing'?'FIND YOUR LINE':'READY TO RACE';
      $('position').textContent=p.rank;$('lap').textContent=String(Math.min(CONFIG.race.laps,p.completedLaps+1)).padStart(2,'0');$('time').textContent=formatTime(r.elapsed);$('laptime').textContent=formatTime(p.finished?0:r.elapsed-p.lapStart);$('best').textContent=Number.isFinite(p.bestLap)?formatTime(p.bestLap):'— — : — —';$('checkpoint').textContent=`CP ${p.nextCP===0?11:p.nextCP-1} / 12`;
      $('driftfill').style.width=`${p.driftCharge}%`;$('driftlevel').textContent=p.isDrifting?`${p.driftCharge>=80?'III':p.driftCharge>=50?'II':p.driftCharge>=24?'I':'—'}  ${Math.floor(p.driftCharge)}%`:'SHIFT + 조향';$('driftfill').style.background=p.driftCharge>80?'#efb4ed':p.driftCharge>50?'#ffcc8e':'#a2e4cf';
      $('boostfill').style.width=`${p.boostEnergy}%`;$('boostlabel').textContent=`${p.boosters} / 2`;$('boost0').classList.toggle('charged',p.boosters>=1);$('boost1').classList.toggle('charged',p.boosters>=2);
      this.bars.forEach((b,i)=>b.classList.toggle('active',i/22<p.speed/(CONFIG.vehicle.maxSpeed*CONFIG.boost.multiplier)));
      for(let i=0;i<2;i++){const type=p.inventory[i];$( `slot${i}`).innerHTML=type?`<b>${ITEM_INFO[type][0]}</b><small>${ITEM_INFO[type][1]}</small>`:'<b>◇</b><small>EMPTY</small>';$( `slot${i}`).classList.toggle('filled',!!type);}
      if(!$('debug').hidden)$('debug').textContent=`FPS ${Math.round(g.fps)}\nspeed ${p.speed.toFixed(2)} m/s\nvelocity ${p.velocity.x.toFixed(2)}, ${p.velocity.z.toFixed(2)}\nisDrifting ${p.isDrifting}\ndriftCharge ${p.driftCharge.toFixed(1)}\nboost ${p.boosters} / ${p.boostTime.toFixed(2)}s\nlap ${p.completedLaps+1}\ncheckpoint ${p.lastCP} → ${p.nextCP}\nraceProgress ${p.totalProgress.toFixed(4)}\nposition ${p.rank} / 6\nstate ${r.state}\nFOV ${g.camera.fov.toFixed(1)}`;
    }
    const c=this.map;c.clearRect(0,0,440,300);c.drawImage(this.mapBackground,0,0);
    for(const v of g.vehicles){const m=this.mapPoint(v.pos);c.save();c.translate(m.x,m.y);if(v.isPlayer){c.rotate(-v.yaw+Math.PI);c.beginPath();c.moveTo(0,-10);c.lineTo(7,7);c.lineTo(0,4);c.lineTo(-7,7);c.closePath();c.fillStyle='#ffdf9c';c.shadowColor='#ffe2a2';c.shadowBlur=9;c.fill();}else{c.beginPath();c.arc(0,0,4.5,0,Math.PI*2);c.fillStyle=`#${v.color.toString(16).padStart(6,'0')}`;c.fill();}c.restore();}
    const fx=this.fx,w=$('effects').width,h=$('effects').height;fx.clearRect(0,0,w,h);
    if(r.state==='racing'&&(p.boostTime>0||p.speed>30)){
      fx.strokeStyle=p.boostTime>0?'#fff2cc55':'#ffffff22';fx.lineWidth=1.3;const time=r.elapsed*6;
      for(let i=0;i<24;i++){const a=i/24*Math.PI*2,travel=wrap(time+i*.713,1),rad=.52+travel*.3,x=Math.cos(a),y=Math.sin(a);fx.beginPath();fx.moveTo(w*.5+x*w*rad,h*.44+y*h*rad);fx.lineTo(w*.5+x*w*(rad+.09),h*.44+y*h*(rad+.1));fx.stroke();}
    }
  }
}

class Game {
  static mats=new Map();
  static mat(color){if(!this.mats.has(color))this.mats.set(color,new THREE.MeshLambertMaterial({color,flatShading:true}));return this.mats.get(color);}
  static box(w,h,d,color){return new THREE.Mesh(new THREE.BoxGeometry(w,h,d),this.mat(color));}
  static textPlane(text,w,h,bg,fg){const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=128;const c=canvas.getContext('2d');c.fillStyle=bg;c.fillRect(0,0,1024,128);c.fillStyle=fg;c.font='600 43px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(text,512,66);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide}));}
  constructor(){
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0xb7dce4);this.scene.fog=new THREE.Fog(0xb7dce4,110,430);
    this.renderer=new THREE.WebGLRenderer({canvas:$('race'),antialias:true,powerPreference:'high-performance'});this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.65));this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.camera=new THREE.PerspectiveCamera(CONFIG.camera.fov,1,.1,1600);this.look=new THREE.Vector3();this.camDirection=new THREE.Vector3();this.camTarget=new THREE.Vector3();this.camLookTarget=new THREE.Vector3();
    this.scene.add(new THREE.HemisphereLight(0xf1f7dc,0x728c64,2.2));const sun=new THREE.DirectionalLight(0xffeed2,2.2);sun.position.set(-100,170,-80);this.scene.add(sun);
    // An original painted sky texture, without external art assets.
    const skyCanvas=document.createElement('canvas');skyCanvas.width=16;skyCanvas.height=256;const ctx=skyCanvas.getContext('2d');const grad=ctx.createLinearGradient(0,0,0,256);grad.addColorStop(0,'#73bbd9');grad.addColorStop(.55,'#bde3e8');grad.addColorStop(1,'#f4ecc9');ctx.fillStyle=grad;ctx.fillRect(0,0,16,256);const skyTex=new THREE.CanvasTexture(skyCanvas);skyTex.colorSpace=THREE.SRGBColorSpace;const sky=new THREE.Mesh(new THREE.SphereGeometry(1200,24,16),new THREE.MeshBasicMaterial({map:skyTex,side:THREE.BackSide,fog:false}));this.scene.add(sky);
    const cloudMat=new THREE.MeshBasicMaterial({color:0xf0f5e3,fog:true});const cloudGeo=new THREE.IcosahedronGeometry(1,1);
    for(let i=0;i<16;i++){const cloud=new THREE.Group();for(let j=0;j<4;j++){const m=new THREE.Mesh(cloudGeo,cloudMat);m.position.x=j*12;m.scale.set(17,4+(j%2)*2,9);cloud.add(m);}const a=i/16*Math.PI*2;cloud.position.set(Math.sin(a)*350,65+(i%3)*14,Math.cos(a)*350);this.scene.add(cloud);}
    this.track=new Track(this.scene);this.race=new RaceManager(this);this.audio=new AudioEngine();this.input=new InputManager(this);this.effects=new Effects(this);
    this.vehicles=[0xf2c672,0xec967f,0x90bdea,0xc2a1e6,0x8dd4b5,0xebc4a7].map((color,i)=>new Vehicle(this,i,color));this.player=this.vehicles[0];this.items=new ItemManager(this);this.ui=new UIManager(this);
    this.toastTime=0;this.fps=60;this.resize();this.snapCamera();this.bindUI();this.lastTime=performance.now();requestAnimationFrame(t=>this.frame(t));
  }
  bindUI(){
    $('speedmode').onclick=()=>this.race.start('speed');$('itemmode').onclick=()=>this.race.start('item');$('pause').onclick=()=>this.pause();$('resume').onclick=()=>this.pause();$('reset').onclick=()=>{if(this.race.state==='racing')this.player.resetCheckpoint();};$('sound').onclick=()=>this.audio.toggle();$('again').onclick=()=>this.race.start(this.race.mode);$('home').onclick=()=>this.race.menu();$('pausehome').onclick=()=>this.race.menu();window.addEventListener('resize',()=>this.resize());
  }
  resize(){const w=window.innerWidth,h=window.innerHeight;this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();$('effects').width=w;$('effects').height=h;}
  pause(){if(this.race.state==='paused'){this.race.state=this.race.pausedFrom;$('pausemenu').hidden=true;this.input.clear();}else if(this.race.state==='racing'||this.race.state==='countdown'){this.race.pausedFrom=this.race.state;this.race.state='paused';$('pausemenu').hidden=false;this.input.clear();}}
  toast(text){$('toast').textContent=text;$('toast').style.opacity='1';this.toastTime=2.2;}
  snapCamera(){const p=this.player;if(!p)return;this.camDirection.set(Math.sin(p.yaw),0,Math.cos(p.yaw));this.camera.position.copy(p.pos).addScaledVector(this.camDirection,-CONFIG.camera.distance);this.camera.position.y+=CONFIG.camera.height;this.look.copy(p.pos).addScaledVector(this.camDirection,8);this.look.y+=1.0;this.camera.lookAt(this.look);}
  updateCamera(dt){
    const p=this.player,boost=p.boostTime>0||p.miniTurbo>0,speed=Math.abs(p.speed)/CONFIG.vehicle.maxSpeed;
    // Follow movement and heading together so the drift slip angle remains visible.
    const angle=p.velocity.lengthSq()>25?Math.atan2(p.velocity.x,p.velocity.z):p.yaw;
    const chase=p.yaw+angleDiff(angle,p.yaw)*(p.isDrifting?.6:.3);
    this.camDirection.set(Math.sin(chase),0,Math.cos(chase));
    const distance=CONFIG.camera.distance+speed*1.3+(boost?1.2:0);
    this.camTarget.copy(p.pos).addScaledVector(this.camDirection,-distance);this.camTarget.y+=CONFIG.camera.height+speed*.5;
    // Move the camera anchor with the kart before damping its relative offset.
    // This preserves a low, centered kart at high speed instead of accumulating
    // several meters of translational camera lag.
    if(this.race.state==='racing'){this.camera.position.x+=p.pos.x-p.prev.x;this.camera.position.z+=p.pos.z-p.prev.z;}
    const blend=1-Math.exp(-CONFIG.camera.damping*dt);this.camera.position.lerp(this.camTarget,blend);
    const ground=this.track.nearest(this.camera.position,p.trackIndex);this.camera.position.y=Math.max(this.camera.position.y,ground.p.y+2.2);
    this.camLookTarget.copy(p.pos).addScaledVector(this.camDirection,7+speed*3);this.camLookTarget.y+=.85;this.look.lerp(this.camLookTarget,1-Math.exp(-9*dt));this.camera.lookAt(this.look);
    this.camera.fov=damp(this.camera.fov,CONFIG.camera.fov+speed*9+(boost?7:0),4,dt);this.camera.updateProjectionMatrix();
  }
  frame(now){const dt=clamp((now-this.lastTime)/1000,0,.04);this.lastTime=now;this.fps=damp(this.fps,1/Math.max(dt,.001),2,dt);
    this.race.update(dt);
    if(this.race.state!=='paused'){this.effects.update(dt);this.updateCamera(dt);if(this.toastTime>0){this.toastTime-=dt;if(this.toastTime<=0)$('toast').style.opacity='0';}}
    this.ui.update(dt);this.audio.update(this.player,this.race.state==='racing');this.renderer.render(this.scene,this.camera);this.input.pressed.clear();requestAnimationFrame(t=>this.frame(t));
  }
}

let game;
try {
  if(typeof THREE==='undefined')throw new Error('Three.js 라이브러리를 찾을 수 없습니다. vendor 폴더를 index.html과 함께 보관해 주세요.');
  game=new Game();
  // Inspection handle, useful in the browser console and smoke tests.
  window.apexGame=game;window.APEX_CONFIG=CONFIG;
} catch(error) {
  console.error(error);$('menu').hidden=true;$('loaderror').hidden=false;$('loaderror').textContent=`게임을 시작할 수 없습니다: ${error.message} 최신 Chrome 또는 Edge에서 열어 주세요.`;
}

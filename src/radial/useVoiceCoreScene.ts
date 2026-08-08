import { useEffect, useRef } from "react";
import * as THREE from "three";

const TAU = Math.PI * 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/** 音声/会話/タスク状態からシーンを駆動するための命令的API。呼び出し側(音声・チャットのフック)はこれを介してのみコアに触れる。 */
export interface VoiceCoreSceneApi {
  /** レベルを底上げする(トークン受信・読み上げ境界などの「パッと光る」演出用) */
  bumpLevel: (amount: number) => void;
  /** レベルの目標値を直接設定する(マイクRMS・読み上げ開始など) */
  setTargetLevel: (v: number) => void;
  setSpeaking: (v: boolean) => void;
  setStreaming: (v: boolean) => void;
  /**
   * タスクの実行状況をシーンへ反映する(UI/UX向上④: 3D演出の状態表現)。
   * running: 実行中タスク数(→コア周囲を回る光点の数)。
   * review: 未確認の完了/失敗数(→リング全体がゴールドの縁取りで静かに息づく)。
   */
  setTaskState: (state: { running: number; review: number }) => void;
  /** 緊急タスクの完了/失敗を知らせる一瞬の紅いフラッシュ */
  pulseUrgent: () => void;
}

/**
 * jarvis-ui radial.html の3Dラジアルダイヤルをそのまま移植した three.js シーン。
 * canvas要素2つ(3D本体・波形スコープ)への参照を受け取り、マウント中ずっと
 * 自前のrAFループで描画し続ける。Reactの再レンダーとは完全に切り離し、
 * 状態は返り値の命令的APIを通じてのみ変更する(60fpsをReact stateで駆動しない)。
 */
export function useVoiceCoreScene(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  waveCanvasRef: React.RefObject<HTMLCanvasElement | null>,
  levelReadoutRef: React.RefObject<HTMLSpanElement | null>,
) {
  const apiRef = useRef<VoiceCoreSceneApi | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const waveCanvas = waveCanvasRef.current;
    if (!canvas || !waveCanvas) return;
    const waveCtx = waveCanvas.getContext("2d");
    if (!waveCtx) return;
    const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const DPR = Math.min(window.devicePixelRatio || 1, 1.75);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(DPR);
    renderer.setClearColor(0x02040a, 1);
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x02040a, 0.008);
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
    camera.position.set(0, 7, 46);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0xdfeaff, 0x1a2340, 0.7));
    const coreLight = new THREE.PointLight(0xbfe8ff, 900, 0, 2);
    scene.add(coreLight);

    const dial = new THREE.Group();
    dial.rotation.x = -Math.PI / 2;
    scene.add(dial);

    const TEAL = new THREE.Color(0x7fe0d0);
    const INDIGO = new THREE.Color(0x7d89e8);
    const VIOLET = new THREE.Color(0x9c7fe0);
    const GOLD = new THREE.Color(0xe7c383);
    const RED = new THREE.Color(0xe8756a);

    const ringDefs = [
      { r: 7.5, z: 2.4, tube: 0.09, col: TEAL, segs: null as [number, number][] | null, speed: 0.1, alpha: 0.5 },
      { r: 10.0, z: 1.6, tube: 0.22, col: TEAL, segs: [[0.05, 0.4], [0.55, 0.95]] as [number, number][], speed: -0.18, alpha: 1.0 },
      { r: 12.6, z: 0.8, tube: 0.07, col: INDIGO, segs: null, speed: 0.13, alpha: 0.4 },
      { r: 15.4, z: 0.0, tube: 0.17, col: INDIGO, segs: [[0.1, 0.85]] as [number, number][], speed: -0.09, alpha: 0.85 },
      { r: 18.2, z: -0.8, tube: 0.07, col: VIOLET, segs: null, speed: 0.06, alpha: 0.35 },
      {
        r: 20.6,
        z: -1.6,
        tube: 0.15,
        col: VIOLET,
        segs: [[0.0, 0.3], [0.45, 0.6], [0.7, 1.0]] as [number, number][],
        speed: -0.045,
        alpha: 0.75,
      },
    ];
    const spinners: { obj: THREE.Object3D; speed: number }[] = [];
    const ringMats: { mat: THREE.MeshBasicMaterial; base: THREE.Color; alpha: number }[] = [];
    for (const def of ringDefs) {
      const holder = new THREE.Group();
      holder.position.z = def.z;
      dial.add(holder);
      spinners.push({ obj: holder, speed: def.speed });
      const mat = new THREE.MeshBasicMaterial({ color: def.col.clone(), transparent: true, opacity: def.alpha });
      ringMats.push({ mat, base: def.col.clone(), alpha: def.alpha });
      for (const [s0, s1] of def.segs || [[0, 1]]) {
        const mesh = new THREE.Mesh(new THREE.TorusGeometry(def.r, def.tube, 10, 120, (s1 - s0) * TAU), mat);
        mesh.rotation.z = s0 * TAU;
        holder.add(mesh);
      }
    }
    {
      // ティックベゼル
      const ticks = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.1, 0.9, 0.1),
        new THREE.MeshBasicMaterial({ color: 0xdce8ee, transparent: true, opacity: 0.35 }),
        72,
      );
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const eul = new THREE.Euler();
      for (let i = 0; i < 72; i++) {
        const a = (i / 72) * TAU;
        const major = i % 6 === 0;
        const r = 16.6;
        eul.set(0, 0, a);
        q.setFromEuler(eul);
        m.compose(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0), q, new THREE.Vector3(1, major ? 1.6 : 0.8, 1));
        ticks.setMatrixAt(i, m);
      }
      const holder = new THREE.Group();
      holder.add(ticks);
      holder.position.z = -0.4;
      dial.add(holder);
      spinners.push({ obj: holder, speed: 0.02 });
    }
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(1.6, 0), new THREE.MeshBasicMaterial({ color: 0xeaf6ff }));
    scene.add(core);
    const coreShell = new THREE.Mesh(
      new THREE.OctahedronGeometry(2.3, 0),
      new THREE.MeshBasicMaterial({ color: 0x7fe0d0, wireframe: true, transparent: true, opacity: 0.6 }),
    );
    scene.add(coreShell);

    const DOME_R = 13.5;
    for (const def of [
      { phi: 22, col: TEAL, alpha: 0.42, speed: 0.2, segs: [[0.05, 0.45], [0.55, 0.95]] as [number, number][] },
      { phi: 44, col: INDIGO, alpha: 0.38, speed: -0.14, segs: [[0.15, 0.75]] as [number, number][] },
      { phi: 66, col: VIOLET, alpha: 0.34, speed: 0.1, segs: [[0.0, 0.6]] as [number, number][] },
      { phi: -22, col: INDIGO, alpha: 0.2, speed: -0.12, segs: [[0.1, 0.5]] as [number, number][] },
      { phi: -44, col: VIOLET, alpha: 0.16, speed: 0.08, segs: [[0.3, 0.8]] as [number, number][] },
    ]) {
      const phi = (def.phi * Math.PI) / 180;
      const holder = new THREE.Group();
      holder.position.z = DOME_R * Math.sin(phi);
      dial.add(holder);
      spinners.push({ obj: holder, speed: def.speed });
      const mat = new THREE.MeshBasicMaterial({ color: def.col.clone(), transparent: true, opacity: def.alpha });
      ringMats.push({ mat, base: def.col.clone(), alpha: def.alpha });
      const latR = DOME_R * Math.cos(phi);
      for (const [s0, s1] of def.segs) {
        const mesh = new THREE.Mesh(new THREE.TorusGeometry(latR, 0.06, 8, 90, (s1 - s0) * TAU), mat);
        mesh.rotation.z = s0 * TAU;
        holder.add(mesh);
      }
    }
    const armilla = new THREE.Group();
    scene.add(armilla);
    const meridians: { obj: THREE.Object3D; speed: number }[] = [];
    for (const [phase, speed, alpha] of [
      [0, 0.06, 0.32],
      [Math.PI / 2, -0.045, 0.26],
    ]) {
      const holder = new THREE.Group();
      holder.rotation.y = phase;
      armilla.add(holder);
      meridians.push({ obj: holder, speed });
      const col = new THREE.Color(0xbfe0dc);
      const mat = new THREE.MeshBasicMaterial({ color: col.clone(), transparent: true, opacity: alpha });
      ringMats.push({ mat, base: col.clone(), alpha });
      holder.add(new THREE.Mesh(new THREE.TorusGeometry(DOME_R, 0.055, 8, 90, Math.PI), mat));
    }
    {
      // 星屑
      const N = 700;
      const pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const v = new THREE.Vector3().randomDirection().multiplyScalar(rand(90, 220));
        pos[i * 3] = v.x;
        pos[i * 3 + 1] = v.y;
        pos[i * 3 + 2] = v.z;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      scene.add(
        new THREE.Points(
          g,
          new THREE.PointsMaterial({ color: 0xbfd6ff, size: 0.8, sizeAttenuation: true, transparent: true, opacity: 0.7 }),
        ),
      );
    }

    /* ---- タスクモート: 実行中タスク1件ごとに1個、ダイヤル外周を回る光点(④の核) ---- */
    const MAX_MOTES = 8;
    const moteGeo = new THREE.SphereGeometry(0.32, 12, 10);
    const motes: THREE.Mesh[] = [];
    for (let i = 0; i < MAX_MOTES; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: TEAL.clone(), transparent: true, opacity: 0 });
      const mesh = new THREE.Mesh(moteGeo, mat);
      mesh.visible = false;
      dial.add(mesh);
      motes.push(mesh);
    }
    let runningTaskCount = 0;
    let reviewCount = 0;

    /* god-ray radial blur post pass */
    const rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType });
    const postScene = new THREE.Scene();
    const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const postMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: rt.texture },
        uCenter: { value: new THREE.Vector2(0.5, 0.5) },
        uWeight: { value: 0.45 },
        uDecay: { value: 0.94 },
        uExposure: { value: 1.4 },
        uThresh: { value: 0.3 },
        uTint: { value: new THREE.Vector3(1, 1, 1) },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `
        precision highp float; varying vec2 vUv;
        uniform sampler2D tDiffuse; uniform vec2 uCenter;
        uniform float uWeight; uniform float uDecay; uniform float uExposure; uniform float uThresh;
        uniform vec3 uTint;
        const int COUNT = 40;
        void main(){
          vec2 delta = (vUv - uCenter) / float(COUNT);
          float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
          vec2 s = vUv - delta * n;
          float illum = uWeight; vec3 acc = vec3(0.0);
          for (int i = 0; i < COUNT; i++) { s -= delta; acc += max(texture2D(tDiffuse, s).rgb - vec3(uThresh), vec3(0.0)) * illum; illum *= uDecay; }
          vec3 base = texture2D(tDiffuse, vUv).rgb;
          vec3 col = base + acc * uTint * (uExposure / float(COUNT));
          col = col / (1.0 + col * 0.35);
          col += (n - 0.5) * 0.008;
          gl_FragColor = vec4(col, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat));

    let W = 0;
    let H = 0;
    function resize() {
      W = window.innerWidth;
      H = window.innerHeight;
      renderer.setSize(W, H, false);
      canvas!.style.width = W + "px";
      canvas!.style.height = H + "px";
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      rt.setSize(Math.round(W * DPR), Math.round(H * DPR));
    }
    window.addEventListener("resize", resize);

    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    const onPointerMove = (e: PointerEvent) => {
      pointer.tx = (e.clientX / W) * 2 - 1;
      pointer.ty = (e.clientY / H) * 2 - 1;
    };
    window.addEventListener("pointermove", onPointerMove);

    /* ---- 音声リアクティブなレベル状態 ---- */
    let level = 0;
    let targetLevel = 0;
    let idlePhase = 0;
    let orbitTheta = 0;
    let isSpeaking = false;
    let isStreaming = false;
    let urgentFlash = 0;
    const SPEAKING_BASELINE = 0.12;
    const CAM = { speed: 0.2705, elev: 0.7679, sway: 0.1396, dist: 52 };

    /* ---- オシロスコープ ---- */
    const waveHistory = new Array(96).fill(0);
    function pushWave(v: number) {
      waveHistory.push(v);
      if (waveHistory.length > 96) waveHistory.shift();
    }
    function drawWave() {
      const w = waveCanvas!.clientWidth;
      const h = waveCanvas!.clientHeight;
      if (!w) return;
      const d = Math.min(window.devicePixelRatio || 1, 2);
      if (waveCanvas!.width !== w * d || waveCanvas!.height !== h * d) {
        waveCanvas!.width = w * d;
        waveCanvas!.height = h * d;
        waveCtx!.setTransform(d, 0, 0, d, 0, 0);
      }
      waveCtx!.clearRect(0, 0, w, h);
      const hue = urgentFlash > 0.05 ? "232,117,106" : isSpeaking ? "231,195,131" : "127,224,208";
      const mid = h / 2;
      waveCtx!.beginPath();
      waveHistory.forEach((v, i) => {
        const x = (i / (waveHistory.length - 1)) * w;
        const y = mid - v * (h * 0.42);
        i === 0 ? waveCtx!.moveTo(x, y) : waveCtx!.lineTo(x, y);
      });
      waveCtx!.strokeStyle = `rgba(${hue},0.8)`;
      waveCtx!.lineWidth = 1.2;
      waveCtx!.shadowColor = `rgba(${hue},0.7)`;
      waveCtx!.shadowBlur = 5;
      waveCtx!.stroke();
      waveCtx!.strokeStyle = "rgba(220,232,238,0.08)";
      waveCtx!.lineWidth = 1;
      waveCtx!.shadowBlur = 0;
      waveCtx!.beginPath();
      waveCtx!.moveTo(0, mid);
      waveCtx!.lineTo(w, mid);
      waveCtx!.stroke();
    }

    /* ---- メインループ ---- */
    const projected = new THREE.Vector3();
    let lastT = performance.now();
    let readoutTick = 0;
    let raf = 0;
    function frame(t: number) {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (t - lastT) / 1000);
      lastT = t;
      idlePhase += dt;
      urgentFlash = Math.max(0, urgentFlash - dt * 1.1);

      if (isSpeaking) targetLevel = lerp(targetLevel, SPEAKING_BASELINE, dt * 2.2);
      const idleTarget = isSpeaking || isStreaming ? targetLevel : 0.05 + 0.04 * Math.sin(idlePhase * 1.1);
      level = lerp(level, idleTarget, isSpeaking || isStreaming ? 0.25 : 0.1);
      pushWave((Math.sin(idlePhase * 3.2) * 0.15 + level) * (0.7 + level * 0.6) + urgentFlash * 0.3);
      if (isStreaming) targetLevel = Math.max(0, targetLevel - dt * 1.6);

      if (!REDUCED) {
        pointer.x = lerp(pointer.x, pointer.tx, 0.04);
        pointer.y = lerp(pointer.y, pointer.ty, 0.04);
        // 実行中タスクがあるほど、コアがわずかに速く回る(④: 忙しさの体感表現)
        orbitTheta += dt * CAM.speed * (1 + level * 1.4 + Math.min(runningTaskCount, 4) * 0.05);
      }
      const az = orbitTheta + pointer.x * 0.35;
      const elev = CAM.elev + Math.sin(t * 0.00007) * CAM.sway - pointer.y * 0.1;
      camera.position.set(Math.sin(az) * Math.cos(elev) * CAM.dist, Math.sin(elev) * CAM.dist, Math.cos(az) * Math.cos(elev) * CAM.dist);
      camera.lookAt(0, 0, 0);

      const swell = 1 + level * 0.1 + urgentFlash * 0.04;
      dial.scale.setScalar(swell);
      armilla.scale.setScalar(swell);
      for (const s of spinners) s.obj.rotation.z += s.speed * dt * (1 + level * 0.8);
      for (const mer of meridians) mer.obj.rotation.y += mer.speed * dt * (1 + level * 0.8);

      // review(要対応)が有るほどゴールドへ、緊急フラッシュ中は紅へ寄せる
      const goldPull = clamp(reviewCount * 0.14, 0, 0.6);
      const redPull = urgentFlash;
      for (const rm of ringMats) {
        const mixed = rm.base
          .clone()
          .lerp(GOLD, goldPull * 0.5)
          .lerp(RED, redPull * 0.7)
          .multiplyScalar(0.8 + level * 1.6);
        rm.mat.color.copy(mixed);
        rm.mat.opacity = clamp(rm.alpha + level * 0.25 + goldPull * 0.15, 0, 1);
      }
      core.scale.setScalar(1 + level * 0.5 + urgentFlash * 0.25);
      core.rotation.y += dt * 0.5;
      core.rotation.x += dt * 0.23;
      coreShell.scale.setScalar(1 + level * 0.65 + urgentFlash * 0.3);
      coreShell.rotation.y -= dt * 0.3;
      coreShell.rotation.z += dt * 0.17;
      coreLight.intensity = 700 + level * 2600 + runningTaskCount * 60 + urgentFlash * 1400;
      if (urgentFlash > 0.02) coreLight.color.copy(RED).lerp(new THREE.Color(0xbfe8ff), 1 - urgentFlash);
      else coreLight.color.set(0xbfe8ff);

      // タスクモート: 実行中タスク数だけ、外周を等間隔で周回させる
      const shown = Math.min(runningTaskCount, MAX_MOTES);
      for (let i = 0; i < MAX_MOTES; i++) {
        const mesh = motes[i];
        if (i >= shown) {
          mesh.visible = false;
          continue;
        }
        mesh.visible = true;
        const a = orbitTheta * -2.2 + (i / shown) * TAU;
        const r = 23.4;
        mesh.position.set(Math.cos(a) * r, Math.sin(a) * r, 0);
        const mat = mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.55 + 0.35 * Math.sin(idlePhase * 3 + i);
        mat.color.copy(TEAL).lerp(GOLD, goldPull * 0.4);
      }

      postMat.uniforms.uWeight.value = 0.4 + level * 0.5 + urgentFlash * 0.3;
      postMat.uniforms.uExposure.value = 1.3 + level * 3.6 + urgentFlash * 2.2;
      postMat.uniforms.uThresh.value = 0.32 - level * 0.14;
      (postMat.uniforms.uTint.value as THREE.Vector3).set(1 + redPull * 0.5, 1 - redPull * 0.25, 1 - redPull * 0.35);
      projected.set(0, 0, 0).project(camera);
      postMat.uniforms.uCenter.value.set((projected.x + 1) / 2, (projected.y + 1) / 2);

      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(postScene, postCam);
      drawWave();

      readoutTick += dt;
      if (readoutTick > 0.08) {
        readoutTick = 0;
        if (levelReadoutRef.current) levelReadoutRef.current.textContent = `LVL ${String(Math.round(level * 100)).padStart(3, "0")}`;
      }
    }

    apiRef.current = {
      bumpLevel: (amount) => {
        targetLevel = clamp(targetLevel + amount, 0, 1);
      },
      setTargetLevel: (v) => {
        targetLevel = clamp(v, 0, 1);
      },
      setSpeaking: (v) => {
        isSpeaking = v;
        if (!v) targetLevel = 0;
      },
      setStreaming: (v) => {
        isStreaming = v;
      },
      setTaskState: ({ running, review }) => {
        runningTaskCount = running;
        reviewCount = review;
      },
      pulseUrgent: () => {
        urgentFlash = 1;
      },
    };

    resize();
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      apiRef.current = null;
      renderer.dispose();
      rt.dispose();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return apiRef;
}

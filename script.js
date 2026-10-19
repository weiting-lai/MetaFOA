/**
 * MetaFOA — Spatial Audio Listening System
 * Japanese MUJI Aesthetic UI + Web Audio API + Omnitone FOARenderer + 3D Head Visualizer
 */

// ============================================================================
// 1. EXTENSIBLE PRESET FOA CATALOG
// To add more scenes in the future, append entries to PRESET_SCENES below.
// ============================================================================
const PRESET_SCENES = window.METAFOA_SCENES;
const STREAM_KEYS = ["original", "reconstructed", "reconstructed_dac", "baseline"];
if (!PRESET_SCENES?.sound_event) throw new Error("Audio scene catalog is unavailable.");

// ============================================================================
// 2. APPLICATION STATE
// ============================================================================
const state = {
  currentSceneId: "sound_event",
  activeStream: "reconstructed", // 'original' | 'reconstructed' | 'baseline'
  outputMode: "binaural", // 'binaural' (Headphones / Omnitone) | 'stereo' (Speakers / Virtual Stereo)
  theta: 0, // Azimuth in degrees [-180, 180], +left, -right
  phi: 0, // Elevation in degrees [-85, 85], +up, -down
  targetTheta: 0,
  targetPhi: 0,
  isPlaying: false,
  isLooping: true,
  isMuted: false,
  volume: 0.9,
  currentTime: 0,
  duration: PRESET_SCENES.sound_event.duration,
  gyroEnabled: false,
  omnitoneReady: false,
  waveformPeaks: [],
};

// ============================================================================
// 3. DOM ELEMENTS
// ============================================================================
const dom = {
  engineStatusBadge: document.getElementById("engineStatusBadge"),
  engineStatusText: document.getElementById("engineStatusText"),
  sceneTabs: document.querySelectorAll(".scene-tab"),
  sourceFormatBadge: document.getElementById("sourceFormatBadge"),
  specSceneName: document.getElementById("specSceneName"),
  specSampleRate: document.getElementById("specSampleRate"),
  specDuration: document.getElementById("specDuration"),

  thetaValue: document.getElementById("thetaValue"),
  phiValue: document.getElementById("phiValue"),
  gyroButton: document.getElementById("gyroButton"),
  resetOrientationButton: document.getElementById("resetOrientationButton"),
  spatialCanvas: document.getElementById("spatialCanvas"),
  activeDecoderLabel: document.getElementById("activeDecoderLabel"),
  presetAngleButtons: document.querySelectorAll(".preset-angle-btn"),

  outputModeButtons: document.querySelectorAll("[data-output-mode]"),
  abcCards: document.querySelectorAll(".abc-card"),
  abcReconstructedDesc: document.getElementById("abcReconstructedDesc"),
  sceneDetails: document.getElementById("sceneDetails"),
  playbackStatus: document.getElementById("playbackStatus"),

  playButton: document.getElementById("playButton"),
  playButtonLabel: document.getElementById("playButtonLabel"),
  timelineSlider: document.getElementById("timelineSlider"),
  waveformCanvas: document.getElementById("waveformCanvas"),
  currentTimeLabel: document.getElementById("currentTimeLabel"),
  durationLabel: document.getElementById("durationLabel"),
  loopButton: document.getElementById("loopButton"),
  muteButton: document.getElementById("muteButton"),
  volumeSlider: document.getElementById("volumeSlider"),
  volumeValueLabel: document.getElementById("volumeValueLabel"),
};

// ============================================================================
// 4. WEB AUDIO API + OMNITONE FOA & CUSTOM STEREO DECODER ENGINE
// ============================================================================
function extractPeaksFromBuffer(audioBuffer, numBins = 136) {
  const ch0 = audioBuffer.getChannelData(0);
  const ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : ch0;
  const step = Math.max(1, Math.floor(ch0.length / numBins));
  const rawPeaks = [];
  let maxPeak = 0.001;

  for (let i = 0; i < numBins; i++) {
    const start = i * step;
    const end = Math.min(ch0.length, start + step);
    let sumSq = 0;
    for (let j = start; j < end; j++) {
      const sample = 0.5 * (Math.abs(ch0[j]) + Math.abs(ch1[j]));
      if (sample > sumSq) sumSq = sample;
    }
    rawPeaks.push(sumSq);
    if (sumSq > maxPeak) maxPeak = sumSq;
  }

  return rawPeaks.map((p) => Math.max(0.08, Math.min(1.0, p / maxPeak)));
}

class SpatialAudioEngine {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.masterGain = null;

    // Decoded 4-channel FOA AudioBuffers for 'original', 'reconstructed', 'baseline'
    this.foaBuffers = {
      original: null,
      reconstructed: null,
      reconstructed_dac: null,
      baseline: null,
    };

    // Active AudioBufferSourceNodes & per-stream crossfade gains
    this.sourceNodes = {};
    this.streamGains = {};

    // Playback timing bookkeeping
    this.startTimestamp = 0;
    this.pauseOffset = 0;

    // 4-channel FOA internal bus [0: W, 1: Y, 2: Z, 3: X] (ACN/SN3D ordering)
    this.foaInputMerger = null;
    this.foaSplitter = null;
    this.foaRotatedMerger = null;
    this.rotationGains = {};

    // Output decoders
    this.omnitoneRenderer = null;
    this.binauralOutputGain = null;
    this.stereoOutputGain = null;
    this.binauralShelfFilters = [];

    this.freqData = new Uint8Array(64);
    this.initialized = false;
    this.initPromise = null;
    this.scene = null;
    this.sceneGeneration = 0;
    this.playGeneration = 0;
    this.chunkCache = new Map();
    this.pendingChunks = new Map();
    this.scheduledChunks = new Set();
    this.schedulerTimer = null;
    this.isStarting = false;
  }

  async ensureContext() {
    if (!this.initPromise) {
      this.initPromise = this.initializeContext().catch((error) => {
        this.initPromise = null;
        throw error;
      });
    }
    await this.initPromise;
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  async initializeContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx({ sampleRate: 24000 });
    }
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
    if (this.initialized) return;

    // Master output chain
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = state.isMuted ? 0 : state.volume;

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 128;
    this.analyser.smoothingTimeConstant = 0.8;

    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);

    // Per-stream gain nodes for seamless four-stream switching
    STREAM_KEYS.forEach((key) => {
      const g = this.ctx.createGain();
      g.gain.value = key === state.activeStream ? 1.0 : 0.0;
      g.channelCount = 4;
      g.channelCountMode = "explicit";
      g.channelInterpretation = "discrete";
      this.streamGains[key] = g;
    });

    // ------------------------------------------------------------------------
    // Real-time 3D FOA Rotation Matrix Stage (rotates [W, Y, Z, X] by theta, phi)
    // ------------------------------------------------------------------------
    this.foaSplitter = this.ctx.createChannelSplitter(4);
    this.foaRotatedMerger = this.ctx.createChannelMerger(4);

    Object.values(this.streamGains).forEach((g) => {
      g.connect(this.foaSplitter);
    });

    // W channel (0) is omnidirectional / invariant under 3D rotation
    const wPass = this.ctx.createGain();
    wPass.gain.value = 1.0;
    this.foaSplitter.connect(wPass, 0);
    wPass.connect(this.foaRotatedMerger, 0, 0);

    // 3x3 rotation matrix gain nodes for directional channels [1:Y, 2:Z, 3:X]
    const dirChannels = [1, 2, 3];
    dirChannels.forEach((outCh) => {
      this.rotationGains[outCh] = {};
      dirChannels.forEach((inCh) => {
        const g = this.ctx.createGain();
        g.gain.value = outCh === inCh ? 1 : 0;
        this.foaSplitter.connect(g, inCh);
        g.connect(this.foaRotatedMerger, 0, outCh);
        this.rotationGains[outCh][inCh] = g;
      });
    });

    // ------------------------------------------------------------------------
    // Decoder Path A: Headphones (Binaural) — Omnitone FOARenderer + Binaural HRTF
    // ------------------------------------------------------------------------
    this.binauralOutputGain = this.ctx.createGain();
    this.binauralOutputGain.gain.value = state.outputMode === "binaural" ? 1 : 0;
    this.binauralOutputGain.connect(this.masterGain);

    await this.setupBinauralDecoder();

    // ------------------------------------------------------------------------
    // Decoder Path B: Speakers (Stereo) — Custom Web Audio Virtual Speaker Decoder (±30°)
    // ------------------------------------------------------------------------
    this.stereoOutputGain = this.ctx.createGain();
    this.stereoOutputGain.gain.value = state.outputMode === "stereo" ? 1 : 0;
    this.stereoOutputGain.connect(this.masterGain);

    this.setupCustomStereoDecoder();

    // Apply initial orientation
    this.updateOrientation(state.theta, state.phi);

    this.initialized = true;
    dom.engineStatusBadge.classList.add("is-active");
    this.refreshEngineStatusText();
  }

  /**
   * Converts any decoded AudioBuffer (2ch stereo or 4ch FOA) into a 4-channel
   * ACN/SN3D FOA AudioBuffer [0: W, 1: Y, 2: Z, 3: X] so that Omnitone FOARenderer
   * and our 3D spherical harmonics rotator operate on genuine 4-channel FOA signals.
   */
  toFourChannelFOABuffer(decodedBuffer) {
    if (decodedBuffer.numberOfChannels >= 4) {
      return decodedBuffer;
    }

    const length = decodedBuffer.length;
    const sr = decodedBuffer.sampleRate;
    const foaBuf = this.ctx.createBuffer(4, length, sr);

    const chL = decodedBuffer.getChannelData(0);
    const chR = decodedBuffer.numberOfChannels > 1 ? decodedBuffer.getChannelData(1) : chL;

    const W = foaBuf.getChannelData(0);
    const Y = foaBuf.getChannelData(1);
    const Z = foaBuf.getChannelData(2);
    const X = foaBuf.getChannelData(3);

    for (let i = 0; i < length; i++) {
      const l = chL[i];
      const r = chR[i];
      const mid = 0.5 * (l + r);
      const side = 0.5 * (l - r);

      W[i] = 0.7071 * (l + r); // Omnidirectional pressure
      Y[i] = 1.15 * side; // Left (+Y) / Right (-Y) dipole
      Z[i] = 0.35 * side; // Elevation dipole cue
      X[i] = 0.85 * mid; // Front (+X) / Back (-X) dipole
    }

    return foaBuf;
  }

  async fetchAndDecodeArrayBuffer(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Audio download failed (${response.status}).`);
    return response.arrayBuffer();
  }

  applySceneMetadata(scene) {
    state.duration = scene.duration;
    dom.timelineSlider.max = scene.duration;
    dom.durationLabel.textContent = formatTime(scene.duration);
    dom.specDuration.textContent = `${scene.duration.toFixed(1)} s`;
    dom.specSampleRate.textContent = `${scene.sampleRate.toLocaleString()} Hz`;
    dom.specSceneName.textContent = scene.name;
    dom.sourceFormatBadge.textContent = "FOA · 4CH ACN/SN3D";
    dom.sceneDetails.textContent = `${scene.dataset.split(" · ")[0]} · Full recording`;
    state.waveformPeaks = scene.peaks;
    drawWaveform();
  }

  showStatus(text = "") {
    dom.playbackStatus.textContent = text;
    dom.playbackStatus.hidden = !text;
  }

  fail(error) {
    this.stopSources();
    state.isPlaying = false;
    this.showStatus(`${error.message} Please try again.`);
    updateTransportUI();
    this.refreshEngineStatusText();
  }

  async loadChunk(scene, index) {
    const key = `${scene.id}:${index}`;
    if (this.chunkCache.has(key)) {
      const buffers = this.chunkCache.get(key);
      this.chunkCache.delete(key);
      this.chunkCache.set(key, buffers);
      return buffers;
    }
    if (this.pendingChunks.has(key)) return this.pendingChunks.get(key);
    const task = (async () => {
      const chunk = scene.chunks[index];
      const entries = await Promise.all(STREAM_KEYS.map(async (stream) => {
        const data = await this.fetchAndDecodeArrayBuffer(chunk.streams[stream]);
        const decoded = await this.ctx.decodeAudioData(data);
        const expectedFrames = Math.round(chunk.samples * this.ctx.sampleRate / scene.sampleRate);
        if (decoded.numberOfChannels !== 4 || decoded.length !== expectedFrames) {
          throw new Error("Audio channel count or segment length does not match the scene.");
        }
        return [stream, decoded];
      }));
      const buffers = Object.fromEntries(entries);
      if (this.scene === scene) {
        this.chunkCache.set(key, buffers);
        // Complete recordings are streamed with a bounded, three-chunk cache.
        while (this.chunkCache.size > 3) this.chunkCache.delete(this.chunkCache.keys().next().value);
      }
      return buffers;
    })();
    this.pendingChunks.set(key, task);
    try { return await task; }
    finally { this.pendingChunks.delete(key); }
  }

  async loadSceneBuffers(scene) {
    const generation = ++this.sceneGeneration;
    this.stopSources();
    state.isPlaying = false;
    this.pauseOffset = 0;
    state.currentTime = 0;
    dom.currentTimeLabel.textContent = formatTime(0);
    dom.timelineSlider.value = 0;
    this.scene = scene;
    this.chunkCache.clear();
    this.applySceneMetadata(scene);
    this.showStatus(`Loading ${scene.name.toLowerCase()}…`);
    updateTransportUI();
    await this.ensureContext();
    const buffers = await this.loadChunk(scene, 0);
    if (generation !== this.sceneGeneration) return false;
    this.foaBuffers = buffers;
    this.showStatus();
    this.refreshEngineStatusText();
    return true;
  }

  async setupBinauralDecoder() {
    // 1. Initialize Google Omnitone FOARenderer if available
    if (window.Omnitone && typeof window.Omnitone.createFOARenderer === "function") {
      try {
        this.omnitoneRenderer = window.Omnitone.createFOARenderer(this.ctx, {
          ambisonicOrder: 1,
        });
        await this.omnitoneRenderer.initialize();
        this.foaRotatedMerger.connect(this.omnitoneRenderer.input);
        this.omnitoneRenderer.output.connect(this.binauralOutputGain);
        state.omnitoneReady = true;
        return;
      } catch (err) {
        console.warn("Omnitone fallback to built-in Web Audio Binaural FOA decoder:", err);
      }
    }

    // 2. Built-in Web Audio API Binaural FOA Decoder (ITD + Pinna Head-Shadow ILD)
    const rotSplit = this.ctx.createChannelSplitter(4);
    const binMerger = this.ctx.createChannelMerger(2);
    this.foaRotatedMerger.connect(rotSplit);

    const earConfigs = [
      { earIndex: 0, yWeight: 0.82, xWeight: 0.38, zWeight: 0.18 }, // Left ear (+Y)
      { earIndex: 1, yWeight: -0.82, xWeight: 0.38, zWeight: 0.18 }, // Right ear (-Y)
    ];

    this.binauralShelfFilters = [];

    earConfigs.forEach(({ earIndex, yWeight, xWeight, zWeight }) => {
      const earSum = this.ctx.createGain();
      const gW = this.ctx.createGain();
      const gY = this.ctx.createGain();
      const gZ = this.ctx.createGain();
      const gX = this.ctx.createGain();

      gW.gain.value = 0.707;
      gY.gain.value = yWeight;
      gZ.gain.value = zWeight;
      gX.gain.value = xWeight;

      rotSplit.connect(gW, 0);
      rotSplit.connect(gY, 1);
      rotSplit.connect(gZ, 2);
      rotSplit.connect(gX, 3);

      gW.connect(earSum);
      gY.connect(earSum);
      gZ.connect(earSum);
      gX.connect(earSum);

      const pinnaFilter = this.ctx.createBiquadFilter();
      pinnaFilter.type = "highshelf";
      pinnaFilter.frequency.value = 2600;
      pinnaFilter.gain.value = 0;

      earSum.connect(pinnaFilter);
      pinnaFilter.connect(binMerger, 0, earIndex);
      this.binauralShelfFilters.push(pinnaFilter);
    });

    binMerger.connect(this.binauralOutputGain);
  }

  setupCustomStereoDecoder() {
    // Custom FOA-to-Stereo virtual cardioid speaker pair at ±30° azimuth:
    // L = W + 0.707 * (cos(30°)*X + sin(30°)*Y)
    // R = W + 0.707 * (cos(30°)*X - sin(30°)*Y)
    const rotSplit = this.ctx.createChannelSplitter(4);
    const stereoMerger = this.ctx.createChannelMerger(2);
    this.foaRotatedMerger.connect(rotSplit);

    const cos30 = Math.cos((30 * Math.PI) / 180) * 0.707;
    const sin30 = Math.sin((30 * Math.PI) / 180) * 0.707;

    // Left Virtual Speaker (+30°)
    const leftW = this.ctx.createGain();
    const leftX = this.ctx.createGain();
    const leftY = this.ctx.createGain();
    leftW.gain.value = 0.707;
    leftX.gain.value = cos30;
    leftY.gain.value = sin30;

    rotSplit.connect(leftW, 0);
    rotSplit.connect(leftY, 1);
    rotSplit.connect(leftX, 3);
    leftW.connect(stereoMerger, 0, 0);
    leftY.connect(stereoMerger, 0, 0);
    leftX.connect(stereoMerger, 0, 0);

    // Right Virtual Speaker (-30°)
    const rightW = this.ctx.createGain();
    const rightX = this.ctx.createGain();
    const rightY = this.ctx.createGain();
    rightW.gain.value = 0.707;
    rightX.gain.value = cos30;
    rightY.gain.value = -sin30;

    rotSplit.connect(rightW, 0);
    rotSplit.connect(rightY, 1);
    rotSplit.connect(rightX, 3);
    rightW.connect(stereoMerger, 0, 1);
    rightY.connect(stereoMerger, 0, 1);
    rightX.connect(stereoMerger, 0, 1);

    stereoMerger.connect(this.stereoOutputGain);
  }

  updateOrientation(thetaDeg, phiDeg) {
    if (!this.initialized) return;

    const theta = (thetaDeg * Math.PI) / 180;
    const phi = (phiDeg * Math.PI) / 180;

    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const cosP = Math.cos(phi);
    const sinP = Math.sin(phi);

    // 3D rotation of sound field in listener coordinates (ACN: 1=Y, 2=Z, 3=X)
    const now = this.ctx.currentTime;
    const tau = 0.015;

    // Output Y' (ch 1)
    this.rotationGains[1][1].gain.setTargetAtTime(cosT, now, tau);
    this.rotationGains[1][2].gain.setTargetAtTime(0, now, tau);
    this.rotationGains[1][3].gain.setTargetAtTime(-sinT, now, tau);

    // Output Z' (ch 2)
    this.rotationGains[2][1].gain.setTargetAtTime(-sinP * sinT, now, tau);
    this.rotationGains[2][2].gain.setTargetAtTime(cosP, now, tau);
    this.rotationGains[2][3].gain.setTargetAtTime(-sinP * cosT, now, tau);

    // Output X' (ch 3)
    this.rotationGains[3][1].gain.setTargetAtTime(cosP * sinT, now, tau);
    this.rotationGains[3][2].gain.setTargetAtTime(sinP, now, tau);
    this.rotationGains[3][3].gain.setTargetAtTime(cosP * cosT, now, tau);

    if (this.binauralShelfFilters && this.binauralShelfFilters.length === 2) {
      const leftCue = -sinT * 5.0 + sinP * 2.5;
      const rightCue = sinT * 5.0 + sinP * 2.5;
      this.binauralShelfFilters[0].gain.setTargetAtTime(leftCue, now, tau);
      this.binauralShelfFilters[1].gain.setTargetAtTime(rightCue, now, tau);
    }
  }

  async startSourcesAt(offsetSeconds) {
    this.stopSources();
    this.isStarting = true;
    const generation = this.playGeneration;
    const scene = this.scene;
    const sceneGeneration = this.sceneGeneration;
    const offset = Math.max(0, Math.min(scene.duration - 1 / scene.sampleRate, offsetSeconds));
    this.pauseOffset = offset;
    state.isPlaying = false;
    this.showStatus("Loading audio…");
    updateTransportUI();
    const index = Math.min(scene.chunks.length - 1, Math.floor(offset * scene.sampleRate / scene.segmentSamples));
    const buffers = await this.loadChunk(scene, index);
    if (generation !== this.playGeneration || sceneGeneration !== this.sceneGeneration) return;
    this.isStarting = false;
    this.foaBuffers = buffers;
    this.playStartTime = this.ctx.currentTime + 0.04;
    this.startTimestamp = this.playStartTime - offset;
    state.isPlaying = true;
    this.showStatus();
    this.scheduleAhead(generation);
    this.schedulerTimer = setInterval(() => this.scheduleAhead(generation), 100);
    updateTransportUI();
    this.refreshEngineStatusText();
  }

  scheduleAhead(generation) {
    if (!state.isPlaying || generation !== this.playGeneration) return;
    const scene = this.scene;
    const elapsed = Math.max(0, this.ctx.currentTime - this.startTimestamp);
    if (!state.isLooping && elapsed >= scene.duration) {
      this.stopSources();
      state.isPlaying = false;
      this.pauseOffset = 0;
      state.currentTime = 0;
      dom.timelineSlider.value = 0;
      dom.currentTimeLabel.textContent = formatTime(0);
      updateTransportUI();
      this.refreshEngineStatusText();
      drawWaveform();
      return;
    }
    const cycle = Math.floor(elapsed / scene.duration);
    const localTime = elapsed % scene.duration;
    const index = Math.min(scene.chunks.length - 1, Math.floor(localTime * scene.sampleRate / scene.segmentSamples));
    const upcoming = [[cycle, index]];
    if (index + 1 < scene.chunks.length) upcoming.push([cycle, index + 1]);
    else if (state.isLooping) upcoming.push([cycle + 1, 0]);
    for (const [loop, chunkIndex] of upcoming) {
      const scheduledKey = `${loop}:${chunkIndex}`;
      if (this.scheduledChunks.has(scheduledKey)) continue;
      this.loadChunk(scene, chunkIndex).then((buffers) => {
        if (generation !== this.playGeneration || !state.isPlaying || this.scene !== scene || this.scheduledChunks.has(scheduledKey)) return;
        const chunk = scene.chunks[chunkIndex];
        const plannedStart = this.startTimestamp + loop * scene.duration + chunk.startSample / scene.sampleRate;
        const end = plannedStart + chunk.samples / scene.sampleRate;
        const start = Math.max(plannedStart, this.playStartTime, this.ctx.currentTime + 0.005);
        if (start >= end) return;
        const offset = start - plannedStart;
        this.scheduledChunks.add(scheduledKey);
        this.foaBuffers = buffers;
        // All four versions share one context time, offset and duration.
        STREAM_KEYS.forEach((stream) => {
          const source = this.ctx.createBufferSource();
          source.buffer = buffers[stream];
          source.channelInterpretation = "discrete";
          source.connect(this.streamGains[stream]);
          const key = `${scheduledKey}:${stream}`;
          this.sourceNodes[key] = source;
          source.onended = () => {
            source.disconnect();
            delete this.sourceNodes[key];
          };
          source.start(start, offset, end - start);
        });
      }).catch((error) => {
        if (generation === this.playGeneration) this.fail(error);
      });
    }
  }

  stopSources() {
    ++this.playGeneration;
    this.isStarting = false;
    clearInterval(this.schedulerTimer);
    this.schedulerTimer = null;
    Object.values(this.sourceNodes).forEach((source) => {
      try {
        source.onended = null;
        source.stop();
        source.disconnect();
      } catch (_) {}
    });
    this.sourceNodes = {};
    this.scheduledChunks.clear();
  }

  switchABCStream(streamKey) {
    state.activeStream = streamKey;
    if (!this.initialized) return;

    const now = this.ctx.currentTime;
    Object.entries(this.streamGains).forEach(([k, gainNode]) => {
      const target = k === streamKey ? 1.0 : 0.0;
      gainNode.gain.setTargetAtTime(target, now, 0.012);
    });
  }

  setOutputMode(mode) {
    state.outputMode = mode;
    dom.activeDecoderLabel.textContent =
      mode === "binaural"
        ? "DECODER · OMNITONE BINAURAL (HEADPHONES)"
        : "DECODER · VIRTUAL STEREO PAIR (±30° SPEAKERS)";

    if (!this.initialized) return;
    const now = this.ctx.currentTime;
    this.binauralOutputGain.gain.setTargetAtTime(mode === "binaural" ? 1 : 0, now, 0.015);
    this.stereoOutputGain.gain.setTargetAtTime(mode === "stereo" ? 1 : 0, now, 0.015);
    this.refreshEngineStatusText();
  }

  refreshEngineStatusText() {
    if (!this.initialized) {
      dom.engineStatusText.textContent = "STANDBY · WEB AUDIO API";
      return;
    }
    const modeLabel =
      state.outputMode === "binaural"
        ? state.omnitoneReady
          ? "OMNITONE FOA BINAURAL"
          : "WEB AUDIO FOA BINAURAL"
        : "FOA-TO-STEREO DECODER";
    dom.engineStatusText.textContent = `${state.isPlaying ? "PLAYING" : "READY"} · ${modeLabel}`;
  }

  async togglePlay() {
    if (state.isPlaying) {
      this.pauseOffset = this.getCurrentPlaybackTime();
      this.stopSources();
      state.isPlaying = false;
      this.refreshEngineStatusText();
      updateTransportUI();
      return;
    }
    dom.playButton.disabled = true;
    try {
      await this.ensureContext();
      if (!this.scene) {
        const loaded = await this.loadSceneBuffers(PRESET_SCENES[state.currentSceneId]);
        if (!loaded) return;
      }
      await this.startSourcesAt(this.pauseOffset);
    } catch (error) { this.fail(error); }
    finally { dom.playButton.disabled = false; }
  }

  getCurrentPlaybackTime() {
    if (!state.isPlaying || !this.ctx) return this.pauseOffset;
    const elapsed = Math.max(0, this.ctx.currentTime - this.startTimestamp);
    return state.isLooping ? elapsed % state.duration : Math.min(state.duration, elapsed);
  }

  seekTo(seconds) {
    const clamped = Math.max(0, Math.min(state.duration - 1 / 24000, seconds));
    this.pauseOffset = clamped;
    state.currentTime = clamped;
    if (state.isPlaying || this.isStarting) this.startSourcesAt(clamped).catch((error) => this.fail(error));
    dom.currentTimeLabel.textContent = formatTime(clamped);
    drawWaveform();
  }

  setVolume(val) {
    state.volume = val;
    if (this.masterGain && !state.isMuted) {
      this.masterGain.gain.setTargetAtTime(val, this.ctx.currentTime, 0.015);
    }
  }

  setMuted(muted) {
    state.isMuted = muted;
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : state.volume, this.ctx.currentTime, 0.015);
    }
  }

  setLoop(loop) {
    const offset = this.getCurrentPlaybackTime();
    state.isLooping = loop;
    if (state.isPlaying) this.startSourcesAt(offset).catch((error) => this.fail(error));
  }

  getAudioEnergy() {
    if (!this.initialized || !state.isPlaying || !this.analyser) return 0;
    this.analyser.getByteFrequencyData(this.freqData);
    let sum = 0;
    for (let i = 0; i < this.freqData.length; i++) {
      sum += this.freqData[i];
    }
    return sum / (this.freqData.length * 255);
  }
}

const audioEngine = new SpatialAudioEngine();

// ============================================================================
// 5. ARCHITECTURAL 3D HUMAN HEAD & SOUND FIELD VISUALIZER (BLOCK 03)
// ============================================================================
function buildHeadGeometry() {
  // Parametric anatomical KEMAR-inspired acoustic head model
  // Coordinate system: X = Right(+)/Left(-), Y = Up(+)/Down(-), Z = Front(+)/Back(-)
  const slices = [
    { y: -1.12, rx: 0.34, rz: 0.34, zOff: -0.06, jaw: 0.0 }, // Neck base
    { y: -0.92, rx: 0.35, rz: 0.36, zOff: -0.04, jaw: 0.0 }, // Upper neck
    { y: -0.72, rx: 0.42, rz: 0.52, zOff: 0.08, jaw: 0.25 }, // Chin / lower jaw
    { y: -0.52, rx: 0.56, rz: 0.66, zOff: 0.06, jaw: 0.35 }, // Mandible / mouth
    { y: -0.28, rx: 0.66, rz: 0.74, zOff: 0.04, jaw: 0.2, nose: 0.14 }, // Maxilla / nose tip
    { y: -0.04, rx: 0.72, rz: 0.78, zOff: 0.0, jaw: 0.08, nose: 0.18 }, // Cheekbones / nose bridge
    { y: 0.20, rx: 0.74, rz: 0.81, zOff: -0.02, jaw: 0.0, nose: 0.10 }, // Brow ridge / temples
    { y: 0.46, rx: 0.73, rz: 0.80, zOff: -0.04, jaw: 0.0 }, // Forehead
    { y: 0.72, rx: 0.65, rz: 0.72, zOff: -0.05, jaw: 0.0 }, // Upper cranium
    { y: 0.94, rx: 0.46, rz: 0.52, zOff: -0.05, jaw: 0.0 }, // Crown slope
    { y: 1.08, rx: 0.18, rz: 0.20, zOff: -0.05, jaw: 0.0 }, // Apex
  ];

  const radialSegments = 28;
  const rings = slices.map((s) => {
    const pts = [];
    for (let i = 0; i < radialSegments; i++) {
      const a = (i / radialSegments) * Math.PI * 2; // a = 0 is Front (+Z), a = PI/2 is Right (+X)
      const sinA = Math.sin(a);
      const cosA = Math.cos(a);

      // Taper front jaw for realistic facial profile
      const frontFactor = Math.max(0, cosA);
      const jawTaper = 1 - s.jaw * Math.pow(frontFactor, 1.6) * Math.abs(sinA);
      let x = sinA * s.rx * jawTaper;
      let z = cosA * s.rz + s.zOff;

      // Subtle nose bridge protrusion along front midline (cosA > 0.85)
      if (s.nose && cosA > 0.85) {
        const noseShape = Math.pow((cosA - 0.85) / 0.15, 1.5);
        z += s.nose * noseShape;
      }

      pts.push({ x, y: s.y, z });
    }
    return pts;
  });

  // Build quad faces for smooth depth-sorted matte shading
  const faces = [];
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < radialSegments; i++) {
      const next = (i + 1) % radialSegments;
      faces.push({
        verts: [rings[r][i], rings[r][next], rings[r + 1][next], rings[r + 1][i]],
        ringIdx: r,
        segIdx: i,
      });
    }
  }

  // Build sculpted Left & Right Pinnae (Ears) for clear lateral reference
  const earLoops = [-1, 1].map((side) => {
    const earPts = [];
    const steps = 16;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      earPts.push({
        x: side * (0.74 + Math.sin(t) * 0.04),
        y: -0.05 + Math.cos(t) * 0.22,
        z: -0.06 + Math.sin(t) * 0.12,
      });
    }
    return earPts;
  });

  return { rings, faces, earLoops, radialSegments };
}

const headMesh = buildHeadGeometry();

function rotatePoint3D(pt, yawRad, pitchRad, viewTiltRad) {
  const yaw = -yawRad;
  let x1 = pt.x;
  let y1 = pt.y * Math.cos(pitchRad) - pt.z * Math.sin(pitchRad);
  let z1 = pt.y * Math.sin(pitchRad) + pt.z * Math.cos(pitchRad);

  let x2 = x1 * Math.cos(yaw) + z1 * Math.sin(yaw);
  let y2 = y1;
  let z2 = -x1 * Math.sin(yaw) + z1 * Math.cos(yaw);

  let x3 = x2;
  let y3 = y2 * Math.cos(viewTiltRad) - z2 * Math.sin(viewTiltRad);
  let z3 = y2 * Math.sin(viewTiltRad) + z2 * Math.cos(viewTiltRad);

  return { x: x3, y: y3, z: z3 };
}

function rotateWorldPoint(pt, viewTiltRad) {
  return {
    x: pt.x,
    y: pt.y * Math.cos(viewTiltRad) - pt.z * Math.sin(viewTiltRad),
    z: pt.y * Math.sin(viewTiltRad) + pt.z * Math.cos(viewTiltRad),
  };
}

function projectPoint(pt3d, cx, cy, scale) {
  const fov = 4.6;
  const persp = fov / (fov - pt3d.z * 0.55);
  return {
    x: cx + pt3d.x * scale * persp,
    y: cy - pt3d.y * scale * persp,
    z: pt3d.z,
    persp,
  };
}

function renderSpatialScene() {
  const canvas = dom.spatialCanvas;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const targetW = Math.round(rect.width * dpr);
  const targetH = Math.round(rect.height * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }

  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const cx = w * 0.5;
  const cy = h * 0.5;
  const scale = Math.min(w, h) * 0.255;

  // Smooth interpolation toward target angles
  state.theta += (state.targetTheta - state.theta) * 0.28;
  state.phi += (state.targetPhi - state.phi) * 0.28;

  const yawRad = (state.theta * Math.PI) / 180;
  const pitchRad = (state.phi * Math.PI) / 180;
  const viewTiltRad = (21 * Math.PI) / 180;

  // Clear with MUJI paper tone (#F7F6F2)
  ctx.fillStyle = "#F7F6F2";
  ctx.fillRect(0, 0, w, h);

  // Ultra-fine center reference hairlines
  ctx.strokeStyle = "#ECE9E0";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, cy);
  ctx.lineTo(w, cy);
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, h);
  ctx.stroke();

  const ringRadius = 1.62;
  const ringSteps = 120;

  // --------------------------------------------------------------------------
  // A. Subtle 3D Spherical Sound Field Armature (Meridians & Latitude Rings)
  // --------------------------------------------------------------------------
  ctx.strokeStyle = "#E6E3DA";
  ctx.lineWidth = 0.75;
  [0, Math.PI * 0.5].forEach((meridianYaw) => {
    ctx.beginPath();
    for (let i = 0; i <= 96; i++) {
      const t = (i / 96) * Math.PI * 2;
      const rSphere = 1.36;
      const wp = rotateWorldPoint(
        {
          x: Math.sin(t) * Math.sin(meridianYaw) * rSphere,
          y: Math.cos(t) * rSphere * 0.88,
          z: Math.sin(t) * Math.cos(meridianYaw) * rSphere,
        },
        viewTiltRad
      );
      const p = projectPoint(wp, cx, cy, scale);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  });

  // --------------------------------------------------------------------------
  // B. Outer 360° Azimuth Ring (World Reference Frame)
  // --------------------------------------------------------------------------
  ctx.strokeStyle = "#CECAC0";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= ringSteps; i++) {
    const a = (i / ringSteps) * Math.PI * 2;
    const wp = rotateWorldPoint(
      { x: Math.sin(a) * ringRadius, y: 0, z: Math.cos(a) * ringRadius },
      viewTiltRad
    );
    const p = projectPoint(wp, cx, cy, scale);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();

  // Fine degree ticks around the 360° ring
  for (let deg = 0; deg < 360; deg += 5) {
    const rad = (deg * Math.PI) / 180;
    const isMajor = deg % 45 === 0;
    const isMid = deg % 15 === 0;
    const innerR = isMajor ? ringRadius - 0.1 : isMid ? ringRadius - 0.06 : ringRadius - 0.03;

    const p1 = projectPoint(
      rotateWorldPoint({ x: Math.sin(rad) * innerR, y: 0, z: Math.cos(rad) * innerR }, viewTiltRad),
      cx,
      cy,
      scale
    );
    const p2 = projectPoint(
      rotateWorldPoint(
        { x: Math.sin(rad) * ringRadius, y: 0, z: Math.cos(rad) * ringRadius },
        viewTiltRad
      ),
      cx,
      cy,
      scale
    );

    ctx.strokeStyle = isMajor ? "#333333" : "#C5C1B6";
    ctx.lineWidth = isMajor ? 1 : 0.65;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  // Quiet Cardinal Direction Labels on the 360° Ring
  const cardinals = [
    { deg: 0, label: "0° Front" },
    { deg: 90, label: "−90° Right" },
    { deg: 180, label: "180° Rear" },
    { deg: 270, label: "+90° Left" },
  ];
  ctx.font = '300 10.5px "IBM Plex Mono", monospace';
  ctx.fillStyle = "#7A776F";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  cardinals.forEach(({ deg, label }) => {
    const rad = (deg * Math.PI) / 180;
    const labelR = ringRadius + 0.23;
    const wp = rotateWorldPoint(
      { x: Math.sin(rad) * labelR, y: 0, z: Math.cos(rad) * labelR },
      viewTiltRad
    );
    const p = projectPoint(wp, cx, cy, scale);
    ctx.fillText(label, p.x, p.y);
  });

  // --------------------------------------------------------------------------
  // C. Acoustic Sound Field Directivity Envelope (Fine Charcoal Hairlines)
  // --------------------------------------------------------------------------
  const energy = audioEngine.getAudioEnergy();
  for (let l = 0; l < 2; l++) {
    const baseR = 1.14 + l * 0.16;
    ctx.strokeStyle = l === 0 ? "rgba(51, 51, 51, 0.22)" : "rgba(51, 51, 51, 0.11)";
    ctx.lineWidth = 0.85;
    ctx.setLineDash(l === 1 ? [2, 4] : []);
    ctx.beginPath();
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const lobe =
        1 +
        (0.06 + energy * 0.24) *
          (Math.cos(a - yawRad) * 0.65 + Math.cos(2 * (a - yawRad)) * 0.35);
      const r = baseR * lobe;
      const wp = rotateWorldPoint(
        {
          x: Math.sin(a) * r,
          y: Math.sin(pitchRad) * Math.cos(a - yawRad) * 0.2,
          z: Math.cos(a) * r,
        },
        viewTiltRad
      );
      const p = projectPoint(wp, cx, cy, scale);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // --------------------------------------------------------------------------
  // D. Azimuth Sweep Arc (from Front 0° to Current Head Gaze -theta, in #333333)
  // --------------------------------------------------------------------------
  if (Math.abs(state.theta) > 0.5) {
    const arcR = ringRadius - 0.16;
    const steps = 32;
    ctx.strokeStyle = "#333333";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const a = (-yawRad * i) / steps;
      const wp = rotateWorldPoint(
        { x: Math.sin(a) * arcR, y: 0, z: Math.cos(a) * arcR },
        viewTiltRad
      );
      const p = projectPoint(wp, cx, cy, scale);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  // --------------------------------------------------------------------------
  // E. 3D Sculpted Listener Head (Porcelain-Paper Matte + Fine Line Contours)
  // --------------------------------------------------------------------------
  const projectedFaces = headMesh.faces.map((face) => {
    const rVerts = face.verts.map((v) => rotatePoint3D(v, yawRad, pitchRad, viewTiltRad));
    const pVerts = rVerts.map((rv) => projectPoint(rv, cx, cy, scale));

    const u = {
      x: rVerts[1].x - rVerts[0].x,
      y: rVerts[1].y - rVerts[0].y,
      z: rVerts[1].z - rVerts[0].z,
    };
    const v = {
      x: rVerts[3].x - rVerts[0].x,
      y: rVerts[3].y - rVerts[0].y,
      z: rVerts[3].z - rVerts[0].z,
    };
    const nx = u.y * v.z - u.z * v.y;
    const ny = u.z * v.x - u.x * v.z;
    const nz = u.x * v.y - u.y * v.x;
    const len = Math.hypot(nx, ny, nz) || 1;

    const avgZ = (rVerts[0].z + rVerts[1].z + rVerts[2].z + rVerts[3].z) * 0.25;
    const light = (nx * -0.3 + ny * 0.55 + nz * 0.78) / len;

    return {
      pVerts,
      avgZ,
      nz: nz / len,
      light,
      ringIdx: face.ringIdx,
      segIdx: face.segIdx,
    };
  });

  projectedFaces.sort((a, b) => a.avgZ - b.avgZ);

  projectedFaces.forEach((f) => {
    const t = Math.max(0, Math.min(1, (f.light + 0.65) / 1.5));
    const r = Math.round(235 + t * 14);
    const g = Math.round(233 + t * 14);
    const b = Math.round(225 + t * 16);

    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.strokeStyle = "rgba(51, 51, 51, 0.12)";
    ctx.lineWidth = 0.5;

    ctx.beginPath();
    ctx.moveTo(f.pVerts[0].x, f.pVerts[0].y);
    ctx.lineTo(f.pVerts[1].x, f.pVerts[1].y);
    ctx.lineTo(f.pVerts[2].x, f.pVerts[2].y);
    ctx.lineTo(f.pVerts[3].x, f.pVerts[3].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  });

  // Draw Left & Right Pinnae (Ears) contours
  ctx.strokeStyle = "rgba(51, 51, 51, 0.7)";
  ctx.lineWidth = 0.95;
  headMesh.earLoops.forEach((earPts) => {
    ctx.beginPath();
    earPts.forEach((pt, idx) => {
      const rp = rotatePoint3D(pt, yawRad, pitchRad, viewTiltRad);
      const pp = projectPoint(rp, cx, cy, scale);
      if (idx === 0) ctx.moveTo(pp.x, pp.y);
      else ctx.lineTo(pp.x, pp.y);
    });
    ctx.stroke();
  });

  // Draw Sagittal & Coronal Head Meridian Lines
  ctx.strokeStyle = "rgba(51, 51, 51, 0.36)";
  ctx.lineWidth = 0.8;
  [0, 7, 14, 21].forEach((segIndex) => {
    ctx.beginPath();
    headMesh.rings.forEach((ring, rIdx) => {
      const rp = rotatePoint3D(ring[segIndex], yawRad, pitchRad, viewTiltRad);
      const pp = projectPoint(rp, cx, cy, scale);
      if (rIdx === 0) ctx.moveTo(pp.x, pp.y);
      else ctx.lineTo(pp.x, pp.y);
    });
    ctx.stroke();
  });

  // --------------------------------------------------------------------------
  // F. Listening Axis Vector & Minimalist Target Dot on 360° Ring
  // --------------------------------------------------------------------------
  const noseOrigin = projectPoint(
    rotatePoint3D({ x: 0, y: 0.02, z: 0.92 }, yawRad, pitchRad, viewTiltRad),
    cx,
    cy,
    scale
  );
  const gazeTarget = projectPoint(
    rotatePoint3D({ x: 0, y: 0, z: ringRadius }, yawRad, pitchRad, viewTiltRad),
    cx,
    cy,
    scale
  );

  ctx.strokeStyle = "#333333";
  ctx.lineWidth = 1.15;
  ctx.beginPath();
  ctx.moveTo(noseOrigin.x, noseOrigin.y);
  ctx.lineTo(gazeTarget.x, gazeTarget.y);
  ctx.stroke();

  ctx.fillStyle = "#333333";
  ctx.beginPath();
  ctx.arc(gazeTarget.x, gazeTarget.y, 3.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#F7F6F2";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(gazeTarget.x, gazeTarget.y, 1.6, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

// ============================================================================
// 6. WAVEFORM SCRUBBER RENDERER (BLOCK 04)
// ============================================================================
state.waveformPeaks = PRESET_SCENES.sound_event.peaks;

function drawWaveform() {
  const canvas = dom.waveformCanvas;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const targetW = Math.round(rect.width * dpr);
  const targetH = Math.round(rect.height * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }

  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  ctx.clearRect(0, 0, w, h);

  const peaks = state.waveformPeaks;
  if (!peaks.length || w <= 0) {
    ctx.restore();
    return;
  }
  const gap = 2;
  // Pool peaks to the available width so bars never run past the canvas.
  const count = Math.min(peaks.length, Math.max(1, Math.floor((w + gap) / (1 + gap))));
  const barW = (w - gap * (count - 1)) / count;
  const progressRatio = Math.max(0, Math.min(1, state.duration > 0 ? state.currentTime / state.duration : 0));
  const playheadX = progressRatio * Math.max(0, w - 1);
  const bars = [];

  for (let i = 0; i < count; i++) {
    const x = i * (barW + gap);
    const first = Math.floor(i * peaks.length / count);
    const last = Math.max(first + 1, Math.floor((i + 1) * peaks.length / count));
    const peak = Math.max(...peaks.slice(first, last));
    const barH = Math.max(2, peak * (h * 0.72));
    const y = (h - barH) * 0.5;
    bars.push({ x, y, height: barH });
    ctx.fillStyle = "#D5D1C7";
    ctx.fillRect(x, y, barW, barH);
  }

  // The played color and pointer share the exact same boundary, even mid-bar.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, playheadX, h);
  ctx.clip();
  ctx.fillStyle = "#333333";
  for (const bar of bars) ctx.fillRect(bar.x, bar.y, barW, bar.height);
  ctx.restore();
  ctx.fillStyle = "#333333";
  ctx.fillRect(playheadX, 0, 1, h);

  ctx.restore();
}

// ============================================================================
// 7. UI HELPERS & INTERACTION BINDINGS
// ============================================================================
function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00.0";
  const mins = Math.floor(sec / 60);
  const rem = (sec % 60).toFixed(1).padStart(4, "0");
  return `${mins}:${rem}`;
}

function setTargetOrientation(thetaDeg, phiDeg) {
  let wrappedTheta = (((thetaDeg + 180) % 360) + 360) % 360 - 180;
  let clampedPhi = Math.max(-85, Math.min(85, phiDeg));

  state.targetTheta = wrappedTheta;
  state.targetPhi = clampedPhi;

  const signT = wrappedTheta > 0.05 ? "+" : "";
  const signP = clampedPhi > 0.05 ? "+" : "";
  dom.thetaValue.textContent = `${signT}${wrappedTheta.toFixed(1)}°`;
  dom.phiValue.textContent = `${signP}${clampedPhi.toFixed(1)}°`;

  audioEngine.updateOrientation(wrappedTheta, clampedPhi);
}

function updateTransportUI() {
  dom.playButton.classList.toggle("is-playing", state.isPlaying);
  dom.playButtonLabel.textContent = state.isPlaying ? "Pause" : "Play";
}

function setupSpatialDragEvents() {
  const canvas = dom.spatialCanvas;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    setTargetOrientation(state.targetTheta - dx * 0.55, state.targetPhi - dy * 0.45);
  });

  const stopDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch (_) {}
  };

  canvas.addEventListener("pointerup", stopDrag);
  canvas.addEventListener("pointercancel", stopDrag);

  canvas.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 15 : 5;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setTargetOrientation(state.targetTheta + step, state.targetPhi);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setTargetOrientation(state.targetTheta - step, state.targetPhi);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setTargetOrientation(state.targetTheta, state.targetPhi + step);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setTargetOrientation(state.targetTheta, state.targetPhi - step);
    }
  });
}

function setupMobileDeviceOrientation() {
  let baselineAlpha = null;

  const handleOrientation = (event) => {
    if (!state.gyroEnabled || event.alpha === null) return;
    if (baselineAlpha === null) baselineAlpha = event.alpha;

    const relAlpha = event.alpha - baselineAlpha;
    const pitch = event.beta ? event.beta - 45 : 0;
    setTargetOrientation(relAlpha, Math.max(-75, Math.min(75, pitch * 0.6)));
  };

  dom.gyroButton.addEventListener("click", async () => {
    if (state.gyroEnabled) {
      state.gyroEnabled = false;
      dom.gyroButton.classList.remove("is-active");
      dom.gyroButton.setAttribute("aria-pressed", "false");
      dom.gyroButton.textContent = "Motion Sensor";
      window.removeEventListener("deviceorientation", handleOrientation);
      return;
    }

    if (
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function"
    ) {
      try {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission !== "granted") {
          alert("Orientation sensor permission is required for motion control.");
          return;
        }
      } catch (err) {
        console.warn("DeviceOrientation permission request failed:", err);
        return;
      }
    }

    baselineAlpha = null;
    state.gyroEnabled = true;
    dom.gyroButton.classList.add("is-active");
    dom.gyroButton.setAttribute("aria-pressed", "true");
    dom.gyroButton.textContent = "Motion Active";
    window.addEventListener("deviceorientation", handleOrientation);
  });
}

function setupSourceBlockEvents() {
  dom.sceneTabs.forEach((tab) => {
    tab.addEventListener("click", async () => {
      const id = tab.dataset.scene;
      const scene = PRESET_SCENES[id];
      if (!scene || id === state.currentSceneId) return;
      const wasPlaying = state.isPlaying;
      state.currentSceneId = id;
      dom.sceneTabs.forEach((button) => {
        const active = button.dataset.scene === id;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-checked", String(active));
        button.querySelector(".scene-tab-dot").style.visibility = active ? "visible" : "hidden";
      });
      try {
        const loaded = await audioEngine.loadSceneBuffers(scene);
        if (loaded && wasPlaying) await audioEngine.startSourcesAt(0);
      } catch (error) {
        if (state.currentSceneId === id) audioEngine.fail(error);
      }
    });
  });
}

function selectABCCard(streamKey) {
  dom.abcCards.forEach((card) => {
    const isMatch = card.dataset.stream === streamKey;
    card.classList.toggle("is-active", isMatch);
    card.setAttribute("aria-checked", isMatch ? "true" : "false");
  });
  audioEngine.switchABCStream(streamKey);
}

function setupBlock03And04Events() {
  dom.resetOrientationButton.addEventListener("click", () => {
    setTargetOrientation(0, 0);
  });

  dom.presetAngleButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = Number(btn.dataset.theta || 0);
      const p = Number(btn.dataset.phi || 0);
      setTargetOrientation(t, p);
    });
  });

  dom.outputModeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.outputMode;
      dom.outputModeButtons.forEach((b) => {
        const active = b.dataset.outputMode === mode;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-checked", active ? "true" : "false");
      });
      audioEngine.setOutputMode(mode);
    });
  });

  dom.abcCards.forEach((card) => {
    card.addEventListener("click", () => {
      selectABCCard(card.dataset.stream);
    });
  });

  // Global keyboard shortcuts (1 / 2 / 3 / 4 or A / B / C / D) for effortless stream comparison
  window.addEventListener("keydown", (e) => {
    if (e.target && ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
    if (e.key === "1" || e.key === "a" || e.key === "A") {
      selectABCCard("original");
    } else if (e.key === "2" || e.key === "b" || e.key === "B") {
      selectABCCard("reconstructed");
    } else if (e.key === "3" || e.key === "c" || e.key === "C") {
      selectABCCard("reconstructed_dac");
    } else if (e.key === "4" || e.key === "d" || e.key === "D") {
      selectABCCard("baseline");
    }
  });

  dom.playButton.addEventListener("click", () => {
    audioEngine.togglePlay();
  });

  dom.timelineSlider.addEventListener("input", () => {
    audioEngine.seekTo(Number(dom.timelineSlider.value));
  });

  dom.loopButton.addEventListener("click", () => {
    const nextLoop = !state.isLooping;
    audioEngine.setLoop(nextLoop);
    dom.loopButton.classList.toggle("is-active", nextLoop);
    dom.loopButton.setAttribute("aria-pressed", String(nextLoop));
  });

  dom.muteButton.addEventListener("click", () => {
    const nextMute = !state.isMuted;
    audioEngine.setMuted(nextMute);
    dom.muteButton.classList.toggle("is-active", nextMute);
  });

  dom.volumeSlider.addEventListener("input", () => {
    const val = Number(dom.volumeSlider.value);
    dom.volumeValueLabel.textContent = `${Math.round(val * 100)}%`;
    audioEngine.setVolume(val);
  });

  // One-click BibTeX copy handler (both header button and bottom citation block button)
  const bibtexEl = document.getElementById("bibtexContent");
  const copyBtns = [
    { btn: document.getElementById("copyBibtexBtn"), labelEl: document.getElementById("copyBibtexBtn") },
    {
      btn: document.getElementById("headerCopyBibtexBtn"),
      labelEl: document.getElementById("headerCopyBibtexLabel"),
    },
  ];

  const copyBibtexToClipboard = async (targetLabelEl, defaultText) => {
    if (!bibtexEl) return;
    const rawBibtex = bibtexEl.textContent.trim();
    try {
      await navigator.clipboard.writeText(rawBibtex);
    } catch (_) {
      const ta = document.createElement("textarea");
      ta.value = rawBibtex;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    if (targetLabelEl) {
      targetLabelEl.textContent = "Copied BibTeX";
      setTimeout(() => {
        targetLabelEl.textContent = defaultText;
      }, 1800);
    }
  };

  copyBtns.forEach(({ btn, labelEl }) => {
    if (!btn) return;
    const defaultText = labelEl ? labelEl.textContent : "Copy BibTeX";
    btn.addEventListener("click", () => copyBibtexToClipboard(labelEl, defaultText));
  });
}

// ============================================================================
// 8. MAIN ANIMATION & TELEMETRY LOOP
// ============================================================================
function tick() {
  if (state.isPlaying) {
    state.currentTime = audioEngine.getCurrentPlaybackTime();
    dom.timelineSlider.value = state.currentTime;
    dom.currentTimeLabel.textContent = formatTime(state.currentTime);
    drawWaveform();
  }

  renderSpatialScene();
  requestAnimationFrame(tick);
}

function init() {
  setupSpatialDragEvents();
  setupMobileDeviceOrientation();
  setupSourceBlockEvents();
  setupBlock03And04Events();

  window.addEventListener("resize", () => {
    drawWaveform();
    renderSpatialScene();
  });

  audioEngine.applySceneMetadata(PRESET_SCENES.sound_event);
  drawWaveform();
  requestAnimationFrame(tick);
}

init();

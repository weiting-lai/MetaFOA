# MetaFOA — Interactive Companion Demo

Interactive First-Order Ambisonics (FOA) listening evaluation demo for the paper:
**An Efficient Parametric Codec for Low-Bitrate First-Order Ambisonics**  
*Wei-Ting Lai, Amy Bastine, Lachlan Birnie, Thushara D. Abhayapala, Prasanga N. Samarasinghe*  
Audio & Acoustic Signal Processing Group, The Australian National University, Canberra, Australia  
arXiv: [https://arxiv.org/abs/2609.33554](https://arxiv.org/abs/2609.33554)

## Unified Studio Console Layout

1. **01 / Audio Scene**
   - **Sound Event**: a complete STARSS23 recording (44.7 s).
   - **Speech**: the complete Open Yap public-sample conversation (1015.28 s), spatialized at ±30°.
   - **Music**: the complete supplied 3D-MARCo quartet excerpt (106.387 s), converted from AMBEO A-format to ambiX.
2. **02 / Listening Mode**
   - Toggle between **Headphones (Binaural)** (Omnitone `FOARenderer`) and **Speakers (Stereo)** (custom Web Audio FOA-to-Stereo virtual speaker decoder).
3. **03 / Interactive 3D Sound Field (Left Panel)**
   - Sculpted 3D human head surrounded by a 360° azimuth ring ($\theta$) and elevation axis ($\phi$).
   - Drag with mouse/touch to rotate the listening direction. On supported phones and tablets, tap **Motion Sensor**, allow sensor access if prompted, and rotate the device. This feature starts only after it is enabled.
4. **04 / Audio Comparison (Right Panel)**
   - Original FOA, two **Proposed MetaFOA** versions, and **Baseline**, via click or keys `1` / `2` / `3` / `4`.
   - Proposed MetaFOA combines **0.75 kbps spatial metadata** with **EnCodec 6 kbps** or **DAC 6 kbps**. All three compressed options are labeled with their nominal **6.75 kbps** total.
   - Four-channel ACN/SN3D audio is delivered in contiguous FLAC chunks. One Web Audio clock synchronizes all four versions; the decoded cache is bounded, so the full speech conversation does not require loading gigabytes first.

Source attribution, transformations, exact sample counts, playback gains and
licenses are documented in [audio/README.md](audio/README.md). The waveform's
played region and progress pointer share one boundary at every screen width.
Dataset credits reuse the existing footer's reference-list styling.

Published at [weiting-lai.github.io/MetaFOA](https://weiting-lai.github.io/MetaFOA/).
For local playback, serve this directory over HTTP (for example
`python -m http.server 8000`) and open `http://localhost:8000/`.

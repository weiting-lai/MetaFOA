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
   - Drag with mouse/touch or enable **Motion Control (Gyro)** (`DeviceOrientationEvent`) to rotate the listening direction in real time.
4. **04 / Audio Comparison (Right Panel)**
   - Original FOA, **MetaFOA + EnCodec**, **MetaFOA + DAC**, and **DirAC + EnCodec**, via click or keys `1` / `2` / `3` / `4`.
   - Both proposed streams and the paper-aligned CBR DirAC baseline use **750 bit/s spatial metadata**; W uses a nominal 6 kbps codec.
   - Four-channel ACN/SN3D audio is delivered in contiguous FLAC chunks. One Web Audio clock synchronizes all four versions; the decoded cache is bounded, so the full speech conversation does not require loading gigabytes first.

Source attribution, transformations, exact sample counts, playback gains,
licenses and the 1,000-clip DirAC paper parity check are documented in
[audio/README.md](audio/README.md). Dataset credits reuse the existing footer's
reference-list styling. The only CSS adjustment is `min-width: 0` on footer
columns so long citations remain within the existing responsive grid.

Published at [weiting-lai.github.io/MetaFOA](https://weiting-lai.github.io/MetaFOA/).
For local playback, serve this directory over HTTP (for example
`python -m http.server 8000`) and open `http://localhost:8000/`.

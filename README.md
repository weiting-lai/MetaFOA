# MetaFOA — Interactive Companion Demo

Interactive First-Order Ambisonics (FOA) listening evaluation demo for the paper:
**An Efficient Parametric Codec for Low-Bitrate First-Order Ambisonics**  
*Wei-Ting Lai, Amy Bastine, Lachlan Birnie, Thushara D. Abhayapala, Prasanga N. Samarasinghe*  
Audio & Acoustic Signal Processing Group, The Australian National University, Canberra, Australia  
arXiv: [https://arxiv.org/abs/2609.33554](https://arxiv.org/abs/2609.33554)

## Unified Studio Console Layout

1. **01 / Audio Scene**
   - Clean category tabs: **Sound Event** (`ACTIVE`), **Speech** (`UPCOMING`), and **Music** (`UPCOMING`).
   - To enable **Speech** or **Music** in the future, remove the `disabled` attribute and `is-upcoming` class on the corresponding `.scene-tab` button in `index.html`, and update `PRESET_SCENES` in `script.js`.
2. **02 / Listening Mode**
   - Toggle between **Headphones (Binaural)** (Omnitone `FOARenderer`) and **Speakers (Stereo)** (custom Web Audio FOA-to-Stereo virtual speaker decoder).
3. **03 / Interactive 3D Sound Field (Left Panel)**
   - Sculpted 3D human head surrounded by a 360° azimuth ring ($\theta$) and elevation axis ($\phi$).
   - Drag with mouse/touch or enable **Motion Control (Gyro)** (`DeviceOrientationEvent`) to rotate the listening direction in real time.
4. **04 / Audio Comparison (Right Panel)**
   - Placed directly alongside the 3D head so listeners can rotate head orientation while instantaneously toggling between **Original FOA**, **MetaFOA** (`PROPOSED · 750 bit/s`), and **Baseline Codec** (`BASELINE · 750 bit/s`) via click or keys `1` / `2` / `3`.

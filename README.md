# MetaFOA listening demo

A static research demo for MetaFOA, published with GitHub Pages.

**Live demo:** <https://weiting-lai.github.io/MetaFOA/>

The two players contain the same six-second scene. The reconstructed stereo
monitor was decoded from a MetaFOA four-channel First-Order Ambisonics (FOA)
output. The original comes from the STARSS23 FOA recording
`fold4_room23_mix005.wav`, seconds 60–66. For browser playback, it is rendered
to stereo using virtual loudspeakers at ±30° from the FOA channels in ACN
order (W, Y, Z, X): `L = 0.707W + 0.612X + 0.354Y` and
`R = 0.707W + 0.612X - 0.354Y`. The stereo render is for convenient listening,
not a replacement for the four-channel spatial signal. Source recording:
<https://zenodo.org/records/7880637>. Dataset copyright and license are in
[`audio/STARSS23-LICENSE.txt`](audio/STARSS23-LICENSE.txt).

This repository currently contains only the demo website and its listening
samples. The manuscript and full research implementation will be released when
the work is ready to share.

Open `index.html` directly or serve the directory with any static HTTP server.

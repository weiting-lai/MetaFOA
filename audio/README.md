# Listening audio: sources, transformations and licenses

The three tabs play complete supplied recordings. Each has four distinct versions:
Original FOA, Proposed MetaFOA with EnCodec, Proposed MetaFOA with DAC, and Baseline.
Each compressed option has a nominal total bitrate of **6.75 kbps**.
All FOA is 24 kHz, ACN/SN3D, ordered **W, Y, Z, X**.

| Scene | Source | Duration | Source credit and terms |
|---|---|---:|---|
| Sound Event | STARSS23 `dev-test-sony/fold4_room23_mix002.wav` | 44.700 s | Politis, Shimada and the Sony/Tampere University team, 2023. [Dataset v1.1.0](https://zenodo.org/records/7880637), [MIT notice](STARSS23-LICENSE.txt). |
| Music | 3D-MARCo Quartet, AMBEO tracks 061–064 | 106.387 s | Hyunkook Lee and Dale Johnson, University of Huddersfield, 2019. Performed by members of the Up North Session Orchestra: Dvořák, String Quartet in G major, Op. 106. [Dataset v1.0.1](https://zenodo.org/records/3477602). |
| Speech | Open Yap 1K public sample `conv_04692967d40e` | 1015.280 s | The Agentic Data Company, 2026, v1.0. [Public sample](https://huggingface.co/datasets/TheAgenticDataCompany/open-yap-1k), [CC BY 4.0 and the speakers' request](licenses/Open-Yap-CC-BY-4.0.txt). |

These credits apply to all original and reconstructed audio derivatives. Rights
remain with the respective creators; audio is not relicensed as original work by
the MetaFOA authors. This is a noncommercial research listening demonstration.

For **3D-MARCo**, the Zenodo record states CC BY 3.0, whereas its accompanying
white paper states CC BY-NC 3.0. Both source statements are disclosed here and on
the page; this demonstration is noncommercial. Consult the linked source and
documentation for reuse. The complete *supplied quartet excerpt* is played; it
is not a recording of an entire symphony or an entire quartet movement.

For **Open Yap**, this recording belongs to the publicly released CC BY 4.0
sample: its anonymous conversation key and duration match the publisher's sample
metadata. The full 1,000-hour corpus has a different data use agreement. We use
the public sample license. The publisher asks users not to identify speakers or
create identifiable voice clones; the full request travels with the license file.

## Transformations

- Music: merge the four raw 96 kHz AMBEO capsules in FLU/FRD/BLD/BRU order;
  Sennheiser AMBEO A-B Converter 1.2.3, ambiX, upright, zero rotation, correction
  filter on, high-pass off. Remove its reported 32-sample latency; resample all
  channels together to 24 kHz. These existing complete MetaFOA reconstructions
  are reused without re-encoding.
- Speech: reuse the existing free-field FOA derived from the two source tracks
  on their original shared timeline. Speakers are at -30°/+30°, elevation 0°,
  distance 0.6 m. The common propagation delay is retained. This is a synthetic
  spatialization of conversational audio, not a native spatial recording.
  Existing independent 20-second MetaFOA/carrier processing boundaries are
  retained for the comparison baseline too.
- Sound Event: use the full, different STARSS23 recording listed above, already
  four-channel 24 kHz FOA. Newly encode MetaFOA spatial metadata at 750 bit/s,
  and separately encode/decode W with the pretrained EnCodec 24 kHz 6 kbps
  model or DAC 24 kHz 0.0.4 model with eight quantizers. Actual serialized
  `.mfoa`, `.ecdc` and `.dac` payloads are retained in the build workspace.
- Both proposed variants use MetaFOA's unchanged 36-band K64 codebooks with the
  first five stages and 40 ms updates. EnCodec uses no entropy language model.
  DAC retains the established eight-sample right shift, applied once per
  independent processing segment.
- A single common playback gain is applied to all four versions within a scene
  before 24-bit export, preventing clipping while preserving level ratios. It
  is 1 for Sound Event/Music and 0.98989903996 for Speech. No version is
  individually loudness-normalized for the listening comparison.

## Comparison baseline and related literature

The **Baseline** option provides a compressed FOA reconstruction at a nominal
total bitrate of **6.75 kbps**. All listening versions use the same source,
timeline and scene-wide playback gain. The paper provides the experimental
methodology and quantitative comparisons in Table 1 and Figure 2.

Related reference: G. Fuchs, F. Ghido, D. Weckbecker and O. Thiergart,
“A first-order DirAC-based parametric ambisonic coder for immersive
communications,” ICASSP 2025, pp. 12937–12941. EnCodec and DAC retain their
respective upstream authorship and licenses:
[EnCodec](https://github.com/facebookresearch/encodec),
[DAC](https://github.com/descriptinc/descript-audio-codec).

## Web delivery and verification

The browser plays already decoded FOA; it does not run neural codecs. Delivery
files use four-channel **24-bit PCM in lossless FLAC**, split into contiguous
20-second chunks after reconstruction. The maximum float-to-PCM24 difference is
5.96046448e-8. The split does not crop any recording or reset music/sound-event
codec processing. The final shorter chunk retains every remaining sample.

All four streams are scheduled with identical Web Audio start times, offsets
and durations. The player preloads upcoming chunks, retaining at most three
decoded groups, supports seeking across the full recording and loops the full
scene. Missing or corrupt audio fails visibly instead of substituting another
stream. `scenes.js` contains exact sample counts and paths; [provenance.json](provenance.json)
contains source/output fingerprints, all chunk hashes and processing records.

**750 bit/s is spatial metadata, not the delivery FLAC bitrate.** The W codec's
6 kbps is its nominal setting. Finite-clip headers and DAC's default valid-
convolution window context add storage overhead, as recorded in the original
compression manifests. FLAC copies on this site are for faithful audition.

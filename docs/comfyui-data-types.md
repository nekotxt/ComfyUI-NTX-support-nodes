# ComfyUI Data Types: MODEL, CLIP, VAE, IMAGE, LATENT, CONDITIONING

How ComfyUI represents the main data types that flow between nodes.
Verified against the ComfyUI source (`comfy/model_patcher.py`, `comfy/model_base.py`, `comfy/sd.py`, `node_helpers.py`).

Two broad families exist:

- **Tensor types** (`IMAGE`, `LATENT`, `CONDITIONING`) — plain data: a `torch.Tensor`, or a dict/list structure of tensors. Nodes freely create, read, and modify them.
- **Model object types** (`MODEL`, `CLIP`, `VAE`) — rich Python objects wrapping neural networks plus device/patching machinery. Nodes normally treat them as opaque handles: call their methods, `clone()` before modifying, and pass them along.

---

## IMAGE

A single `torch.Tensor` — not a dict, not a PIL image.

| Property | Value |
|---|---|
| Shape | `[B, H, W, C]` |
| dtype | `float32` |
| Value range | `0.0` – `1.0` |
| Channels | `C = 3` (RGB); some loaders may produce 4 (RGBA) |

- **B** — batch size. Even a single image is a batch of 1, so shape is always 4-D.
- **H, W** — height and width in pixels.
- **C** — channel-*last* layout (unlike PyTorch's usual `[B, C, H, W]`). Remember to `permute` before using `torch.nn.functional` image ops.

```python
b, h, w, c = image.shape
single = image[0]                 # [H, W, C] — one image from the batch
batch  = torch.cat([a, b], dim=0) # concatenate batches (H/W/C must match)
```

Conversion to/from PIL goes through `numpy` with a `/ 255.0` or `* 255.0` scale.

Related: `MASK` is the same idea without channels — `[H, W]` or `[B, H, W]`, float 0–1.

---

## LATENT

A **dictionary** of tensors. Only one key is guaranteed; the others are optional and must be preserved when you modify a latent (use `latent.copy()`, then replace keys).

| Key | Type | Required | Meaning |
|---|---|---|---|
| `samples` | `torch.Tensor [B, C, H, W]` | yes | The latent tensor itself (channel-*first*, unlike IMAGE) |
| `noise_mask` | `torch.Tensor` | no | Inpainting mask; sampler only denoises where the mask allows |
| `batch_index` | `list[int]` | no | Original batch indices, used to keep per-image noise seeds stable after batch operations (e.g. `LatentFromBatch`) |
| `type` | `str` | no | Marks non-image latent domains, e.g. `"audio"`, `"hunyuan3dv2"`; absent for normal image latents |
| `downscale_ratio_spacial` / `downscale_ratio_temporal` | `int` | no | Declared by empty-latent nodes: the geometry the latent was built for. Sampler nodes pass these to `comfy.sample.fix_empty_latent_channels`, which auto-corrects channel count and rescales an *empty* latent if it doesn't match the model's `latent_format`; the keys are stripped from the sampler's output |

About `samples`:

- Spatial dims are the pixel dims divided by the VAE's downscale ratio — **8** for most image models (a 1024×1024 image is a 128×128 latent). Video/cascade VAEs use other ratios (16, 32, plus a temporal factor).
- Channel count depends on the model family: **4** for SD1.5/SD2/SDXL, **16** for SD3/Flux, more for video models. Video latents add a temporal dim: `[B, C, T, H, W]`.
- Values are unbounded floats (roughly zero-centered), *not* 0–1.

```python
result = latent.copy()                    # keep noise_mask / batch_index / type
result["samples"] = latent["samples"] * 0.5
return io.NodeOutput(result)
```

An "empty latent" is just a zero tensor of the right shape wrapped in the dict — but the "right shape" depends on the model (see the per-model table below), so channel count and scale factors should not be hardcoded. Even ComfyUI's core `EmptyLatentImage` node hardcodes `torch.zeros([b, 4, h // 8, w // 8])`, which is only correct for SD1.5/SDXL — that is why every newer family ships its own node (`EmptySD3LatentImage`, `EmptyHunyuanLatentVideo`, `EmptyLTXVLatentVideo`, …).

To build one generically, a node needs extra information the width/height widgets alone don't provide, from either of two sources:

- **From a `MODEL` input** — the latent format descriptor: `model.get_model_object("latent_format")`, which has `latent_channels`, `latent_dimensions` (2 = image, 3 = video), and on newer formats `spacial_downscale_ratio` / `temporal_downscale_ratio` (default 8 / none when absent).
- **From a `VAE` input** — the same geometry as live attributes/methods: `vae.latent_channels`, `vae.latent_dim`, `vae.spacial_compression_encode()`, `vae.temporal_compression_decode()`.

```python
import comfy.model_management

# Generic empty latent, given a MODEL input
lf = model.get_model_object("latent_format")
c  = lf.latent_channels
ds = getattr(lf, "spacial_downscale_ratio", 8)
width, height = max(ds, (width // ds) * ds), max(ds, (height // ds) * ds)
device, dtype = comfy.model_management.intermediate_device(), comfy.model_management.intermediate_dtype()
if lf.latent_dimensions == 3:   # video model: [B, C, T, H, W]
    dt = getattr(lf, "temporal_downscale_ratio", 4)
    t = (frames - 1) // dt + 1
    samples = torch.zeros([b, c, t, height // ds, width // ds], device=device, dtype=dtype)
    return io.NodeOutput({"samples": samples, "downscale_ratio_spacial": ds, "downscale_ratio_temporal": dt})
else:                            # image model: [B, C, H, W]
    samples = torch.zeros([b, c, height // ds, width // ds], device=device, dtype=dtype)
    return io.NodeOutput({"samples": samples, "downscale_ratio_spacial": ds})
```

```python
import comfy.model_management

# Generic empty latent, given a VAE input
c  = vae.latent_channels
ds = vae.spacial_compression_encode()    # 8, 16, 32, ... (unwraps per-axis tuples)
dt = vae.temporal_compression_decode()   # temporal ratio for video VAEs, None for image VAEs
width, height = max(ds, (width // ds) * ds), max(ds, (height // ds) * ds)
device, dtype = comfy.model_management.intermediate_device(), comfy.model_management.intermediate_dtype()
if dt is not None:               # video VAE: [B, C, T, H, W]
    t = (frames - 1) // dt + 1
    samples = torch.zeros([b, c, t, height // ds, width // ds], device=device, dtype=dtype)
    return io.NodeOutput({"samples": samples, "downscale_ratio_spacial": ds, "downscale_ratio_temporal": dt})
else:                            # image VAE: [B, C, H, W]
    samples = torch.zeros([b, c, height // ds, width // ds], device=device, dtype=dtype)
    return io.NodeOutput({"samples": samples, "downscale_ratio_spacial": ds})
```

Three details in these examples matter beyond the shape itself:

- **Device/dtype** come from `comfy.model_management.intermediate_device()` / `intermediate_dtype()` — the same policy core nodes use (CPU float32 by default, respecting `--gpu-only` / `--fp16-intermediates`). Do *not* allocate on the VAE's device or in its half-precision compute dtype.
- **Dimension snapping** uses the actual ratio, not a hardcoded 8 — a ÷16 or ÷32 model needs width/height snapped to multiples of 16/32.
- **The `downscale_ratio_*` keys** declare what geometry the latent was built for. Sampler nodes feed them to `comfy.sample.fix_empty_latent_channels`, which — for *empty* (all-zero) latents only — repairs the channel count and rescales spatially/temporally if the latent turns out not to match the model it reaches. Declaring them makes an empty latent robust even when the user wires it to an unexpected model family.

The VAE route is preferable when the node also encodes or decodes (the geometry is then guaranteed consistent with the VAE actually used), while the MODEL route additionally distinguishes image vs. video via `latent_dimensions` even when the temporal ratio is absent. Note the VAE object has no `latent_format` — the format class with its normalization constants lives on the MODEL side (`BaseModel.latent_format`); the VAE only carries the geometry.

Without a MODEL or VAE input there is no reliable way to know the target geometry — a width/height-only node can only assume one family, exactly like `EmptyLatentImage` does.

**Why no normalization here?** Nodes never apply the per-model normalization — LATENT on wires is always raw VAE space. The sampler applies `latent_format.process_in()` when the latent enters the diffusion model and `process_out()` on the way back (`CFGGuider.inner_sample` in `comfy/samplers.py`, via `BaseModel.process_latent_in/out`). It also explicitly *skips* `process_in` for all-zero latents ("Don't shift the empty latent image") so that shift-style normalizations (Flux, Wan) don't turn an empty latent into a non-zero bias — zeros stay zeros, meaning "start from pure noise".

### Per-model latent formats

Each architecture defines a `LatentFormat` subclass (`comfy/latent_formats.py`) that fixes the channel count, the pixel↔latent scale, and a normalization applied when the latent enters/leaves the diffusion model. The values below are taken from those classes:

| Model | Channels | Spatial ÷ | Temporal ÷ | `samples` shape | Normalization (`process_in`) |
|---|---|---|---|---|---|
| SD 1.5 | 4 | 8 | — | `[B, 4, H/8, W/8]` | `× 0.18215` |
| SDXL | 4 | 8 | — | `[B, 4, H/8, W/8]` | `× 0.13025` |
| Flux 1 | 16 | 8 | — | `[B, 16, H/8, W/8]` | `(x − 0.1159) × 0.3611` |
| Flux 2 | 128 | 16 | — | `[B, 128, H/16, W/16]` | none (identity) |
| Flux 2 Klein | 128 | 16 | — | same as Flux 2 | none (identity) |
| Z-Image (base & turbo) | 16 | 8 | — | `[B, 16, H/8, W/8]` | same as Flux 1 |
| Krea 2 (K2) | 16 | 8 | — | Wan-style, video layout | per-channel mean/std |
| Wan 2.1 (and Wan 2.2 14B) | 16 | 8 | 4 | `[B, 16, T, H/8, W/8]` | per-channel mean/std |
| Wan 2.2 (5B TI2V) | 48 | 16 | 4 | `[B, 48, T, H/16, W/16]` | per-channel mean/std |
| LTX Video | 128 | 32 | 8 | `[B, 128, T, H/32, W/32]` | per-channel mean/std |

Notes:

- **SD 1.5 vs SDXL** — identical shape, but the VAEs (and scale factors: 0.18215 vs 0.13025) differ, so their latents are *not* interchangeable; decoding one with the other's VAE produces garbage colors.
- **Flux 1** — first mainstream 16-channel VAE; normalization is shift-then-scale rather than a plain multiply. SD3 uses the same 16-channel layout with different constants.
- **Flux 2 / Klein** — the 128 channels at ÷16 are really the 32-channel ÷8 VAE output pixel-shuffled 2×2 into depth (ComfyUI's preview decoder reshapes `128 → 32 × 2 × 2`). No scale/shift is applied. **Klein** (the small Apache-licensed variant) is the same `Flux2` model class and latent format in ComfyUI — it differs only in the diffusion model size and text encoder (Qwen3-4B/8B instead of Mistral-24B), so Flux 2 and Klein latents are fully compatible.
- **Z-Image base & turbo** — a Lumina2-architecture model that adopts the *Flux 1* latent format wholesale (16 ch, ÷8, same shift/scale constants), so it lives in a Flux-compatible latent space. Base and Turbo share it. (A separate "Z-Image pixel-space" DCT variant skips the VAE entirely: 3 channels, ÷1 — the "latent" is raw RGB.)
- **Krea 2** — an image model that borrows the **Wan 2.1 video VAE** and latent format: 16 channels, normalized per-channel with the Wan mean/std tensors, latents in the 5-D video layout (single frame for still images).
- **Wan** — video latents are 5-D: `T = 1 + (frames − 1) / 4` (first frame not temporally compressed). Note the split within Wan 2.2: the 14B T2V/I2V models reuse the Wan **2.1** VAE (16 ch, ÷8), while only the 5B TI2V model uses the new 48-channel ÷16 VAE.
- **LTX Video** — the most aggressive compression here: ÷32 spatial and ÷8 temporal, compensated by 128 channels; also 5-D video layout with per-channel normalization.

Practical consequences for nodes: never assume `C == 4` or 4-D `samples` (video models are 5-D); compute latent sizes from the VAE's `downscale_ratio` rather than hardcoding 8; and only mix latents between models documented to share a space (Flux 1 ↔ Z-Image, Flux 2 ↔ Klein, Wan 2.1 ↔ Wan 2.2 14B ↔ Krea 2). The normalization column is applied *inside* the model wrapper at sampling time — the LATENT dict on node wires always carries raw VAE-space values.

---

## MODEL

A `comfy.model_patcher.ModelPatcher` instance — a wrapper that manages **patches** (LoRAs, model tweaks) and **device placement** for the diffusion model, without mutating the underlying weights until sampling time.

Composition (main attributes):

| Attribute | What it is |
|---|---|
| `model` | A `comfy.model_base.BaseModel` (see below) — the actual model wrapper |
| `patches` | `dict[weight_key → list of patches]` — pending weight deltas (LoRA etc.); applied lazily when the model is loaded for sampling, backed up in `backup` so they can be undone |
| `object_patches` | Replacements for whole sub-objects of the model (e.g. swap the attention implementation) |
| `model_options` | `dict` with `"transformer_options"` — runtime sampling options: attention patches/wrappers, CFG function overrides, callbacks |
| `load_device` / `offload_device` | Where the model runs (GPU) vs. where it parks (CPU) — VRAM management |
| `hook_patches`, `wrappers`, `callbacks`, `attachments`, `additional_models` | Hook/wrapper machinery used by advanced features (scheduled LoRAs, ControlNet-style attachments) |

The inner `BaseModel` (`patcher.model`) holds:

- `diffusion_model` — the real `torch.nn.Module` (the UNet or DiT).
- `model_config` — architecture config detected from the checkpoint.
- `model_sampling` — the sampling parameterization (eps / v-prediction / flow), sigma schedule math.
- `latent_format` — how to scale/shift latents for this architecture (this is what defines the 4- vs 16-channel latents above).

**Key convention:** `ModelPatcher.clone()` is cheap — it shares the underlying weights and copies only the patch lists. Every node that "modifies" a MODEL (LoRA loaders, samplers settings, etc.) does `m = model.clone()`, adds patches or options to the clone, and returns it. Never mutate the input MODEL in place — other branches of the graph share it.

```python
m = model.clone()
m.add_patches(lora_patches, strength)         # queue weight deltas
m.model_options["transformer_options"][...]   # per-sampling options
return io.NodeOutput(m)
```

---

## CLIP

A `comfy.sd.CLIP` instance — the text-encoding stack: tokenizer + text encoder model(s) + its own patcher. Despite the name it may wrap any text encoder combo (CLIP-L, CLIP-G, T5, llama-based, etc., possibly several at once).

Composition:

| Attribute | What it is |
|---|---|
| `cond_stage_model` | The text encoder `torch.nn.Module` (or a multi-encoder wrapper for SDXL/SD3/Flux) |
| `tokenizer` | Matching tokenizer; understands prompt weighting syntax and embeddings |
| `patcher` | A `ModelPatcher` around `cond_stage_model` — so LoRAs that target the text encoder patch it the same way as MODEL |
| `layer_idx` | Which layer to stop at (the "CLIP skip" setting, set by `clip_layer()` / `CLIPSetLastLayer`) |
| `tokenizer_options` | Extra options forwarded to tokenization |
| `use_clip_schedule`, `apply_hooks_to_conds` | Hook support for scheduled/keyframed prompt encoding |

Typical usage — the two-step encode:

```python
tokens = clip.tokenize("a photo of a cat")
conditioning = clip.encode_from_tokens_scheduled(tokens)
# → CONDITIONING: list[[cond_tensor, {"pooled_output": tensor, ...}]]
```

Like MODEL, it follows the clone-then-modify convention: `clip.clone()` shares the encoder weights and copies the patch state.

---

## CONDITIONING

A **list of pairs** — plain data, no wrapper class:

```python
conditioning = [
    [cond_tensor, options_dict],   # entry 0
    [cond_tensor, options_dict],   # entry 1 (optional — most conds have 1 entry)
    ...
]
```

Each entry is `[torch.Tensor, dict]`:

**1. The cond tensor** — the text-encoder output fed to the model's cross-attention:

| Property | Value |
|---|---|
| Shape | `[B, T, D]` — batch, token count, embedding dim |
| Typical D | 768 (SD1.5), 2048 (SDXL, CLIP-L+G concat), 4096 (SD3/Flux with T5) |

Token length `T` varies per prompt; the sampler pads/aligns entries when batching (`comfy.conds.CONDCrossAttn`).

**2. The options dict** — everything else the sampler needs, all keys optional:

| Key | Type | Meaning |
|---|---|---|
| `pooled_output` | `torch.Tensor [B, D]` | Pooled text embedding; required by SDXL/SD3/Flux-style models, present on virtually every entry |
| `control` | `ControlNet` | Attached ControlNet (set by `ControlNetApply`); chains via its own `previous_controlnet` |
| `area` | `tuple` | Restrict this entry to a spatial region (`ConditioningSetArea`); in latent coords |
| `mask` / `set_area_to_bounds` / `mask_strength` | `Tensor` / `bool` / `float` | Restrict by mask instead of rectangle (`ConditioningSetMask`) |
| `strength` | `float` | Weight of this entry (default 1.0) |
| `start_percent` / `end_percent` | `float` 0–1 | Timestep range where this entry is active (`ConditioningSetTimestepRange`) |
| `guidance` | `float` | Guidance value embedded into Flux-style models (`FluxGuidance`) |
| `concat_latent_image` / `concat_mask` | `Tensor` | Latents concatenated to model input (inpaint / instruct-pix2pix style) |
| `hooks` | `HookGroup` | Scheduled hook patches (advanced LoRA scheduling) |

Plus further model-specific keys (SVD motion params, WAN keys, style-model attention, …). Rule: **preserve keys you don't understand.**

Conventions:

- Multiple entries in one CONDITIONING are all applied by the sampler — each with its own area/mask/timestep window. This is how `ConditioningCombine` works: it is literally list concatenation, `cond_a + cond_b`.
- To modify, copy each entry's dict rather than mutating it. The canonical helper is `node_helpers.conditioning_set_values`:

```python
import node_helpers

# Set a key on every entry (copies each dict — inputs stay untouched)
c = node_helpers.conditioning_set_values(conditioning, {"guidance": 3.5})

# By hand, same effect:
c = [[t[0], {**t[1], "guidance": 3.5}] for t in conditioning]
```

---

## VAE

A `comfy.sd.VAE` instance — the encoder/decoder between pixel space (IMAGE) and latent space (LATENT), plus metadata describing the geometry of that mapping. The class auto-detects the architecture from the checkpoint's state dict (SD-KL, TAESD, Stable Cascade stages, video VAEs, audio VAEs, …).

Composition:

| Attribute | What it is |
|---|---|
| `first_stage_model` | The actual autoencoder `torch.nn.Module` |
| `latent_channels` | Latent channel count (4, 16, …) — determines `C` in LATENT `samples` |
| `downscale_ratio` / `upscale_ratio` | Pixel↔latent scale factor (usually 8; 16/32 or per-axis tuples for cascade/video VAEs) |
| `latent_dim` | 2 for images, 3 for video (adds the temporal axis) |
| `process_input` / `process_output` | Pixel-range remapping: images 0–1 are mapped to −1…1 before encoding, and back (clamped) after decoding |
| `memory_used_encode` / `memory_used_decode` | VRAM estimators used by the memory manager to pick batch/tile sizes |
| `working_dtypes` | Precisions this VAE supports (e.g. bf16/fp32) |
| `patcher` | A `ModelPatcher` for device management (created after architecture detection) |

The API nodes actually use:

```python
latent_samples = vae.encode(image)   # IMAGE [B,H,W,C] → Tensor [B,C,h,w]
image = vae.decode(latent["samples"])  # Tensor → IMAGE [B,H,W,C]
```

Note the asymmetry with LATENT: `vae.encode`/`decode` work on the raw `samples` tensor — wrapping into / unwrapping from the `{"samples": ...}` dict is the node's job. Both methods fall back to tiled processing on out-of-memory.

---

## Summary

| Type | Python representation | Mutable data or opaque handle? |
|---|---|---|
| IMAGE | `torch.Tensor [B,H,W,C]`, float32, 0–1, channel-last | data — modify freely |
| LATENT | `dict`: required `samples [B,C,H,W]`; optional `noise_mask`, `batch_index`, `type` | data — `copy()` the dict, preserve extra keys |
| MODEL | `ModelPatcher` → `BaseModel` → diffusion `nn.Module`, plus patch lists and device info | handle — `clone()` then add patches/options |
| CLIP | `CLIP`: tokenizer + text encoder(s) + its own `ModelPatcher` + clip-skip state | handle — `tokenize()` / `encode_from_tokens_scheduled()`; `clone()` to modify |
| CONDITIONING | `list` of `[cond_tensor [B,T,D], options_dict]` pairs; dict holds `pooled_output`, `control`, `area`, `mask`, timestep range, … | data — copy each entry's dict, preserve unknown keys; combine = list concat |
| VAE | `VAE`: autoencoder module + latent geometry (channels, scale ratios) + range remapping | handle — `encode()` / `decode()` |

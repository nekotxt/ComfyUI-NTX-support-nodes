# ComfyUI-NTX-support-nodes

A collection of custom nodes for ComfyUI. All nodes are registered with the `NTX` prefix
(e.g. *NTX Pipe Custom*) and appear under the **NTX-support-nodes** category in the node menu.
The right-click menu entries added by the addon carry the same prefix; it is omitted
throughout this document.

Configuration and data files (prompt library, custom pipe templates, `config.json`) are read
from `input/ntx_data/` inside the ComfyUI folder (falling back to the `ntx_data/` folder
bundled with the addon).

Recurring data type:
- **LORA_STACK**: a list of `(lora_name, strength_model, strength_clip)`
  tuples, passed between the LoRA nodes below.
  This is the same data type used by usual lora stacks in other extensions;
- **DICT**: a dictionary of key:value pairs;

---

## Global commands

Addon-wide commands that are not tied to a specific node.

### Load template workflow

Inserts one or more template workflows — picked from a folder of ready-made workflows — into
the current graph. Rather than replacing the open workflow, each template's nodes are **pasted**
into it (at the mouse position) and left selected — when several templates are loaded at once,
the last one's nodes remain selected — so they can be dragged into place immediately; any
nested subgraph definitions the templates use come along with them.

The command is available from three places:

- the **command palette** (and *Settings → Keybinding*, where its shortcut can be rebound), with
  a default keybinding of **Alt+W** — the nodes are dropped where the mouse hovers;
- the **canvas right-click menu** (*Load template workflow*) — the nodes are dropped where the
  menu was opened.

Templates are read from the `ntx/_templates` subfolder of the ComfyUI user **workflows** folder
(`workflows/ntx/_templates`); every `.json` file found there, at any depth, is offered.

Invoking the command opens a **tree picker** organised by subfolder:

- a **filter box** narrows the list to files whose name matches the typed text;
- folders can be expanded/collapsed; a file is chosen by clicking it, and confirmed with the
  **Load** button, a **double-click**, or **Enter**;
- **Ctrl+click** (or Cmd+click) adds/removes files to a **multi-selection** instead. The selected
  templates are inserted in the order they were picked, side by side from left to right (aligned
  to the same top edge, with a small gap between them); when two or more files are selected, each
  row shows a numbered badge with its position in that order, and the **Load** button becomes
  **Load (n)**. To change the order, Ctrl+click an entry off and back on; a plain click collapses
  the selection back to the single clicked file;
- the multi-selection survives filter changes — files picked under one filter term stay selected
  (and counted on the **Load** button) while a different term is typed, so a selection can be
  built across several searches;
- the **Refresh** button re-scans the templates folder on disk (rebuilding the cached list), so
  templates added, renamed or removed there show up without reloading the page; the current
  filter text and selection are kept (entries that no longer exist are dropped);
- **Cancel**, **Escape**, or a click outside the dialog closes it without loading;
- the most recently loaded template is remembered and pre-selected (with its folders expanded)
  the next time the picker is opened.

---

## PipeCustom

![PipeCustom node](images/PipeCustom.png)

A "pipe" node used to bundle many values into a single wire. The pipe itself is a dictionary
(`DICT` type): every connected input is stored in the dictionary under the input's name, and
every output reads the value with the same name back out of the dictionary. The set of custom
inputs and outputs is defined per-node by the user through an editor dialog, and inputs and
outputs are configured **independently** — a node may, for example, only add values to the pipe
(inputs only) or only extract them (outputs only).

### Inputs

| Input | Type | Description |
|---|---|---|
| `pipe` | DICT (optional) | An upstream pipe to extend. If omitted, a new empty pipe is created. The input pipe is cloned, so downstream changes never affect the upstream dictionary. |
| `inputs_data` | STRING (hidden) | JSON produced by the editor dialog describing the configured inputs/outputs (`{"inputs": [...], "outputs": [...]}`). Managed entirely by the frontend; not edited by hand. |
| `strict` | BOOLEAN | When enabled, a warning toast (and log entry) lists every configured output whose name is not found in the pipe — typically a typo between an upstream input and this output. The per-type default is returned either way; execution is not interrupted. Default `false`. |
| *custom inputs* | user-defined | One slot per configured input, with the chosen name and type. Only connected (non-None) values are written into the pipe. |

### Outputs

| Output | Type | Description |
|---|---|---|
| `pipe` | DICT | The merged pipe dictionary (input pipe + values from the connected custom inputs). |
| *custom outputs* | user-defined | One slot per configured output; each returns `pipe[name]`. If the name is not present in the pipe, a per-type default is returned (`0` for INT, `0.0` for FLOAT, `""` for STRING, `False` for BOOLEAN, `[]` for LORA_STACK / CONTROL_NET_STACK / LIST, `{}` for DICT, `None` otherwise). |

Up to **30** custom inputs and 30 custom outputs per node. The names `pipe`, `inputs_data` and
`strict` are reserved and cannot be used for custom entries.

### Frontend

The node body shows two buttons, **Edit inputs…** and **Edit outputs…**, which open the editor
dialog for the corresponding side. In the dialog:

- **+ Add** appends a new entry; each row has a name field and a type dropdown
  (IMAGE, MASK, LATENT, MODEL, CLIP, VAE, CONDITIONING, INT, FLOAT, STRING, BOOLEAN,
  LORA_STACK, CONTROL_NET_STACK, DICT, LIST, `*`).
- The name field offers **autocompletion**: suggested names are the entries configured on the
  other side of the node, plus every key written into the pipe by the PipeCustom nodes found
  upstream (the graph is walked breadth-first through all DICT-typed inputs — so PipeMerge
  branches and pipe-passing nodes are traversed — up to 100 nodes). Picking a suggested name
  also presets the row's type to the type known for that key; it can still be changed manually.
- Rows can be **drag-reordered** with the handle and removed with **✕**.
- **Renaming** a row keeps its slot and any connected wires — only removing a row (or changing
  its type) drops the wire. A rename is also propagated to the entry with the same name on the
  other side (inputs ↔ outputs), so the pipe key keeps matching end to end; an info toast lists
  the propagated renames. Propagation is skipped if the new name is already taken on that side.
- **Copy from inputs/outputs** replaces the list with the entries of the other side.
- **Load template…** opens a picker with predefined property sets loaded from
  `input/ntx_data/custompipe_configs.txt`; the chosen template's properties are appended,
  skipping names already present. Ticking **Replace current entries** in the picker clears the
  list before the template is applied instead of appending to it (nothing is committed until
  the editor dialog is confirmed with **OK**).
- **Save as template…** stores the current list as a named template in the same file, so it can
  be reloaded later on any PipeCustom node. If the name is already taken, the button changes to
  **Overwrite** and a second click is required to replace the existing template.
- Names are validated on OK (non-empty, no duplicates, no reserved names). If a name exists on
  both sides with different types, a warning toast is shown.
- **Enter** (while editing a name) confirms, **Escape** cancels.

Right-click menu options on the node:

- **Edit pipe inputs…** / **Edit pipe outputs…** — same as the two buttons.
- **Split custom pipe** — creates a second PipeCustom node to the right, moves all custom
  outputs (and their outgoing links) onto it, connects the original's `pipe` output to the new
  node's `pipe` input, and shifts the downstream nodes/groups to make room. The original node
  keeps only its inputs.
- **Merge custom pipes** — the reverse: merges the right-clicked node back into the
  upstream PipeCustom it is connected to (the source takes over the target's outputs and
  outgoing links, the target is deleted and downstream nodes are shifted back). Requires the
  target to have no non-pipe inputs connected and the source no non-pipe outputs connected.

Right-click menu option on the canvas (only shown while the selection contains at least one
PipeCustom node):

- **Merge all selected custom pipe nodes** — runs **Merge custom pipes** on every selected
  PipeCustom node in a single pass. Nodes that do not meet the merge requirements above are
  skipped silently (no per-node warnings); a final toast reports how many of the selected
  nodes were merged. In a selected chain of three or more pipes a node skipped only because
  its source still had connected outputs can be picked up by running the command again.

---

## LoraStack

![LoraStack node](images/LoraStack.png)

Builds a LORA_STACK from a list of LoRAs configured directly on the node through a custom
widget (no model is loaded here — combine with **ApplyLoraStack** to actually apply the stack).

### Inputs

| Input | Type | Description |
|---|---|---|
| `loras_data` | STRING (hidden) | JSON serialisation of the widget state (`{"commonStrength": bool, "loras": [{enabled, name, modelStrength, clipStrength}, ...]}`). Managed by the frontend widget. A bare JSON array (the old format) is still accepted. |
| `lora_stack` | LORA_STACK (optional) | An upstream stack to extend; the configured LoRAs are appended to it. |

### Outputs

| Output | Type | Description |
|---|---|---|
| `lora_stack` | LORA_STACK | The input stack (if any) plus one entry per **enabled** row with a real LoRA selected (rows set to `none` are skipped). When *Common strength* is on, the model strength is also used as the clip strength. |

### Frontend

The `loras_data` widget is replaced by a custom LoRA list UI:

- **Common strength** toggle in the header: when on, the clip strength column is hidden and the
  model strength is used for both.
- Each row: a drag handle (⠿, drag to reorder), an on/off toggle, the LoRA name, and *M* (model) /
  *C* (clip) strength widgets. The strength pills step ±0.05 with the ◀ ▶ arrows (CTRL+click for
  ±0.01) and scrub on horizontal drag (CTRL for fine steps); a plain click on the value opens an
  input box to type it directly (Enter or clicking away confirms, Escape cancels).
- Clicking the LoRA name opens a flat dropdown with a live filter box; the ◀ ▶ arrows next to
  the name step to the previous/next LoRA in the list.
- The 📂 button (or **Shift+click** on the LoRA name) opens a **tree selector** organised by
  subfolder, with a search box, **Refresh** button (re-scans the loras folder on disk via the
  `reload_loras_list` backend route), OK/Cancel, double-click to confirm, and Enter/Escape keys.
- Rows referencing a file that is **missing** from the loras folder get a red outline; rows that
  **duplicate** an earlier entry (which ApplyLoraStack would skip) get an amber outline. The
  tooltip on the name explains the warning.
- **+ Add LoRA** appends a row; **right-click on a row** offers *Delete*, *Move up*, *Move down*
  plus the stack-level actions; **right-click elsewhere** on the widget (header, add button)
  opens the stack-level menu directly: *Enable all*, *Disable all*, *Remove disabled*,
  *Copy stack as text* and *Paste from text*.
- **Copy stack as text** puts the enabled rows on the clipboard in `<lora:name:model[:clip]>`
  format (one per line); **Paste from text** parses any text containing such tags and appends
  the entries, matching names against the known list (a missing extension defaults to
  `.safetensors`, and bare basenames are resolved against subfolders).

Right-click menu options on the node:

- **Rebuild LoraStack UI** — recreates the custom widget in place (recovery for the rare
  case where the node deserialises with the raw-JSON fallback widget).
- **Reload Lora List from disk** — re-scans the loras folder on the backend and rebuilds
  the widget so the fresh list is available immediately.

---

## MergeLoraStacks

![MergeLoraStacks node](images/MergeLoraStacks.png)

Concatenates two LORA_STACKs into one.

### Inputs

| Input | Type | Description |
|---|---|---|
| `lora_stack_1` | LORA_STACK (optional) | First stack; its entries come first in the result. |
| `lora_stack_2` | LORA_STACK (optional) | Second stack; appended after the first. |

### Outputs

| Output | Type | Description |
|---|---|---|
| `lora_stack` | LORA_STACK | All entries of stack 1 followed by all entries of stack 2. Missing inputs are treated as empty. |

---

## ApplyLoraStack

![ApplyLoraStack node](images/ApplyLoraStack.png)

Applies every LoRA in a stack to a model (and optionally a CLIP), with duplicate detection,
an in-memory file cache, and optional download of missing files from cloud storage.

For each `(name, strength_model, strength_clip)` entry:

- entries with both strengths equal to 0 are skipped;
- a LoRA already applied earlier in the stack (same name) is skipped;
- the file is resolved in the `loras` model folder. If it is missing and cloud download is
  enabled in `config.json` (`download_missing_loras`, `cloud_storage_id`; active on Linux
  only), the node attempts to fetch it; otherwise a warning toast is emitted and the entry is
  skipped;
- the LoRA weights are loaded from disk and kept in a cache shared by all ApplyLoraStack nodes
  (size limited by `cache.max_loras` in `config.json`, default 5, oldest evicted first), then
  applied with `comfy.sd.load_lora_for_models`.

### Inputs

| Input | Type | Description |
|---|---|---|
| `lora_stack` | LORA_STACK | The stack to apply. An empty or missing stack passes model/clip through unchanged. |
| `model` | MODEL | The model to patch. |
| `clip` | CLIP (optional) | The CLIP to patch. If omitted, only the model is patched. |

### Outputs

| Output | Type | Description |
|---|---|---|
| `lora_stack` | LORA_STACK | The stack of LoRAs **actually applied** (skipped/failed entries removed) — useful for logging or converting to a string. |
| `model` | MODEL | The patched model. |
| `clip` | CLIP | The patched CLIP (or the input value if none was provided). |

---

## ConvertLoraStackToString

![ConvertLoraStackToString node](images/ConvertLoraStackToString.png)

Formats a LORA_STACK as text, one LoRA per line, in the `<lora:name:model_strength:clip_strength>`
syntax (strengths rounded to 2 decimals). Entries missing a strength default to the model
strength, or to 1.0 when only the name is present.

### Inputs

| Input | Type | Description |
|---|---|---|
| `lora_stack` | LORA_STACK (optional) | The stack to format. Empty/missing produces an empty string. |

### Outputs

| Output | Type | Description |
|---|---|---|
| `stack_text` | STRING | One `<lora:...>` line per entry. |

---

## ConvertLoraStringToStack

![ConvertLoraStringToStack node](images/ConvertLoraStringToStack.png)

The reverse operation: parses `<lora:name:strength[:clip_strength]>` references out of a text
prompt and turns them into a LORA_STACK, returning the prompt cleaned of the tags.

- If the optional `:clip_strength` part is missing, the model strength is used for both.
- A LoRA name without extension gets `.safetensors` appended; path separators are normalised.
- The cleaned prompt has **all** `<...>` angle-bracket sections removed (not only LoRA tags),
  with leftover runs of spaces collapsed (newlines preserved).

### Inputs

| Input | Type | Description |
|---|---|---|
| `prompt` | STRING | The text to parse. |
| `initial_lora_stack` | LORA_STACK (optional) | A stack to prepend; the parsed entries are appended to it. |

### Outputs

| Output | Type | Description |
|---|---|---|
| `clean_prompt` | STRING | The prompt with the angle-bracket sections removed. |
| `final_lora_stack` | LORA_STACK | `initial_lora_stack` + the entries parsed from the prompt. |

---

## ModelInfo

![ModelInfo node](images/ModelInfo.png)

A "settings sheet" for a model: it groups the model selection and its recommended generation
parameters in one node and simply passes every value through to its outputs, so they can be
wired to loaders, samplers, etc. The values can be loaded from / saved to a **`.ntxdata`
sidecar file** stored next to the model file (see *Frontend* below).

The `model_name` combo lists both checkpoints and diffusion models, prefixed with the model
kind: `ckpt:<name>` for `models/checkpoints`, `diff:<name>` for `models/diffusion_models`.
On execution the prefix is stripped: the bare name is emitted on `model_name` and the resolved
folder type (`checkpoints` / `diffusion_models`) on `model_type`.

### Inputs

| Input | Type | Description |
|---|---|---|
| `model_name` | COMBO | The model, prefixed with `ckpt:` or `diff:`. |
| `clip_name`, `clip_name_2`, `clip_name_3` | COMBO | Up to three text encoders (`None` = unused). |
| `vae_name` | COMBO | VAE to use, or `Baked VAE` for the one embedded in the checkpoint. |
| `clip_skip` | INT | CLIP skip (≤ 0, default -1). |
| `shift` | FLOAT | Sampling shift (model-dependent). |
| `guidance` | FLOAT | Guidance value (e.g. Flux). |
| `steps` | INT | Recommended step count. |
| `cfg` | FLOAT | Recommended CFG scale. |
| `sampler_name`, `scheduler` | COMBO | Recommended sampler / scheduler. |
| `model_prompt_positive`, `model_prompt_negative` | STRING | Prompt snippets associated with the model (e.g. trigger words, quality tags). |
| `notes` | STRING (multiline) | Free-form notes about the model. |

### Outputs

Every input is repeated as an output with the same name (combos are emitted as wildcard type so
they can connect to any matching input), plus:

| Output | Type | Description |
|---|---|---|
| `model_type` | STRING | The folder type decoded from the prefix: `checkpoints` or `diffusion_models`. |

### Frontend

Right-click menu options on the node:

- **Load Model Info** — asks the backend for the data stored in the model's `.ntxdata`
  sidecar file and fills the node's widgets with it. Fields missing from the file are left
  unchanged and listed in a warning toast.
- **Save Model Info** — sends the current widget values to the backend, which writes them
  into the sidecar data. Note: the file is written with a `.ntxdata_new` extension (next to the
  model), so the existing `.ntxdata` is never overwritten directly.

---

## LoadPrompt

![LoadPrompt node](images/LoadPrompt.png)

Picks a prompt from a nested, file-based prompt library and outputs its text (plus an optional
preview image). The library lives in `input/ntx_data/prompts/` and is merged from two sources:

- every `*.yaml` / `*.yml` file in the top level of that folder: dictionary keys become nested
  category paths and list items become the selectable leaves. A leaf is either a plain string
  (used as both id and prompt text, or split as `id::text`), or a dictionary with `name` (the
  id) and `positive` (the prompt) keys — any extra keys become named parameters used by the
  *LoadPromptAdvanced* variant;
- every `*.txt` file inside subdirectories of the folder: the relative path without extension
  becomes the id (e.g. `scenes/fantasy/castle.txt` → `scenes/fantasy/castle`) and the file
  content the prompt.

For example, this YAML file shows the three leaf forms:

```yaml
scenes:
  fantasy:
    - a misty castle on a cliff at dawn
    - dungeon::a torch-lit stone dungeon, dripping water, volumetric light
  sci-fi:
    - name: space station
      positive: interior of a vast orbital space station, earth visible through the windows
```

| Id | Prompt text |
|---|---|
| `scenes/fantasy/a misty castle on a cliff at dawn` | the id itself (plain string leaf) |
| `scenes/fantasy/dungeon` | `a torch-lit stone dungeon, dripping water, volumetric light` (`id::text` leaf) |
| `scenes/sci-fi/space station` | `interior of a vast orbital space station, earth visible through the windows` (dictionary leaf) |

The library is cached in memory on the backend, and the option list of the `id` combo is
re-read from the files on disk every time the node definitions are fetched — on page load and
when they are reloaded with `R` (**Refresh Node Definitions**) — so prompts added on disk show
up without a backend restart. The tree picker's **Refresh** button and the right-click reload
entry (see *Frontend*) also update the dropdown of every LoadPrompt* node immediately. Any id
value is accepted at execution time, so a workflow saved with an id that was later removed
from the library still runs (the prompt box keeps its saved text).

### Inputs

| Input | Type | Description |
|---|---|---|
| `id` | COMBO | The prompt id (`category/.../name`). The option list mirrors the library on disk (see above). |
| `prompt` | STRING (multiline) | The prompt text. The frontend fills it automatically when an id is selected, and it can be freely edited afterwards. If left empty (e.g. headless/API execution), the library text for the id is used. |

### Outputs

| Output | Type | Description |
|---|---|---|
| `prompt` | STRING | The prompt text (edited value, or the library text if the box was empty). |
| `id` | STRING | The selected id. |
| `image` | IMAGE | The preview image stored next to the prompt id (same path with a `.png` / `.jpeg` / `.jpg` extension), or nothing if no such file exists. |

### Frontend

- **Shift+click** on the `id` widget opens a **tree picker** organised by category, with a
  filter box, OK/Cancel, double-click to confirm, and Enter/Escape keys. Its **Refresh** button
  makes the backend re-read the prompt files from disk, rebuilds the tree and updates the `id`
  dropdown of every LoadPrompt* node in the graph.
- The tree picker shows a **preview pane** below the tree: the library text of the highlighted
  prompt, together with its thumbnail when an image sits next to the prompt file.
- Selecting an id (from the picker or the combo) automatically fills the `prompt` textbox with
  the library text. If the current text was **edited manually** (it differs from the library
  text of the previously selected id), a confirmation dialog asks before replacing it —
  cancelling keeps the edited text while still switching the id.

Right-click menu options on the node:

- **Rebuild Prompts List from disk** — same effect as the tree picker's **Refresh** button:
  the backend re-reads the prompt files, the cached maps are refreshed and the `id` dropdowns
  are updated.
- **Pick prompt** — opens the same tree picker (filter, preview pane, double-click to confirm)
  purely to copy a prompt's **library text** to the clipboard; nothing on the node is changed.
  Unlike the other entry, this one is added to the right-click menu of **every node and of the
  empty canvas**, not just LoadPrompt* nodes, so a prompt can be grabbed from anywhere in the
  graph. When invoked on a LoadPrompt* node the picker starts on that node's current id;
  elsewhere (another node or the empty canvas) it reopens on the **last prompt picked this
  way**, so the previous selection is remembered across calls (until the page is reloaded). A
  toast confirms the copy (and a hidden-textarea fallback is used when the browser clipboard
  API is unavailable, e.g. over plain HTTP).

The same frontend behaviour (tree picker, prompt auto-fill, RMB reload) is shared by the
**LoadPromptAdvanced** and **LoadPromptChar** variants described below.

---

## LoadPromptAdvanced

![LoadPromptAdvanced node](images/LoadPromptAdvanced.png)

Same as **LoadPrompt**, with three extra free-form string parameters that are passed straight
through to the outputs, plus a dictionary output carrying all the extra keys of the entry.

Differences from LoadPrompt:

- three additional STRING inputs, `param1`, `param2`, `param3`, each repeated unchanged as an
  output with the same name;
- an additional `params` DICT output with **every** extra key:value pair of the selected
  library entry (empty for plain-string leaves) — useful downstream with
  **ReplaceTextParameters**, and not limited to three values or to widget renaming;
- when the selected library entry is a dictionary carrying extra keys besides `name` and
  `positive`, the frontend fills the param widgets from those keys when the id is selected.
  A widget is matched by its **current (user-facing) name**, so renaming e.g. `param2` to
  `outfit` on the node makes it pick up the entry's `outfit` value. Params the entry does not
  define are cleared.

### Example

A YAML file in the prompt library:

```yaml
characters:
  fantasy:
    - name: elf ranger
      positive: an elf ranger with a longbow, forest background
      outfit: green hooded cloak, leather armor
      hair: long silver hair
```

This defines the id `characters/fantasy/elf ranger`, whose prompt is the `positive` text and
whose extra parameters are `outfit` and `hair`. On a LoadPromptAdvanced node where `param1`
has been renamed to `outfit` and `param2` to `hair`, selecting that id fills the widgets as:

| Widget | Value after selection |
|---|---|
| `prompt` | `an elf ranger with a longbow, forest background` |
| `outfit` (renamed `param1`) | `green hooded cloak, leather armor` |
| `hair` (renamed `param2`) | `long silver hair` |
| `param3` | cleared (the entry does not define a `param3` key) |

## LoadPromptChar

![LoadPromptChar node](images/LoadPromptChar.png)

Same as **LoadPrompt**, specialised for character prompts to be saved/reused by name.

Differences from LoadPrompt:

- an additional STRING input `save_name`, passed through unchanged to the `save_name` output
  (like the params of LoadPromptAdvanced, its widget is filled from the library entry's extra
  keys when an id is selected);
- the prompt text is emitted on an output named `char` instead of `prompt`;
- there are no `id` and `image` outputs — the node outputs only `char` and `save_name`.

---

## ReplaceTextParameters

![ReplaceTextParameters node](images/ReplaceTextParameters.png)

Replaces named placeholders inside a text with values taken from a parameters dictionary.
Placeholders are written as `%name%` or `%%name%%` (the double-`%%` form is resolved first,
so it survives inside text that also uses single `%` signs). A placeholder whose name is not
found in the dictionary is replaced with an **empty string**.

The special form `%date:FORMAT%` (or `%%date:FORMAT%%`) inserts the current date/time instead
of a dictionary value. `FORMAT` uses JavaScript-style tokens, converted internally to Python
`strftime`: `YYYY`/`yy` (year), `MMMM`/`MMM`/`MM` (month name / short name / number),
`DD` (day), `DDDD` (day of year), `HH` (hour), `mm` (minutes), `ss` (seconds).

### Example

With `text` = `in the style of %artist%, generated %%date:YYYY-MM-DD%%` and a `parameters`
dictionary containing `{"artist": "anime"}`, the output is
`in the style of anime, generated 2026-07-02`.

### Inputs

| Input | Type | Description |
|---|---|---|
| `text` | STRING | The text containing the placeholders. |
| `parameters` | DICT (optional) | The `{name: value}` dictionary used for the replacements. If missing, every non-date placeholder resolves to an empty string. |

### Outputs

| Output | Type | Description |
|---|---|---|
| `text` | STRING | The text with all placeholders replaced. |

---

## LazySelectAny

![LazySelectAny node](images/LazySelectAny.png)

A branch selector with **lazy evaluation**: it returns the value of one of its five wildcard
inputs, chosen by index — and only the selected branch of the graph is executed. The node uses
ComfyUI's lazy-input mechanism (`check_lazy_status`) to request the evaluation of just the
selected input, so the upstream nodes feeding the unselected inputs are never run. This makes
it useful as a switch between alternative (possibly expensive) sub-graphs, e.g. two different
image-processing chains.

### Inputs

| Input | Type | Description |
|---|---|---|
| `select` | INT | Index of the input to return (0–4). |
| `input0` … `input4` | any (optional, lazy) | The selectable values. All five slots accept any data type; only the one addressed by `select` is evaluated. |

### Outputs

| Output | Type | Description |
|---|---|---|
| `output` | any | The value of the selected input (`None` if that slot is not connected). |

---

## PreviewAsText

![PreviewAsText node](images/PreviewAsText.png)

Shows any value as text on the node, like the core **Preview as Text** node — but it is **not
an output node**, so placing it in a workflow never triggers an execution by itself. The node
only runs when a downstream node actually consumes its `text` output; wire the value *through*
it rather than dead-ending into it (or use the right-click queue entry below to run it on
demand). The preview refreshes whenever the node executes.

The value is converted to text as follows: strings are shown as-is; ints, floats and booleans
via `str()`; anything else is serialised as indented JSON, falling back to `str()` (tensors are
printed with 6 edge items per dimension), and finally to a
`source exists, but could not be serialized.` message. A missing value shows `None`.

### Inputs

| Input | Type | Description |
|---|---|---|
| `source` | any | The value to preview. |

### Outputs

| Output | Type | Description |
|---|---|---|
| `text` | STRING | The text representation of `source`, as shown in the preview. |

### Frontend

- The node body shows a read-only **Preview** area, filled with the text when the node
  executes.
- A **Markdown / Plaintext** toggle switches the preview between a rendered-markdown view and
  a plain textarea (default: Plaintext). The toggle and the preview content are display-only
  and are not saved into the workflow or the API prompt.

Right-click menu option on the node:

- **Queue (this node as output)** — queues the current workflow with this node as the only
  execution target, as if it were an output node: exactly its branch runs (upstream
  dependencies included), and every other output node in the workflow is skipped. The saved
  workflow is not modified. Muted/bypassed nodes and nodes inside subgraphs cannot be queued
  this way (a warning toast is shown). Note: a run forced this way is cached separately from a
  normal run, so the node re-executes the first time it is reached through the regular queue
  afterwards.

---

## PreviewImage

![PreviewImage node](images/PreviewImage.png)

Shows image previews on the node, like the core **Preview Image** node — but, as with
**PreviewAsText**, it is **not an output node**: it never triggers an execution by itself and
only runs when a downstream node consumes its `images` output. Unlike the core node it
therefore has a pass-through output, so it can sit in the middle of an image chain and
preview whatever flows through.

The previews are written to ComfyUI's temporary folder (one PNG per image in the batch, low
compression) and embed the prompt/workflow metadata, exactly like the core node (metadata is
omitted when ComfyUI runs with `--disable-metadata`).

### Inputs

| Input | Type | Description |
|---|---|---|
| `images` | IMAGE | The image batch to preview. |

### Outputs

| Output | Type | Description |
|---|---|---|
| `images` | IMAGE | The input batch, passed through unchanged. |

### Frontend

Right-click menu option on the node:

- **Queue (this node as output)** — same behaviour as on **PreviewAsText**: queues the
  workflow with just this node's branch as the execution target.

---

## Reroute nodes

![Reroute node](images/Reroute.png)

A family of pass-through nodes (under **reroute** in the node menu), one per data
type, used to organise the wires of a workflow. Each node has a single input and a single
output and forwards whatever it receives, unchanged. The input is optional: when it is left
disconnected the node outputs a type-appropriate default value instead, so a reroute can also
serve as a source of an "empty" value.

Available variants (slot name — default output when the input is disconnected):

- **RerouteAny** — `value`, accepts any type (`None`)
- **RerouteBoolean** — `boolean` (`False`)
- **RerouteFloat** — `float` (`0.0`)
- **RerouteInteger** — `integer` (`0`)
- **RerouteString** — `string` (`""`)
- **RerouteModel** — `model` (`None`)
- **RerouteClip** — `clip` (`None`)
- **RerouteClipVision** — `clip_vision` (`None`)
- **RerouteVae** — `vae` (`None`)
- **RerouteImage** — `image` (`None`)
- **RerouteMask** — `mask` (`None`)
- **RerouteLatent** — `latent` (`None`)
- **RerouteConditioning** — `conditioning` (`None`)
- **RerouteDict** — `dict` (`{}`)
- **RerouteList** — `list` (`[]`)
- **RerouteLoraStack** — `lora_stack` (`[]`)
- **RerouteControlNetStack** — `control_net_stack` (`[]`)

The primitive variants (`boolean`, `float`, `integer`, `string`) only accept a link — they
never show an editable widget.

### Inputs

| Input | Type | Description |
|---|---|---|
| *(slot name from the list above)* | matches the variant (optional) | The value to pass through. |

### Outputs

| Output | Type | Description |
|---|---|---|
| *(slot name from the list above)* | matches the variant | The input value, unchanged; the variant's default when the input is disconnected. |

### Frontend

**Repositionable slots.** By default the input sits on the left edge and the output on the
right edge, but each of them can be moved to any of the four sides of the node — with the
constraint that the input and the output never share a side. Wires bend accordingly, leaving
or entering the node in the direction of the side their slot sits on, and the slots keep
their side when the node is resized. The chosen layout is saved with the workflow (in the
node properties `input_side` / `output_side`); picking **Left to Right** returns the node to
the standard layout. A collapsed node uses the usual collapsed connection points until it is
expanded again.

**Free resizing.** Reroute nodes can be resized down to **80 px** wide (standard nodes stop
at about 140 px), so they can be kept compact. Two side effects of shrinking below the text
width: the title and slot labels may visually overflow the node (renaming the node to
something short avoids it), and the native **Resize** right-click action snaps the node
straight to the minimal width.

Right-click menu option on the node:

- **Slot sides** — submenu listing every valid input→output side combination (**Left to
  Right**, **Left to Top**, …, 12 in total; same-side combinations are not offered). The
  current layout is marked with a ✓; clicking an entry applies both sides at once.

---

## GlobalSet

![GlobalSet node](images/GlobalSet.png)

One half of a wireless connection pair (found under **reroute**, together with
**GlobalGet**): it stores any number of connections under unique names, and GlobalGet nodes
read them back anywhere on the canvas — subgraphs included — without a cable. The set of
inputs is defined per node through an editor dialog (same style as the PipeCustom editor),
each entry with its own name and data type.

Both nodes are **virtual**: they exist only in the editor and are removed from the prompt when
the workflow is queued — every GlobalGet output resolves directly to the node feeding the
same-named GlobalSet input, so the pair never executes, adds no cost and cannot change the
result. Muting or bypassing them has no effect on a run for the same reason.

Names are **global**: a name may be defined by only one GlobalSet in the whole workflow
(nested subgraphs included) — the editor rejects a name already defined by another GlobalSet,
and a **pasted or cloned** GlobalSet automatically renames its conflicting entries
(`foo` → `foo_2`, `foo_3`, …).

### Inputs

| Input | Type | Description |
|---|---|---|
| *custom inputs* | user-defined | One slot per configured entry, with the chosen name and type. Whatever is wired in is readable under that name by every GlobalGet. A slot left unconnected stores nothing — GlobalGet outputs with that name resolve to no value (the downstream input behaves as unconnected). |

### Outputs

The node has no outputs — values are read back with **GlobalGet** nodes.

Up to **30** entries per node.

### Frontend

The node body shows an **Edit inputs…** button opening the editor dialog:

- **+ Add input** appends a new entry; each row has a name field and a type dropdown (same
  type list as the PipeCustom editor: IMAGE, MASK, LATENT, MODEL, CLIP, VAE, CONDITIONING,
  INT, FLOAT, STRING, BOOLEAN, LORA_STACK, CONTROL_NET_STACK, DICT, LIST, `*`).
- Rows can be **drag-reordered** with the handle and removed with **✕**.
- **Renaming** a row keeps its slot and wire; changing a row's **type** keeps the slot but
  drops the wire. Names are validated on **OK**: non-empty, no duplicates on the node, not
  defined by another GlobalSet.
- Changes are propagated to the GlobalGet nodes on **OK**: a renamed entry renames the
  matching Get outputs everywhere (their slots and wires are kept), a type change retypes
  them (their wires are dropped, as they are no longer valid), and a removed entry leaves
  the Get outputs in place but a warning toast lists the orphaned names.
- **Enter** (while editing a name) confirms, **Escape** cancels.

Right-click menu options on the node:

- **Edit global inputs…** — same as the button.
- **Select its Get nodes (n)** — selects every GlobalGet in the same graph that reads at
  least one of this node's names.

---

## GlobalGet

![GlobalGet node](images/GlobalGet.png)

The other half of the pair: exposes values stored by **GlobalSet** nodes as outputs, with no
cable. The set of outputs is defined through the same editor dialog — but only names defined
by a GlobalSet can be used, and each output automatically takes the defining entry's data
type. Any number of GlobalGet nodes may read the same name, so one value can fan out across
the whole workflow, including into or out of subgraphs.

Like GlobalSet, the node is virtual (see above): at queue time each output resolves straight
to the real node feeding the same-named GlobalSet input. An output whose name is no longer
defined, or whose GlobalSet slot is unconnected, resolves to no value — a downstream node
with that required input then fails prompt validation, exactly as if the input were
unconnected.

### Inputs

The node has no inputs — values are stored with **GlobalSet** nodes.

### Outputs

| Output | Type | Description |
|---|---|---|
| *custom outputs* | taken from the Set | One slot per configured entry; carries the value wired into the same-named GlobalSet input, with that entry's type. |

Up to **30** entries per node.

### Frontend

The node body shows an **Edit outputs…** button opening the editor dialog:

- Rows work as on GlobalSet (add, drag-reorder, remove, rename keeps the wires), with two
  differences: the name field **autocompletes** with the names defined by the GlobalSet
  nodes, and the type dropdown is **locked** to the defining entry's type as soon as the
  name is recognised.
- **Add all Set names** appends one entry for every defined name not already on the node.
- Names are validated on **OK**: non-empty, no duplicates on the node, and every name must
  be defined by a GlobalSet.
- Renames made on the GlobalSet side follow automatically (see GlobalSet above); an entry
  whose name was removed on the Set side stays on the node (with its warning toast) until
  it is fixed or removed here.

Right-click menu options on the node:

- **Edit global outputs…** — same as the button.
- **Jump to Global Set** — submenu with one entry per output name; centers the view on the
  GlobalSet defining that name, switching into its graph when it lives in a different
  subgraph.

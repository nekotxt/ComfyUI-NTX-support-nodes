## DoublePrompt

![DoublePrompt node](images/DoublePrompt.png)

A positive/negative prompt pair in a single node: two multiline text fields whose contents
are output **unchanged**. Its distinguishing feature is that the boundary between the two
fields can be dragged, so the node's height can be shared freely between the positive and the
negative prompt (a long positive prompt next to a one-line negative, for instance).

### Inputs

| Input | Type | Description |
|---|---|---|
| `prompt_positive` | STRING (multiline) | The positive prompt. Dynamic prompts syntax is enabled. |
| `prompt_negative` | STRING (multiline) | The negative prompt. Dynamic prompts syntax is enabled. |

### Outputs

| Output | Type | Description |
|---|---|---|
| `prompt_positive` | STRING | The positive prompt, exactly as typed. |
| `prompt_negative` | STRING | The negative prompt, exactly as typed. |

### Frontend

- A **divider** sits in the gap between the two fields, marked with three grip dots (the mouse
  cursor turns into a vertical resize arrow over it). **Dragging** it moves the boundary:
  enlarging the positive field shrinks the negative one by the same amount, and vice versa.
  Each field always keeps a minimum height of **50 px**.
- **Double-click** on the divider restores the even 50/50 split.
- The split is stored as a **proportion** of the node body (node property `split_ratio`,
  saved with the workflow), so resizing the node itself keeps the chosen balance between the
  two fields.
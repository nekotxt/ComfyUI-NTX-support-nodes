"""
CascadeCollage — ComfyUI custom node
-------------------------------------
Arranges a list of images into a responsive, fluid photo-gallery grid and
returns a single composited image.

Key design choice — INPUT_IS_LIST
----------------------------------
ComfyUI's IMAGE type is a (B, H, W, C) tensor where every frame shares the
same H × W.  If we accepted a normal IMAGE batch, all aspect-ratio information
would already be lost (images cropped/resized to uniform size).

By setting ``INPUT_IS_LIST = True`` each connected image arrives as a separate
tensor with its **original** dimensions intact.  This is what lets us lay out
portraits next to landscapes without any cropping.

Algorithm — optimal row partitioning (Knuth-Plass style)
---------------------------------------------------------
Dynamic programming finds the global-best partition of images into rows,
minimising deviation from a target row height.  Each row is then justified
edge-to-edge with pixel-perfect width distribution.

Input
-----
images  : IMAGE (list) — connect one or more IMAGE outputs; each keeps its
          native resolution.
width   : INT    — output canvas width in pixels.
spacing : INT    — gap in pixels between adjacent images (h and v).
"""

import math
import torch
import torch.nn.functional as F


class CascadeCollageNode:

    # ── Tell ComfyUI to deliver every input as a Python list ─────────
    INPUT_IS_LIST  = True
    OUTPUT_IS_LIST = (False,)

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images":  ("IMAGE",),
                "width":   ("INT", {"default": 1024, "min": 64,  "max": 8192, "step": 1}),
                "spacing": ("INT", {"default": 8,    "min": 0,   "max": 256,  "step": 1}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION     = "collate"
    CATEGORY     = "image/transform"
    OUTPUT_NODE  = False

    # ── helpers ───────────────────────────────────────────────────────

    @staticmethod
    def _resize(src: torch.Tensor, h: int, w: int) -> torch.Tensor:
        """Resize a (H, W, C) tensor to (h, w, C) via bilinear interpolation."""
        t = src.unsqueeze(0).permute(0, 3, 1, 2)              # (1,C,H,W)
        t = F.interpolate(t, size=(h, w), mode="bilinear",
                          align_corners=False)
        return t.squeeze(0).permute(1, 2, 0)                  # (h,w,C)

    @staticmethod
    def _optimal_rows(aspects: list[float], width: int,
                      spacing: int, target_h: float) -> list[list[int]]:
        """
        Dynamic-programming row partition (Knuth-Plass style).

        Finds the split of images 0 … N-1 into consecutive rows that
        minimises  sum-over-rows-of  ((row_h / target_h) - 1)^2 .
        """
        n   = len(aspects)
        INF = float("inf")

        dp:     list[float] = [INF] * (n + 1)   # dp[i] = min cost for 0…i-1
        parent: list[int]   = [0]   * (n + 1)
        dp[0] = 0.0

        # Prefix sums for O(1) range queries on aspect ratios
        prefix = [0.0] * (n + 1)
        for i in range(n):
            prefix[i + 1] = prefix[i] + aspects[i]

        for i in range(1, n + 1):
            for j in range(i - 1, -1, -1):
                n_in_row    = i - j
                sum_aspects = prefix[i] - prefix[j]
                total_gap   = (n_in_row - 1) * spacing
                avail_w     = width - total_gap

                if avail_w <= 0:
                    break

                row_h = avail_w / sum_aspects       # justified height

                ratio = row_h / target_h
                cost  = (ratio - 1.0) ** 2
                if ratio < 0.25 or ratio > 3.0:
                    cost += 1e6

                total = dp[j] + cost
                if total < dp[i]:
                    dp[i]     = total
                    parent[i] = j

                if row_h < target_h * 0.2:
                    break

        # Back-track
        rows: list[list[int]] = []
        i = n
        while i > 0:
            j = parent[i]
            rows.append(list(range(j, i)))
            i = j
        rows.reverse()
        return rows

    @staticmethod
    def _pixel_perfect_widths(aspects_row: list[float],
                              avail_w: int) -> list[int]:
        """
        Distribute *avail_w* pixels proportionally to aspect ratios.
        Integer rounding remainder is spread one pixel at a time to the
        images with the largest fractional parts, so the total is exact.
        """
        total_ar = sum(aspects_row)
        ideal    = [ar / total_ar * avail_w for ar in aspects_row]
        floored  = [int(math.floor(w)) for w in ideal]
        fracs    = sorted(
            ((ideal[i] - floored[i], i) for i in range(len(ideal))),
            reverse=True,
        )
        remainder = avail_w - sum(floored)
        for k in range(remainder):
            floored[fracs[k][1]] += 1
        return [max(1, w) for w in floored]

    # ── main entry point ──────────────────────────────────────────────

    def collate(self, images: list, width: list, spacing: list):
        """
        Because INPUT_IS_LIST = True, every parameter arrives as a list.
        - images:  list of tensors, each (B_i, H_i, W_i, C)
        - width:   [int]
        - spacing: [int]
        """
        width_val:   int = width[0]
        spacing_val: int = spacing[0]

        # ── Flatten all images into individual (H, W, C) tensors ─────
        flat_imgs: list[torch.Tensor] = []
        for tensor in images:
            # tensor might be (B, H, W, C) with B >= 1
            for b in range(tensor.shape[0]):
                flat_imgs.append(tensor[b])          # (H, W, C)

        B = len(flat_imgs)
        C = flat_imgs[0].shape[2]

        if B == 0:
            return (torch.ones((1, 64, max(width_val, 64), C),
                               dtype=torch.float32),)

        if B == 1:
            src   = flat_imgs[0]
            src_h, src_w = src.shape[0], src.shape[1]
            new_h = max(1, round(src_h * width_val / src_w))
            return (self._resize(src, new_h, width_val).unsqueeze(0),)

        # ── 1. True aspect ratios from each image's own dimensions ───
        aspects = [img.shape[1] / img.shape[0] for img in flat_imgs]

        # ── 2. Target row height ─────────────────────────────────────
        target_rows = max(1, round(B ** 0.5))
        target_h    = max(32, int(width_val * target_rows / sum(aspects)))

        # ── 3. Optimal row partition via DP ──────────────────────────
        rows = self._optimal_rows(aspects, width_val, spacing_val, target_h)

        # ── 4. Justify each row — resize preserving aspect ratios ────
        row_data:    list[list[torch.Tensor]] = []
        row_heights: list[int]                = []

        for row in rows:
            n_row     = len(row)
            total_gap = (n_row - 1) * spacing_val
            avail_w   = width_val - total_gap

            # Pixel-perfect widths proportional to each image's aspect ratio
            img_widths = self._pixel_perfect_widths(
                [aspects[i] for i in row], avail_w
            )

            # Each image gets its OWN height = width / its aspect ratio.
            # No image is ever cropped — only uniformly scaled.
            imgs:  list[torch.Tensor] = []
            max_h = 0
            for k, idx in enumerate(row):
                iw = img_widths[k]
                ih = max(1, round(iw / aspects[idx]))
                max_h = max(max_h, ih)
                imgs.append(self._resize(flat_imgs[idx], ih, iw))

            row_data.append(imgs)
            row_heights.append(max_h)

        # ── 5. Composite onto canvas ─────────────────────────────────
        canvas_h = sum(row_heights) + (len(rows) - 1) * spacing_val
        canvas   = torch.zeros((canvas_h, width_val, C), dtype=torch.float32)

        y = 0
        for r_idx, imgs in enumerate(row_data):
            x  = 0
            rh = row_heights[r_idx]
            for img in imgs:
                ih, iw = img.shape[0], img.shape[1]
                # Vertically centre shorter images within the row
                y_off = (rh - ih) // 2
                canvas[y + y_off : y + y_off + ih, x : x + iw] = img
                x += iw + spacing_val
            y += rh + spacing_val

        return (canvas.unsqueeze(0),)



# ------------------------------------------------------------------

NODE_LIST = {
    "CascadeCollage": CascadeCollageNode,
}

"""批次生成 simple_ui 的動漫素材（吉祥物 / 空狀態 / 分類圖示 / 紋理）。

用法： python gen_assets.py            # 全部生成
       python gen_assets.py mascot     # 只生成名稱含 mascot 的項目
生成的 PNG 會存到 simple_ui/assets/。
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

COMFY = "http://127.0.0.1:8188"
HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "assets")
CKPT = "WAI-Nsfw-Illustrious-17.safetensors"

NEG = (
    "worst quality, low quality, bad anatomy, bad hands, extra fingers, missing fingers, "
    "watermark, text, signature, blurry, jpeg artifacts, child, loli, shota, multiple views, "
    "character sheet, comic, cropped, out of frame, border, frame"
)

BASE = (
    "1girl, solo, cat ears, cat tail, purple hair, twintails, purple eyes, hair ribbon, "
    "purple oversized hoodie, off shoulder, black shorts over thighhighs, "
    "tan skin, masterpiece, best quality, amazing quality, very aesthetic, absurdres, "
    "anime coloring, clean lineart, cel shading, simple background, black background"
)

# name -> (prompt, seed)
ITEMS = {
    # ── 吉祥物：同一角色、兩種表情 ────────────────────────────────
    "mascot-idle": (BASE + ", upper body, looking at viewer, gentle smile, closed mouth, "
                    "hands together, standing, soft rim light", 424242),
    "mascot-happy": (BASE + ", upper body, open mouth, big smile, sparkling eyes, waving, "
                     "confetti, sparkles, energetic", 424244),

    # ── 舞台插畫 ────────────────────────────────────────────────
    "stage-empty": ("1girl, solo, cat ears, cat tail, purple hair, twintails, purple eyes, "
                    "purple oversized hoodie, sitting, holding sketchbook, pencil, "
                    "looking at viewer, gentle smile, empty canvas, sparkles, "
                    "masterpiece, best quality, amazing quality, clean lineart, "
                    "simple background, black background", 424250),
    "stage-loading": ("1girl, solo, cat ears, cat tail, purple hair, twintails, purple eyes, "
                      "purple oversized hoodie, drawing, focused, holding pencil, sketchbook, "
                      "motion lines, sparkles, sideways glance, "
                      "masterpiece, best quality, amazing quality, clean lineart, "
                      "simple background, black background", 424251),

    # ── 分類圖示：Q 版頭像 ──────────────────────────────────────
    "cat-common": ("chibi, 1girl, head only, cat ears, purple hair, twintails, purple eyes, "
                   "star hair ornament, sparkles, big smile, looking at viewer, "
                   "masterpiece, best quality, flat color, simple background, black background", 510001),
    "cat-person": ("chibi, 1girl, head only, cat ears, purple hair, twintails, purple eyes, "
                   "looking at viewer, gentle smile, portrait, "
                   "masterpiece, best quality, flat color, simple background, black background", 510002),
    "cat-hair": ("chibi, 1girl, head only, very long hair, flowing hair, purple hair, "
                 "twintails, hair ribbon, side profile, hair blowing, "
                 "masterpiece, best quality, flat color, simple background, black background", 510003),
    "cat-face": ("chibi, 1girl, head only, cat ears, purple hair, twintails, wink, blush, "
                 "one eye closed, tongue out, cheerful, "
                 "masterpiece, best quality, flat color, simple background, black background", 510004),
    "cat-clothes": ("chibi, 1girl, head only, school uniform, serafuku, sailor collar, "
                    "ribbon, purple eyes, smile, upper body, "
                    "masterpiece, best quality, flat color, simple background, black background", 510005),
    "cat-accessory": ("chibi, 1girl, head only, cat ears, hair ribbon, choker, earrings, "
                      "glasses on head, sparkles, smile, "
                      "masterpiece, best quality, flat color, simple background, black background", 510006),
    "cat-pose": ("chibi, 1girl, head only, waving, hand up, peace sign, cheerful, "
                 "cat ears, purple hair, twintails, "
                 "masterpiece, best quality, flat color, simple background, black background", 510007),
    "cat-camera": ("chibi, 1girl, head only, holding camera, viewfinder, portrait, "
                   "cat ears, purple hair, twintails, one eye closed, "
                   "masterpiece, best quality, flat color, simple background, black background", 510008),
    "cat-scene": ("chibi, 1girl, head only, torii, cherry blossoms, night, lanterns, "
                  "cat ears, purple hair, twintails, looking away, "
                  "masterpiece, best quality, flat color, simple background, black background", 510009),
    "cat-style": ("chibi, 1girl, head only, holding paintbrush, paint palette, watercolor, "
                  "paint splatter, cat ears, purple hair, twintails, smile, "
                  "masterpiece, best quality, flat color, simple background, black background", 510010),

    # ── 背景紋理 ────────────────────────────────────────────────
    "bg-pattern": ("seamless pattern, small stars, sparkles, dots, halftone, "
                   "dark background, dark purple, monochrome, low contrast, flat design, "
                   "no humans, masterpiece, best quality", 620001),
}


def req(path, data=None):
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(COMFY + path, data=body,
                               headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=600) as resp:
        return json.loads(resp.read())


def workflow(name, prompt, seed, w, h, steps, cfg):
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["1", 1]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["1", 1]}},
        "4": {"class_type": "EmptyLatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}},
        "5": {"class_type": "KSampler", "inputs": {
            "model": ["1", 0], "positive": ["2", 0], "negative": ["3", 0],
            "latent_image": ["4", 0], "seed": seed, "steps": steps, "cfg": cfg,
            "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": 1}},
        "6": {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["1", 2]}},
        "7": {"class_type": "SaveImage", "inputs": {"images": ["6", 0], "filename_prefix": "ui_assets/" + name}},
    }


def wait_history(pid):
    for _ in range(600):
        h = req("/history/" + pid)
        if pid in h:
            return h[pid]
        time.sleep(1)
    raise TimeoutError("timeout " + pid)


def download(filename, subfolder, out_path):
    q = urllib.parse.urlencode({"filename": filename, "subfolder": subfolder, "type": "output"})
    with urllib.request.urlopen(COMFY + "/view?" + q, timeout=120) as r:
        data = r.read()
    with open(out_path, "wb") as f:
        f.write(data)


def main(only=None):
    os.makedirs(ASSETS, exist_ok=True)
    names = [n for n in ITEMS if not only or only in n]
    print("jobs:", len(names), flush=True)
    for i, name in enumerate(names, 1):
        prompt, seed = ITEMS[name]
        w = h = 1024
        if name == "bg-pattern":
            w = h = 768
        wf = workflow(name, prompt, seed, w, h, 26, 6)
        # SaveImage 的 prefix 依全域 name 設定
        wf["7"]["inputs"]["filename_prefix"] = "ui_assets/" + name
        t0 = time.time()
        pid = req("/prompt", {"prompt": wf})["prompt_id"]
        hist = wait_history(pid)
        outs = hist.get("outputs", {}).get("7", {}).get("images", [])
        if not outs:
            print("FAIL", name, hist.get("status"), flush=True)
            continue
        img = outs[0]
        out_path = os.path.join(ASSETS, name + ".png")
        download(img["filename"], img.get("subfolder", ""), out_path)
        print(f"{i}/{len(names)} {name} {time.time()-t0:.0f}s {os.path.getsize(out_path)//1024}KB", flush=True)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)

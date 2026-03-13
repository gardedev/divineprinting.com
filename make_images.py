"""
Extract product photos from catalog PDF pages and overlay church designs.
Corrected page map based on visual inspection.

Confirmed page contents:
 3 = Outdoor summer sale banner (vinyl banner)
 4 = Billboard/fence banners (vinyl banner 2)
 5 = Large mesh fence banner
 6 = Branded barrier banners / mesh banners
 7 = Soccer sponsor fabric banner
 8 = International flags on flagpoles
 9 = Yard signs on lawn
10 = State soccer feather flags (feather/teardrop flags)
11 = Roll-up retractable banners
12 = Roll-up banners (another view)
13 = Vinyl stickers assortment
14 = Magnetic whiteboard / fridge calendar
15 = Car window vinyl transfer decal
16 = Kids floor hopscotch stickers
17 = Magnetic car door sign
18 = Printed flyers
19 = Printed full-color flyers (another)
"""
from PIL import Image, ImageDraw, ImageFont
import os

RAW = "/home/ubuntu/.openclaw/workspace/divineprinting/raw_pages"
OUT = "/home/ubuntu/.openclaw/workspace/divineprinting/images"
os.makedirs(OUT, exist_ok=True)

PURPLE = (61, 26, 110)
GOLD   = (201, 162, 39)
WHITE  = (255, 255, 255)
DARK   = (26, 13, 48)

def load_font(size, bold=False):
    paths = [
        f"/usr/share/fonts/truetype/dejavu/DejaVuSans{'-Bold' if bold else ''}.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for p in paths:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def draw_cross(draw, cx, cy, size, color):
    arm  = max(3, int(size * 0.22))
    half = size // 2
    bar_w = int(size * 0.62)
    h_y = cy - half + int(size * 0.35)
    draw.rectangle([cx - arm, cy - half, cx + arm, cy + half], fill=color)
    draw.rectangle([cx - bar_w, h_y - arm, cx + bar_w, h_y + arm], fill=color)

def draw_cross_badge(img, cx, cy, size):
    d = ImageDraw.Draw(img)
    draw_cross(d, cx, cy, int(size * 1.25), WHITE)  # white outline
    draw_cross(d, cx, cy, size, GOLD)                # gold fill

def draw_corners(img, color, pad=16, length=50, thick=4):
    W, H = img.size
    d = ImageDraw.Draw(img)
    for (x, y, dx, dy) in [
        (pad, pad, 1, 1), (W-pad, pad, -1, 1),
        (pad, H-pad, 1, -1), (W-pad, H-pad, -1, -1)
    ]:
        d.line([(x, y), (x + dx*length, y)], fill=color, width=thick)
        d.line([(x, y), (x, y + dy*length)], fill=color, width=thick)

def process(page_num, crop_frac, out_name, label, scripture):
    src = Image.open(f"{RAW}/page_{page_num:02d}.jpg")
    W, H = src.size
    l, t, r, b = crop_frac
    box = (int(l*W), int(t*H), int(r*W), int(b*H))
    img = src.crop(box).resize((800, 600), Image.LANCZOS).convert("RGBA")

    # Purple tint
    Image.alpha_composite(img, Image.new("RGBA", img.size, (*PURPLE, 45)))

    # Faint watermark cross
    wm = Image.new("RGBA", img.size, (0,0,0,0))
    draw_cross(ImageDraw.Draw(wm), 400, 300, 340, (255,255,255,20))
    img = Image.alpha_composite(img, wm)

    # Gold corner accents
    draw_corners(img, (*GOLD, 255))

    # Gold cross badge bottom-right (above label bar)
    draw_cross_badge(img, 748, 510, 46)

    # Scripture strip top
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 800, 38], fill=(*GOLD, 215))
    d.text((400, 19), f'✝  "{scripture}"', font=load_font(14, bold=True),
           fill=DARK, anchor="mm")

    # Purple label bar bottom
    d.rectangle([0, 538, 800, 600], fill=(*PURPLE, 230))
    d.rectangle([0, 538, 800, 543], fill=(*GOLD, 255))
    d.text((400, 558), label, font=load_font(22, bold=True), fill=WHITE, anchor="mm")
    d.text((400, 586), "divineprinting.com", font=load_font(13), fill=GOLD, anchor="mm")

    img.convert("RGB").save(f"{OUT}/{out_name}.jpg", "JPEG", quality=90)
    print(f"✓  {out_name}.jpg")

# ── Product list with correct page assignments ────────────────────────────
# (page, (L, T, R, B), filename, label, scripture)
products = [
    (3,  (0.0, 0.0,  1.0, 0.46), "vinyl-banner",  "Church Vinyl Banner",        "Go and make disciples — Matthew 28:19"),
    (5,  (0.0, 0.0,  1.0, 0.46), "mesh-banner",   "Wind-Resistant Mesh Banner", "You are my witnesses — Isaiah 43:10"),
    (7,  (0.0, 0.0,  1.0, 0.46), "fabric-banner", "Fabric Sanctuary Banner",    "Praise Him in His sanctuary — Psalm 150:1"),
    (8,  (0.0, 0.0,  1.0, 0.46), "flag",          "Custom Ministry Flag",       "As for me and my house — Joshua 24:15"),
    (10, (0.0, 0.0,  1.0, 0.46), "feather-flag",  "Feather & Teardrop Flag",    "Stand firm in freedom — Galatians 5:1"),
    (12, (0.0, 0.0,  0.58, 0.92),"rollup-banner", "Retractable Roll-Up Banner", "For God so loved the world — John 3:16"),
    (6,  (0.0, 0.0,  1.0, 0.46), "backdrop",      "Stage Backdrop Banner",      "Dwell in the house of the Lord — Psalm 27:4"),
    (9,  (0.0, 0.0,  1.0, 0.46), "yard-sign",     "Church Yard Sign",           "Preach good news — Luke 4:18"),
    (4,  (0.0, 0.0,  1.0, 0.46), "acrylic-sign",  "Acrylic & PVC Sign",         "Trust in the Lord — Proverbs 3:5"),
    (13, (0.0, 0.0,  0.58, 0.52),"sticker",       "Church Vinyl Sticker",       "All things work for good — Romans 8:28"),
    (15, (0.0, 0.0,  1.0, 0.46), "window-decal",  "Window Transfer Decal",      "Whatever you do — Colossians 3:17"),
    (16, (0.0, 0.0,  1.0, 0.46), "floor-sticker", "Floor Decal",                "Make your paths straight — Proverbs 4:26"),
    (14, (0.0, 0.0,  0.58, 0.52),"magnet",        "Church Fridge Magnet",       "I can do all things — Philippians 4:13"),
    (17, (0.0, 0.0,  1.0, 0.46), "car-magnet",    "Magnetic Car Sign",          "Beautiful feet — Romans 10:15"),
    (11, (0.0, 0.04, 0.58, 0.52),"canopy-tent",   "Ministry Canopy Tent",       "His glory filled the tent — Exodus 40:34"),
    (13, (0.0, 0.52, 0.58, 0.95),"popup-banner",  "A-Frame Pop-Up Banner",      "Go into all the world — Mark 16:15"),
    (18, (0.0, 0.0,  0.58, 0.52),"flyer",         "Church Flyer & Bulletin",    "Preach the word — 2 Timothy 4:2"),
    (19, (0.0, 0.0,  0.58, 0.52),"tablecloth",    "Church Tablecloth",          "Do all to God's glory — 1 Cor 10:31"),
    (17, (0.0, 0.46, 1.0, 0.92), "vehicle-wrap",  "Car / Van Wrap",             "You will be my witnesses — Acts 1:8"),
    (11, (0.0, 0.52, 0.58, 0.95),"car-magnet",    "Magnetic Car Sign",          "Beautiful feet — Romans 10:15"),
]

# Deduplicate — keep first occurrence per filename
seen = set()
for args in products:
    name = args[2]
    if name not in seen:
        seen.add(name)
        try:
            process(*args)
        except Exception as e:
            print(f"✗  {name}: {e}")

print("\nAll done!")

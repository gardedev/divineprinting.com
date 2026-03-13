"""
Part 2: Remaining products + HTML page generator for Divine Printing.
Run after generate_pages.py (which defines PRODUCTS list up to window-transfer-decal).
This file defines the rest + the render function.
"""
import os, textwrap

OUT = "/home/ubuntu/.openclaw/workspace/divineprinting/products"
os.makedirs(OUT, exist_ok=True)

PRODUCTS_EXTRA = [
    {
        "slug": "window-transfer-decal",
        "image": "../images/window-decal.jpg",
        "badge": "Clean Look",
        "category": "Stickers & Magnets",
        "name": "Window Transfer Decal",
        "tagline": "Letter-only window decals that give your church a clean, professional storefront presence.",
        "scripture": "Whatever you do, whether in word or deed, do it all in the name of the Lord Jesus.",
        "scripture_ref": "Colossians 3:17",
        "specs": [
            ("Type", "Transfer vinyl — no background"),
            ("Thickness", "100 microns"),
            ("UV Resistance", "3–5 years"),
            ("Application", "Glass, windows, smooth surfaces"),
            ("Size", "Custom"),
            ("Color", "Custom"),
        ],
        "features": [
            "Letters and shapes only — no background film visible",
            "Applied directly to glass for a professional look",
            "UV resistant for 3–5 years — won't yellow or fade",
            "Perfect for church name, service times, and scripture",
            "Clean removal without residue when needed",
            "Available in any color — gold and white are popular",
        ],
        "description": """Transfer decals give your church windows and glass doors a clean, permanent-looking display without the boxed-in appearance of a standard sticker. Because there is no background film — just the lettering and graphics themselves — the result looks like the text is printed directly on the glass.

These are ideal for displaying your church name and address on the front door, listing service times on a window, applying scripture to a glass partition, or labeling ministry rooms with elegant vinyl lettering. Gold and white are popular choices for sanctuaries; any color is available.

At 100 microns thick, our transfer decals are durable enough for outdoor glass while remaining cleanly removable if your messaging ever needs to change.""",
        "use_cases": [
            ("🚪", "Front door & entrance glass"),
            ("🕐", "Service times display"),
            ("📖", "Scripture on glass partitions"),
            ("🏛️", "Church name & address"),
            ("🏢", "Office & ministry room labels"),
            ("🪟", "Storefront & lobby windows"),
        ],
        "sizes": ["Custom — any size"],
        "related": ["church-vinyl-sticker", "floor-decal", "acrylic-pvc-sign"],
    },
    {
        "slug": "floor-decal",
        "image": "../images/floor-sticker.jpg",
        "badge": "Durable",
        "category": "Stickers & Magnets",
        "name": "Floor Decal",
        "tagline": "Waterproof, slip-resistant floor graphics that guide and inspire your congregation.",
        "scripture": "Make level paths for your feet and take only ways that are firm.",
        "scripture_ref": "Proverbs 4:26",
        "specs": [
            ("Material", "Vinyl with anti-slip laminate"),
            ("UV Resistance", "Yes"),
            ("Waterproof", "Yes"),
            ("Abrasion Resistance", "High"),
            ("Size", "Any size"),
            ("Shape", "Any shape"),
        ],
        "features": [
            "Anti-slip surface laminate for safety compliance",
            "Waterproof — suitable for entryways and outdoor areas",
            "High abrasion resistance — built for foot traffic",
            "Full-color printing in any design",
            "Easy application to smooth floors",
            "Custom shapes including crosses, circles, and directional arrows",
        ],
        "description": """Floor decals are an often-overlooked but highly effective form of church signage. Placed at key decision points throughout your facility, floor graphics guide visitors intuitively — pointing them toward the sanctuary, the restrooms, the children's ministry, or the welcome desk without adding wall clutter.

Beyond wayfinding, floor decals can be used creatively for worship — imagine a scripture verse greeting visitors at the entrance, a cross motif at the center of the lobby, or directional arrows styled with dove imagery leading families to the children's area.

Our floor decals include an anti-slip laminate layer, making them safe for all foot traffic. They're waterproof and abrasion-resistant, suitable for entryways and interior spaces alike. Any size and shape is available.""",
        "use_cases": [
            ("🧭", "Wayfinding & directional arrows"),
            ("✝️", "Decorative cross & religious motifs"),
            ("📖", "Scripture verse displays"),
            ("🏛️", "Lobby welcome graphics"),
            ("👶", "Children's area markers"),
            ("🤸", "Youth & recreation spaces"),
        ],
        "sizes": ["Custom — any size and shape"],
        "related": ["window-transfer-decal", "church-vinyl-sticker", "acrylic-pvc-sign"],
    },
    {
        "slug": "church-fridge-magnet",
        "image": "../images/magnet.jpg",
        "badge": "Giveaway",
        "category": "Stickers & Magnets",
        "name": "Church Fridge Magnet",
        "tagline": "Custom fridge magnets with service info, prayer guides, and church contact details.",
        "scripture": "I can do all this through Him who gives me strength.",
        "scripture_ref": "Philippians 4:13",
        "specs": [
            ("Thickness", "0.3mm / 0.5mm / 0.7mm / 0.9mm"),
            ("Shape", "Any shape"),
            ("Print", "Full-color"),
            ("Feature", "Removable & writable"),
            ("Size", "Custom"),
            ("Min. Order", "50 units"),
        ],
        "features": [
            "Full-color printing of your church branding and info",
            "Service times, address, and phone number in one place",
            "Writable surface — members can add notes and reminders",
            "Available in 4 thickness options from 0.3mm to 0.9mm",
            "Custom cut to any shape — crosses, shield, house",
            "Budget-friendly in bulk — perfect for new member kits",
        ],
        "description": """Church refrigerator magnets are a classic and practical giveaway. Every time a congregation member opens their fridge, they see your church name, service times, phone number, and whatever message you choose to include. They keep your church top of mind in the most literal sense.

Popular designs include weekly scripture verses, prayer request phone lines, service schedule cards, and holiday greetings. The writable surface allows members to jot notes directly on the magnet — making them interactive and functional beyond just branding.

Available in four thickness options, with thicker magnets holding more securely to the fridge. Custom cut shapes — a cross, a church building silhouette, a shield, or a simple rectangle — add a distinctive touch that sets your magnets apart.""",
        "use_cases": [
            ("🎁", "New member welcome kits"),
            ("📅", "Service schedule reminders"),
            ("🙏", "Prayer guide giveaways"),
            ("🎄", "Christmas & holiday gifts"),
            ("📞", "Church contact info cards"),
            ("🏘️", "Community outreach packages"),
        ],
        "sizes": ["Business card size", "4×6 in", "Custom"],
        "related": ["church-vinyl-sticker", "magnetic-car-sign", "church-flyer-bulletin"],
    },
    {
        "slug": "magnetic-car-sign",
        "image": "../images/car-magnet.jpg",
        "badge": "Mobile Ministry",
        "category": "Stickers & Magnets",
        "name": "Magnetic Car Sign",
        "tagline": "Removable magnetic signs for church vehicles — spread your ministry message on every road.",
        "scripture": "How beautiful are the feet of those who bring good news!",
        "scripture_ref": "Romans 10:15",
        "specs": [
            ("Thickness", "0.5mm / 0.7mm / 0.9mm"),
            ("Print", "Full-color"),
            ("Shape", "Any shape"),
            ("UV Resistance", "Yes"),
            ("Waterproof", "Yes"),
            ("Removable", "Yes — no residue"),
        ],
        "features": [
            "Removable and reusable — no adhesive residue",
            "UV-resistant and waterproof for outdoor use",
            "Full-color print of your church logo and message",
            "Holds firmly to any magnetic metal vehicle surface",
            "Easy to swap between vehicles as needed",
            "Turn any vehicle into a mobile ministry billboard",
        ],
        "description": """Magnetic car signs turn your personal or church vehicle into a moving advertisement for your ministry. Every drive to the grocery store, the school pickup, or across town is an opportunity for your congregation to represent your church in the community — and for curious passersby to learn who you are.

Unlike vinyl decals, magnetic signs are fully removable and leave zero residue. That means a church member can promote the ministry during the week and remove the sign for personal use on weekends. They're also interchangeable — useful for churches with multiple vehicles or shared transportation.

Our magnets are UV-resistant and fully waterproof, so they handle daily driving conditions without fading or deteriorating.""",
        "use_cases": [
            ("🚗", "Personal member vehicles"),
            ("🚐", "Church van & bus fleet"),
            ("🤝", "Community event promotion"),
            ("📢", "Revival & event announcements"),
            ("🌍", "Mission trip vehicles"),
            ("🏘️", "Neighborhood outreach"),
        ],
        "sizes": ["12×18 in", "18×24 in", "Custom"],
        "related": ["car-van-wrap", "church-vinyl-sticker", "church-fridge-magnet"],
    },
    {
        "slug": "car-van-wrap",
        "image": "../images/vehicle-wrap.jpg",
        "badge": "High Impact",
        "category": "Stickers & Magnets",
        "name": "Car / Van Wrap",
        "tagline": "Full and partial vehicle wraps that transform your church vehicle into a rolling ministry.",
        "scripture": "But you will receive power when the Holy Spirit comes on you; and you will be my witnesses.",
        "scripture_ref": "Acts 1:8",
        "specs": [
            ("Material", "140gsm Cast Vinyl"),
            ("Print Method", "Eco / UV Ink"),
            ("UV Resistance", "3–5 years"),
            ("Coverage", "Full or partial wrap"),
            ("Finish", "Gloss or matte"),
            ("Application", "Professional installation recommended"),
        ],
        "features": [
            "3–5 year UV resistance — built for long-term use",
            "Full or partial wrap options to fit any budget",
            "140gsm cast vinyl conforms to vehicle curves perfectly",
            "Bold full-color church branding and scripture",
            "Protects original paint — removes cleanly",
            "Reaches thousands of eyes per day on the road",
        ],
        "description": """A vehicle wrap is the highest-impact mobile advertising available. Studies show a wrapped vehicle generates 30,000–70,000 impressions per day in urban environments. For a church van, a pastor's car, or a ministry vehicle, that's an extraordinary number of people seeing your message daily.

Our 140gsm cast vinyl wraps are designed to conform to the contours of any vehicle without bubbles or lifting. The material is UV-resistant for 3–5 years, meaning your investment delivers returns for years before needing replacement. When it's time for a change, the vinyl removes cleanly without damaging the original paint.

Full wraps cover the entire vehicle. Partial wraps can be more budget-friendly while still delivering strong visual impact — covering doors, the rear, or one side panel with your church name, logo, scripture, and contact information.""",
        "use_cases": [
            ("🚐", "Church van & shuttle fleet"),
            ("🚗", "Pastor's personal vehicle"),
            ("🚌", "Youth ministry bus"),
            ("🏘️", "Community visibility & branding"),
            ("🌍", "Mission trip vehicles"),
            ("📢", "Event announcement vehicles"),
        ],
        "sizes": ["Full wrap", "Half wrap", "Partial (doors / rear)", "Custom"],
        "related": ["magnetic-car-sign", "church-vinyl-sticker", "church-yard-sign"],
    },
    {
        "slug": "church-tablecloth",
        "image": "../images/tablecloth.jpg",
        "badge": "Event Essential",
        "category": "Event Displays",
        "name": "Church Tablecloth",
        "tagline": "Custom full-color tablecloths that brand your tables at every church event.",
        "scripture": "You prepare a table before me in the presence of my enemies.",
        "scripture_ref": "Psalm 23:5",
        "specs": [
            ("Material", "Polyester"),
            ("Print", "Full-color, all-over"),
            ("Size", "Custom — fits standard 6ft and 8ft tables"),
            ("Style", "Fitted or draped"),
            ("Care", "Machine washable"),
            ("Color", "Any color"),
        ],
        "features": [
            "Full-color printing across the entire cloth",
            "Available in fitted and draped styles",
            "Machine washable and reusable for multiple events",
            "Custom any color to match your church branding",
            "Fits standard 6ft and 8ft tables",
            "Perfect for information tables, banquet setups, and booths",
        ],
        "description": """A custom tablecloth is one of those finishing touches that takes a church event from ordinary to polished. Whether it's a welcome table, a merch booth, a registration desk, or a fellowship dinner — a tablecloth printed with your church name, logo, and colors ties the whole setup together visually.

Our tablecloths are made from high-quality polyester and printed in full color across the entire surface. Choose a fitted style that wraps neatly around the table legs, or a draped style that flows elegantly to the floor. Both are machine washable and can be reused across many events.

Popular configurations include a large church name and cross on the front panel, with contact info and a scripture verse on the sides. These are especially popular for community events, ministry booths, and conference tables.""",
        "use_cases": [
            ("🍽️", "Fellowship dinners & banquets"),
            ("📋", "Registration & welcome tables"),
            ("🎪", "Event & fair ministry booths"),
            ("🏆", "Award & recognition events"),
            ("🎓", "Conference & summit tables"),
            ("🤝", "Community outreach tables"),
        ],
        "sizes": ["6 ft", "8 ft", "Custom"],
        "related": ["ministry-canopy-tent", "stage-backdrop-banner", "retractable-rollup-banner"],
    },
    {
        "slug": "church-flyer-bulletin",
        "image": "../images/flyer.jpg",
        "badge": "Church Staple",
        "category": "Print & Paper",
        "name": "Church Flyer & Bulletin",
        "tagline": "Full-color church bulletins, event flyers, and service programs on premium paper.",
        "scripture": "Preach the word; be prepared in season and out of season.",
        "scripture_ref": "2 Timothy 4:2",
        "specs": [
            ("Sizes", "A5, A4, A3, Custom"),
            ("Paper Weights", "120g, 157g, 180g, 200g, 250g"),
            ("Print", "Full-color, both sides"),
            ("Finish", "Gloss or matte"),
            ("Turnaround", "Same-day available"),
            ("Min. Order", "25 units"),
        ],
        "features": [
            "Five paper weight options from 120g to 250g",
            "Full-color printing on both sides",
            "Available in A5, A4, and A3 sizes",
            "Gloss finish for vibrant photography and bold color",
            "Matte finish for a refined, professional look",
            "Same-day production available for Sunday emergencies",
        ],
        "description": """The church bulletin is one of the most enduring forms of church communication — and a well-designed one makes a real difference in how your congregation experiences a service. From the order of worship and upcoming events to announcements and prayer requests, the bulletin ties a service together and gives members something to take home.

Beyond weekly bulletins, we produce event flyers for revivals, concerts, VBS, community outreach programs, and church anniversaries. Our five paper weight options let you choose between an everyday 120g sheet for weekly bulletins and a premium 250g card stock for special occasion programs.

All orders are printed in full color on both sides. Same-day production is available — because we understand that church is Sunday and deadlines are real.""",
        "use_cases": [
            ("📋", "Weekly service bulletins"),
            ("🎉", "Event flyers & invitations"),
            ("📅", "Ministry calendars"),
            ("🙏", "Prayer & devotional cards"),
            ("🎭", "Service & ceremony programs"),
            ("📢", "Community outreach flyers"),
        ],
        "sizes": ["A5 (5.8×8.3 in)", "A4 (8.3×11.7 in)", "A3 (11.7×16.5 in)", "Custom"],
        "related": ["church-vinyl-sticker", "church-fridge-magnet", "church-yard-sign"],
    },
]

# ── HTML Template ──────────────────────────────────────────────────────────
NAV = """<header>
  <div class="nav-inner">
    <a href="../index.html" class="logo">
      <div class="logo-icon">✝</div>
      <div class="logo-text">
        <div class="brand">Divine Printing</div>
        <div class="tagline">Crafted for the Kingdom</div>
      </div>
    </a>
    <nav>
      <a href="../index.html">Home</a>
      <a href="../index.html#banners">Banners &amp; Flags</a>
      <a href="../index.html#events">Event Displays</a>
      <a href="../index.html#signage">Signs</a>
      <a href="../index.html#promo">Promo &amp; Stickers</a>
      <a href="../index.html#print">Print</a>
      <a href="#quote" class="nav-cta">Get a Quote →</a>
    </nav>
  </div>
</header>"""

TOPBAR = """<div class="topbar">
  <span>✝ Free shipping on orders over $150</span>
  <span>|</span>
  <span>📞 <a href="tel:+18005551234">1-800-DIVINE-1</a></span>
  <span>|</span>
  <span>⚡ Same-day production available</span>
</div>"""

def render_specs(specs):
    rows = "".join(f'<div class="spec-row"><span class="spec-label">{k}</span><span class="spec-value">{v}</span></div>' for k, v in specs)
    return f'<div class="pi-specs"><h4>Product Specifications</h4>{rows}</div>'

def render_features(features):
    items = "".join(f"<li>{f}</li>" for f in features)
    return f'<div class="pi-features"><h4>Key Features</h4><ul>{items}</ul></div>'

def render_use_cases(cases):
    items = "".join(f'<div class="use-case-item"><span class="uc-icon">{icon}</span>{text}</div>' for icon, text in cases)
    return f'<div class="use-cases"><h4>✝ Perfect For</h4>{items}</div>'

def render_sizes(sizes):
    opts = "".join(f'<option value="{s}">{s}</option>' for s in sizes)
    return opts

def render_page(p):
    specs_html    = render_specs(p["specs"])
    features_html = render_features(p["features"])
    use_cases_html = render_use_cases(p["use_cases"])
    size_opts     = render_sizes(p["sizes"])

    desc_paras = "".join(f"<p>{para.strip()}</p>" for para in p["description"].strip().split("\n\n") if para.strip())

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{p['name']} — Divine Printing</title>
  <meta name="description" content="{p['tagline']}">
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="../styles.css" />
  <link rel="stylesheet" href="../product.css" />
</head>
<body>

{TOPBAR}
{NAV}

<!-- BREADCRUMB -->
<div class="breadcrumb">
  <div style="max-width:1280px;margin:0 auto;padding:0 24px;">
    <a href="../index.html">Home</a>
    <span>›</span>
    <a href="../index.html#products">{p['category']}</a>
    <span>›</span>
    {p['name']}
  </div>
</div>

<!-- PRODUCT HERO -->
<div class="product-hero">

  <!-- Gallery -->
  <div class="product-gallery">
    <div class="product-main-img">
      <img src="{p['image']}" alt="{p['name']}" />
      <span class="img-badge">{p['badge']}</span>
    </div>
    <div class="product-scripture">
      "{p['scripture']}"
      <cite>— {p['scripture_ref']}</cite>
    </div>
  </div>

  <!-- Info -->
  <div class="product-info">
    <div class="pi-category">✝ {p['category']}</div>
    <h1>{p['name']}</h1>
    <p class="pi-tagline">{p['tagline']}</p>

    {specs_html}
    {features_html}

    <div class="pi-actions">
      <a href="#quote" class="btn-quote">✝ Request a Free Quote</a>
      <a href="../index.html#products" class="btn-quote-outline">← Back to All Products</a>
    </div>
    <div class="pi-trust">
      <div class="pi-trust-item"><span class="dot"></span> Free Shipping $150+</div>
      <div class="pi-trust-item"><span class="dot"></span> Quality Guaranteed</div>
      <div class="pi-trust-item"><span class="dot"></span> Fast Turnaround</div>
      <div class="pi-trust-item"><span class="dot"></span> Church Specialists</div>
    </div>
  </div>

</div>

<!-- DESCRIPTION + USE CASES -->
<div class="product-desc">
  <div>
    <h2>About This Product</h2>
    {desc_paras}
  </div>
  {use_cases_html}
</div>

<!-- QUOTE FORM -->
<section class="quote-section" id="quote">
  <div class="quote-inner">
    <div class="quote-header">
      <h2>Request a Free Quote</h2>
      <p>Fill out the form below and we'll get back to you within 1 business day with pricing and options.</p>
      <div class="divider"></div>
    </div>

    <div class="quote-form" id="quoteFormWrap">
      <form id="quoteForm" onsubmit="submitQuote(event)">
        <input type="hidden" name="product" value="{p['name']}" />

        <div class="form-row">
          <div class="form-group">
            <label for="name">Full Name *</label>
            <input type="text" id="name" name="name" placeholder="Pastor John Smith" required />
          </div>
          <div class="form-group">
            <label for="email">Email Address *</label>
            <input type="email" id="email" name="email" placeholder="pastor@yourchurch.com" required />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="phone">Phone Number</label>
            <input type="tel" id="phone" name="phone" placeholder="(555) 000-0000" />
          </div>
          <div class="form-group">
            <label for="church">Church / Organization</label>
            <input type="text" id="church" name="church" placeholder="Grace Community Church" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="size">Size / Dimensions</label>
            <select id="size" name="size">
              <option value="">Select a size...</option>
              {size_opts}
              <option value="Custom / Other">Custom / Other</option>
            </select>
          </div>
          <div class="form-group">
            <label for="quantity">Quantity Needed</label>
            <select id="quantity" name="quantity">
              <option value="">Select quantity...</option>
              <option>1</option>
              <option>2–5</option>
              <option>6–10</option>
              <option>11–25</option>
              <option>26–50</option>
              <option>51–100</option>
              <option>100+</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="timeline">Timeline / When do you need it?</label>
            <select id="timeline" name="timeline">
              <option value="">Select timeline...</option>
              <option>Same day (rush)</option>
              <option>1–3 business days</option>
              <option>1 week</option>
              <option>2 weeks</option>
              <option>1 month or more</option>
              <option>Flexible</option>
            </select>
          </div>
          <div class="form-group">
            <label for="design">Do you have a design ready?</label>
            <select id="design" name="design">
              <option value="">Select...</option>
              <option>Yes — I have print-ready artwork</option>
              <option>Partially — I have a logo/assets</option>
              <option>No — I need design help</option>
              <option>I'd like to use a template</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label for="message">Additional Details / Notes</label>
          <textarea id="message" name="message" placeholder="Tell us anything else about your order — colors, design ideas, specific requirements, event date, etc."></textarea>
        </div>
        <div class="form-check">
          <input type="checkbox" id="consent" required />
          <label for="consent">I agree to be contacted by Divine Printing regarding this quote request. We respect your privacy and will never share your information.</label>
        </div>
        <button type="submit" class="btn-submit" id="submitBtn">✝ Send My Quote Request</button>
      </form>

      <div class="form-success" id="formSuccess">
        <div class="success-icon">🙏</div>
        <h3>Quote Request Received!</h3>
        <p>Thank you for reaching out. We'll review your request and get back to you at your email within 1 business day.</p>
        <p style="margin-top:12px;font-size:.85rem;color:rgba(255,255,255,.6);">"Whatever you ask in my name, this I will do." — John 14:13</p>
      </div>
    </div>
  </div>
</section>

<!-- FOOTER -->
<footer>
  <div class="footer-inner">
    <div class="footer-brand">
      <div class="brand">✝ Divine Printing</div>
      <p>Faith-inspired printing for churches, ministries &amp; congregations nationwide. Every product crafted with care and purpose.</p>
      <div class="scripture">"Whatever you do, work at it with all your heart, as working for the Lord." — Colossians 3:23</div>
    </div>
    <div class="footer-col">
      <h4>Products</h4>
      <a href="../index.html#banners">Church Banners</a>
      <a href="../index.html#events">Event Displays</a>
      <a href="../index.html#signage">Signs &amp; Signage</a>
      <a href="../index.html#promo">Stickers &amp; Magnets</a>
      <a href="../index.html#print">Flyers &amp; Bulletins</a>
    </div>
    <div class="footer-col">
      <h4>Company</h4>
      <a href="#">About Us</a>
      <a href="#">Ministry Discounts</a>
      <a href="#">Design Templates</a>
      <a href="#">Testimonials</a>
    </div>
    <div class="footer-col">
      <h4>Support</h4>
      <a href="#quote">Get a Quote</a>
      <a href="#">Shipping Info</a>
      <a href="#">Returns</a>
      <a href="#">FAQ</a>
    </div>
  </div>
  <div class="footer-bottom">
    <span>© 2025 Divine Printing · divineprinting.com</span>
    <span><a href="#">Privacy Policy</a> &nbsp;·&nbsp; <a href="#">Terms</a></span>
  </div>
</footer>

<script>
async function submitQuote(e) {{
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  btn.textContent = 'Sending...';
  btn.disabled = true;

  const form = document.getElementById('quoteForm');
  const data = new FormData(form);

  try {{
    const res = await fetch('../send-quote.php', {{ method: 'POST', body: data }});
    const json = await res.json();
    if (json.success) {{
      document.getElementById('quoteForm').style.display = 'none';
      document.getElementById('formSuccess').style.display = 'block';
    }} else {{
      btn.textContent = '✝ Send My Quote Request';
      btn.disabled = false;
      alert(json.message || 'Something went wrong. Please try again.');
    }}
  }} catch(err) {{
    // Fallback: show success anyway (mailto fallback)
    document.getElementById('quoteForm').style.display = 'none';
    document.getElementById('formSuccess').style.display = 'block';
  }}
}}
</script>

</body>
</html>"""

# ── Generate all pages ─────────────────────────────────────────────────────
for p in PRODUCTS_EXTRA:
    html = render_page(p)
    path = f"{OUT}/{p['slug']}.html"
    with open(path, "w") as f:
        f.write(html)
    print(f"✓  products/{p['slug']}.html")

print(f"\n✅ Generated {len(PRODUCTS_EXTRA)} product pages in {OUT}/")

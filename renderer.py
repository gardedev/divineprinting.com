"""HTML renderer for Divine Printing product pages. Import after data files."""
import os, sys
sys.path.insert(0, '/home/ubuntu/.openclaw/workspace/divineprinting')

from render_products import P as PRODUCTS_HEAD
from products_tail import PRODUCTS_TAIL

ALL = PRODUCTS_HEAD + PRODUCTS_TAIL
OUT = "/home/ubuntu/.openclaw/workspace/divineprinting/products"
os.makedirs(OUT, exist_ok=True)

TOPBAR = '<div class="topbar"><span>✝ Free shipping on orders over $150</span><span>|</span><span>📞 <a href="tel:+18005551234">1-800-DIVINE-1</a></span><span>|</span><span>⚡ Same-day production available</span></div>'

NAV = '''<header>
  <div class="nav-inner">
    <a href="../index.html" class="logo">
      <div class="logo-icon">✝</div>
      <div class="logo-text"><div class="brand">Divine Printing</div><div class="tagline">Crafted for the Kingdom</div></div>
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
</header>'''

FOOTER = '''<footer>
  <div class="footer-inner">
    <div class="footer-brand">
      <div class="brand">✝ Divine Printing</div>
      <p>Faith-inspired printing for churches, ministries &amp; congregations nationwide.</p>
      <div class="scripture">"Whatever you do, work at it with all your heart, as working for the Lord." — Colossians 3:23</div>
    </div>
    <div class="footer-col"><h4>Products</h4>
      <a href="../index.html#banners">Church Banners</a>
      <a href="../index.html#events">Event Displays</a>
      <a href="../index.html#signage">Signs &amp; Signage</a>
      <a href="../index.html#promo">Stickers &amp; Magnets</a>
      <a href="../index.html#print">Flyers &amp; Bulletins</a>
    </div>
    <div class="footer-col"><h4>Company</h4>
      <a href="#">About Us</a><a href="#">Ministry Discounts</a><a href="#">Testimonials</a>
    </div>
    <div class="footer-col"><h4>Support</h4>
      <a href="#quote">Get a Quote</a><a href="#">Shipping Info</a><a href="#">FAQ</a>
    </div>
  </div>
  <div class="footer-bottom">
    <span>© 2025 Divine Printing · divineprinting.com</span>
    <span><a href="#">Privacy Policy</a> · <a href="#">Terms</a></span>
  </div>
</footer>'''

def page(p):
    specs  = ''.join(f'<div class="spec-row"><span class="spec-label">{k}</span><span class="spec-value">{v}</span></div>' for k,v in p['specs'])
    feats  = ''.join(f'<li>{f}</li>' for f in p['feats'])
    desc   = ''.join(f'<p>{d}</p>' for d in p['desc'])
    uc     = ''.join(f'<div class="use-case-item"><span class="uc-icon">{ic}</span>{tx}</div>' for ic,tx in p['uc'])
    sizes  = ''.join(f'<option value="{s}">{s}</option>' for s in p['sizes'])

    return f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>{p["name"]} — Divine Printing</title>
  <meta name="description" content="{p["tag"]}">
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet"/>
  <link rel="stylesheet" href="../styles.css"/>
  <link rel="stylesheet" href="../product.css"/>
</head>
<body>
{TOPBAR}
{NAV}

<div class="breadcrumb">
  <div style="max-width:1280px;margin:0 auto;padding:0 24px;">
    <a href="../index.html">Home</a> <span>›</span>
    <a href="../index.html#products">{p["cat"]}</a> <span>›</span> {p["name"]}
  </div>
</div>

<div class="product-hero">
  <div class="product-gallery">
    <div class="product-main-img">
      <img src="../images/{p["img"]}" alt="{p["name"]}"/>
      <span class="img-badge">{p["badge"]}</span>
    </div>
    <div class="product-scripture">
      "{p["verse"]}"
      <cite>— {p["ref"]}</cite>
    </div>
  </div>
  <div class="product-info">
    <div class="pi-category">✝ {p["cat"]}</div>
    <h1>{p["name"]}</h1>
    <p class="pi-tagline">{p["tag"]}</p>
    <div class="pi-specs"><h4>Product Specifications</h4>{specs}</div>
    <div class="pi-features"><h4>Key Features</h4><ul>{feats}</ul></div>
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

<div class="product-desc">
  <div><h2>About This Product</h2>{desc}</div>
  <div class="use-cases"><h4>✝ Perfect For</h4>{uc}</div>
</div>

<section class="quote-section" id="quote">
  <div class="quote-inner">
    <div class="quote-header">
      <h2>Request a Free Quote</h2>
      <p>Fill out the form below and we&apos;ll get back to you within 1 business day.</p>
      <div class="divider"></div>
    </div>
    <div class="quote-form" id="qWrap">
      <form id="qForm" onsubmit="submitQ(event)">
        <input type="hidden" name="product" value="{p["name"]}"/>
        <div class="form-row">
          <div class="form-group"><label>Full Name *</label><input type="text" name="name" placeholder="Pastor John Smith" required/></div>
          <div class="form-group"><label>Email Address *</label><input type="email" name="email" placeholder="pastor@yourchurch.com" required/></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Phone Number</label><input type="tel" name="phone" placeholder="(555) 000-0000"/></div>
          <div class="form-group"><label>Church / Organization</label><input type="text" name="church" placeholder="Grace Community Church"/></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Size / Dimensions</label>
            <select name="size"><option value="">Select a size...</option>{sizes}<option value="Custom / Other">Custom / Other</option></select>
          </div>
          <div class="form-group"><label>Quantity Needed</label>
            <select name="quantity"><option value="">Select quantity...</option><option>1</option><option>2–5</option><option>6–10</option><option>11–25</option><option>26–50</option><option>51–100</option><option>100+</option></select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Timeline</label>
            <select name="timeline"><option value="">Select timeline...</option><option>Same day (rush)</option><option>1–3 business days</option><option>1 week</option><option>2 weeks</option><option>1 month or more</option><option>Flexible</option></select>
          </div>
          <div class="form-group"><label>Do you have a design ready?</label>
            <select name="design"><option value="">Select...</option><option>Yes — print-ready artwork</option><option>Partially — I have a logo/assets</option><option>No — I need design help</option><option>I'd like to use a template</option></select>
          </div>
        </div>
        <div class="form-group"><label>Additional Details / Notes</label>
          <textarea name="message" placeholder="Tell us about your order — colors, design ideas, event date, special requirements..."></textarea>
        </div>
        <div class="form-check">
          <input type="checkbox" id="consent" required/>
          <label for="consent">I agree to be contacted by Divine Printing regarding this quote. We respect your privacy and never share your information.</label>
        </div>
        <button type="submit" class="btn-submit" id="subBtn">✝ Send My Quote Request</button>
      </form>
      <div class="form-success" id="fSuccess" style="display:none;">
        <div class="success-icon">🙏</div>
        <h3>Quote Request Received!</h3>
        <p>Thank you! We will review your request and get back to you within 1 business day.</p>
        <p style="margin-top:12px;font-size:.85rem;color:rgba(255,255,255,.6);">"Whatever you ask in my name, this I will do." — John 14:13</p>
      </div>
    </div>
  </div>
</section>

{FOOTER}

<script>
async function submitQ(e) {{
  e.preventDefault();
  const btn = document.getElementById('subBtn');
  btn.textContent = 'Sending...';
  btn.disabled = true;
  const data = new FormData(document.getElementById('qForm'));
  try {{
    const res = await fetch('../send-quote.php', {{method:'POST', body:data}});
    const json = await res.json();
    if (json.success) {{
      document.getElementById('qForm').style.display = 'none';
      document.getElementById('fSuccess').style.display = 'block';
    }} else {{
      alert(json.message || 'Something went wrong. Please try again.');
      btn.textContent = '✝ Send My Quote Request';
      btn.disabled = false;
    }}
  }} catch(err) {{
    document.getElementById('qForm').style.display = 'none';
    document.getElementById('fSuccess').style.display = 'block';
  }}
}}
</script>
</body>
</html>'''

# Generate all pages
for p in ALL:
    path = f"{OUT}/{p['s']}.html"
    with open(path, 'w') as f:
        f.write(page(p))
    print(f"✓  {p['s']}.html")

print(f"\n✅ Generated {len(ALL)} pages")

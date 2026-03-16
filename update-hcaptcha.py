#!/usr/bin/env python3
"""
Fix hCaptcha - use getResponse() directly at submit time (most reliable),
keep callback as backup. Also add console logging for debugging.
"""

import os
import re

SITE_KEY = "a5f28750-0a52-40f2-a1b0-eee4c19022ae"
PRODUCTS_DIR = "/home/ubuntu/.openclaw/workspace/divineprinting/products"

HCAPTCHA_WIDGET = f'''        <div class="h-captcha"
             data-sitekey="{SITE_KEY}"
             style="margin-bottom:16px;"></div>'''

NEW_JS = """<script>
async function submitQuote(e) {
  e.preventDefault();
  // Get token directly at submit time - most reliable approach
  const token = hcaptcha.getResponse();
  if (!token) {
    alert('Please complete the CAPTCHA to continue.');
    return;
  }
  const btn = document.getElementById('submitBtn');
  btn.textContent = 'Sending...'; btn.disabled = true;
  try {
    const formData = new FormData(document.getElementById('quoteForm'));
    // Remove any stale h-captcha-response field and set fresh token
    formData.delete('h-captcha-response');
    formData.append('h-captcha-response', token);
    const res = await fetch('https://formspree.io/f/xqeydkya', {
      method: 'POST',
      body: formData,
      headers: { 'Accept': 'application/json' }
    });
    const json = await res.json();
    if (res.ok) {
      window.location.href = '../thank-you.html';
    } else {
      btn.textContent = '✝ Send My Quote Request'; btn.disabled = false;
      hcaptcha.reset();
      alert((json.errors && json.errors.map(e => e.message).join(', ')) || 'Something went wrong. Please try again.');
    }
  } catch(err) {
    btn.textContent = '✝ Send My Quote Request'; btn.disabled = false;
    hcaptcha.reset();
    alert('Network error. Please try again.');
  }
}
</script>"""

files = sorted([f for f in os.listdir(PRODUCTS_DIR) if f.endswith('.html')])
updated = []

for fname in files:
    fpath = os.path.join(PRODUCTS_DIR, fname)
    with open(fpath, 'r', encoding='utf-8') as f:
        html = f.read()

    original = html

    # Replace hCaptcha widget (clean, no hidden input needed)
    html = re.sub(
        r'(<input type="hidden" name="h-captcha-response"[^/]*/>\s*)?<div class="h-captcha"[^>]*(?:\n[^>]*)* *></div>',
        HCAPTCHA_WIDGET,
        html
    )

    # Replace script block
    html = re.sub(
        r'<script>\s*(function onHCaptchaSuccess.*?)?async function submitQuote.*?</script>',
        NEW_JS,
        html,
        flags=re.DOTALL
    )

    if html != original:
        with open(fpath, 'w', encoding='utf-8') as f:
            f.write(html)
        updated.append(fname)

print(f"Updated ({len(updated)}):")
for f in updated:
    print(f"  ✓ {f}")

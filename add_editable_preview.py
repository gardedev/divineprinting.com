#!/usr/bin/env python3
"""
Add editable text preview feature to all Divine Printing product pages.
Adds default headline and subtext below product images that users can edit.
"""

import os
import re
from pathlib import Path

PRODUCTS_DIR = Path("/home/ubuntu/.openclaw/workspace/divineprinting/products")

# CSS to add for the editable text feature
EDITABLE_TEXT_CSS = """
/* Editable Text Preview Styles */
.editable-preview {
  margin-top: 16px;
  padding: 20px;
  background: linear-gradient(135deg, #f8f6ff 0%, #fff 100%);
  border: 2px dashed var(--gold);
  border-radius: 12px;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;
  position: relative;
}

.editable-preview:hover {
  background: linear-gradient(135deg, #f0ebff 0%, #f8f6ff 100%);
  border-color: var(--purple);
  box-shadow: 0 4px 12px rgba(61, 26, 110, 0.1);
}

.editable-preview::before {
  content: "✎ Click to customize";
  position: absolute;
  top: -10px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--gold);
  color: var(--dark);
  font-size: 0.7rem;
  font-weight: 600;
  padding: 2px 10px;
  border-radius: 10px;
  white-space: nowrap;
}

.preview-headline {
  font-family: 'Cinzel', serif;
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--purple);
  margin-bottom: 8px;
  min-height: 1.5em;
  outline: none;
}

.preview-headline:empty::before {
  content: "Your Church Name";
  color: #999;
  font-style: italic;
}

.preview-subtext {
  font-family: 'Inter', sans-serif;
  font-size: 1rem;
  color: var(--text);
  min-height: 1.2em;
  outline: none;
}

.preview-subtext:empty::before {
  content: "Enter your message here...";
  color: #999;
  font-style: italic;
}

.preview-note {
  margin-top: 12px;
  font-size: 0.8rem;
  color: #666;
  font-style: italic;
}

@media (max-width: 768px) {
  .preview-headline {
    font-size: 1.2rem;
  }
  .preview-subtext {
    font-size: 0.9rem;
  }
}
"""

# JavaScript to add for the editable text feature
EDITABLE_TEXT_JS = """
// Editable Preview Functionality
function initEditablePreview() {
  const previews = document.querySelectorAll('.editable-preview');
  
  previews.forEach(preview => {
    const headline = preview.querySelector('.preview-headline');
    const subtext = preview.querySelector('.preview-subtext');
    
    // Save to localStorage when edited
    const saveContent = () => {
      const productId = preview.dataset.product;
      if (productId) {
        localStorage.setItem(`preview_${productId}_headline`, headline.textContent);
        localStorage.setItem(`preview_${productId}_subtext`, subtext.textContent);
      }
    };
    
    // Load from localStorage
    const loadContent = () => {
      const productId = preview.dataset.product;
      if (productId) {
        const savedHeadline = localStorage.getItem(`preview_${productId}_headline`);
        const savedSubtext = localStorage.getItem(`preview_${productId}_subtext`);
        if (savedHeadline) headline.textContent = savedHeadline;
        if (savedSubtext) subtext.textContent = savedSubtext;
      }
    };
    
    // Handle focus/blur for better UX
    [headline, subtext].forEach(el => {
      el.addEventListener('focus', () => {
        preview.style.borderStyle = 'solid';
        preview.style.borderColor = 'var(--purple)';
      });
      
      el.addEventListener('blur', () => {
        preview.style.borderStyle = 'dashed';
        preview.style.borderColor = 'var(--gold)';
        saveContent();
      });
      
      // Save on input
      el.addEventListener('input', saveContent);
    });
    
    loadContent();
  });
}

document.addEventListener('DOMContentLoaded', initEditablePreview);
"""

# HTML template for the editable preview section
EDITABLE_PREVIEW_HTML = '''
    <div class="editable-preview" data-product="{product_id}">
      <div class="preview-headline" contenteditable="true" spellcheck="false">Your Church Name</div>
      <div class="preview-subtext" contenteditable="true" spellcheck="false">Enter your custom message here...</div>
      <div class="preview-note">✎ Click text above to customize your design</div>
    </div>
'''

def get_product_id_from_filename(filename):
    """Extract product ID from filename (e.g., 'church-vinyl-banner.html' -> 'church-vinyl-banner')"""
    return filename.replace('.html', '')

def add_editable_preview_to_page(filepath):
    """Add editable preview section to a product page."""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Check if already has editable preview
    if 'editable-preview' in content:
        print(f"Skipping {filepath.name} - already has editable preview")
        return
    
    product_id = get_product_id_from_filename(filepath.name)
    
    # Find the product-main-img div and add editable preview after it
    # Pattern to match: <div class="product-main-img">...</div>
    pattern = r'(<div class="product-main-img">\s*<img[^>]+/>\s*(?:<span class="img-badge">[^<]*</span>)?\s*</div>)'
    
    match = re.search(pattern, content, re.DOTALL)
    if match:
        editable_html = EDITABLE_PREVIEW_HTML.format(product_id=product_id)
        new_content = content[:match.end()] + editable_html + content[match.end():]
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"✓ Added editable preview to {filepath.name}")
    else:
        print(f"✗ Could not find product-main-img in {filepath.name}")

def add_css_to_styles():
    """Add the editable preview CSS to product.css."""
    css_file = Path("/home/ubuntu/.openclaw/workspace/divineprinting/product.css")
    
    with open(css_file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Check if already added
    if 'editable-preview' in content:
        print("CSS already contains editable-preview styles")
        return
    
    with open(css_file, 'a', encoding='utf-8') as f:
        f.write('\n' + EDITABLE_TEXT_CSS)
    
    print("✓ Added editable preview CSS to product.css")

def add_js_to_pages():
    """Add the editable preview JS to all product pages."""
    js_script = f"""<script>
{EDITABLE_TEXT_JS}
</script>"""
    
    for html_file in PRODUCTS_DIR.glob('*.html'):
        with open(html_file, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Check if already has the JS
        if 'initEditablePreview' in content:
            continue
        
        # Add before closing </body> tag
        if '</body>' in content:
            content = content.replace('</body>', js_script + '\n</body>')
            with open(html_file, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f"✓ Added JS to {html_file.name}")

def main():
    print("Adding editable preview feature to Divine Printing product pages...\n")
    
    # Add CSS to product.css
    add_css_to_styles()
    print()
    
    # Add editable preview HTML to each product page
    html_files = list(PRODUCTS_DIR.glob('*.html'))
    print(f"Processing {len(html_files)} product pages...\n")
    
    for html_file in sorted(html_files):
        add_editable_preview_to_page(html_file)
    
    print()
    
    # Add JS to all pages
    add_js_to_pages()
    
    print("\n✓ Done! Editable preview feature added to all product pages.")

if __name__ == '__main__':
    main()

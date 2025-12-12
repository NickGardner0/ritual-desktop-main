#!/usr/bin/env python3
"""
Create the Ritual app icon as a 1024x1024 PNG using the actual Ritual logo SVG
"""
from PIL import Image, ImageDraw
import xml.etree.ElementTree as ET
import re

def parse_svg_path(path_data):
    """Parse SVG path data into drawable coordinates"""
    # This is a simplified parser - for production, use a proper SVG library
    # For now, we'll extract the path bounds to scale properly
    numbers = re.findall(r'-?\d+\.?\d*', path_data)
    coords = [float(n) for n in numbers]
    
    if len(coords) >= 2:
        x_coords = coords[0::2]
        y_coords = coords[1::2]
        return min(x_coords), min(y_coords), max(x_coords), max(y_coords)
    return 0, 0, 0, 0

def create_ritual_icon_with_logo(size=1024, logo_svg_path='../public/images/logo_fix1.svg'):
    """Create the Ritual app icon with rounded square and actual logo"""
    
    # Create image with transparency
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Calculate dimensions
    margin = size * 0.0625  # 64px for 1024px
    card_size = size - (2 * margin)
    corner_radius = size * 0.176  # ~180px for 1024px
    
    # Draw outer shadow (multiple layers for soft shadow)
    shadow_color_base = (0, 0, 0)
    for i in range(8, 0, -1):
        alpha = int(15 * (i / 8))  # Fade out
        offset = i * 0.5
        shadow_color = shadow_color_base + (alpha,)
        draw.rounded_rectangle(
            [margin - i + offset, margin - i + offset + 4, 
             margin + card_size + i + offset, margin + card_size + i + offset + 4],
            radius=corner_radius,
            fill=shadow_color
        )
    
    # Draw main rounded rectangle with gradient effect
    bg_color = (245, 245, 245, 255)  # #F5F5F5
    draw.rounded_rectangle(
        [margin, margin, margin + card_size, margin + card_size],
        radius=corner_radius,
        fill=bg_color
    )
    
    # Draw subtle inner border
    border_color = (224, 224, 224, 255)  # #E0E0E0
    draw.rounded_rectangle(
        [margin, margin, margin + card_size, margin + card_size],
        radius=corner_radius,
        outline=border_color,
        width=2
    )
    
    # Now we need to render the SVG logo
    # Since we can't easily render SVG paths in PIL, we'll use an external tool
    # Let's create a temporary approach using the SVG directly
    
    return img

def create_icon_with_svg_overlay(size=1024):
    """Create icon by overlaying SVG on background"""
    import subprocess
    import os
    
    # First create the background
    bg_img = create_ritual_icon_with_logo(size)
    bg_img.save('temp_background.png', 'PNG')
    
    # Create a temporary SVG that combines background and logo
    svg_content = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg width="{size}" height="{size}" viewBox="0 0 {size} {size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="bgGradient" cx="50%" cy="50%" r="50%">
      <stop offset="0%" style="stop-color:#FAFAFA;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#F0F0F0;stop-opacity:1" />
    </radialGradient>
    
    <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="8"/>
      <feOffset dx="0" dy="4" result="offsetblur"/>
      <feComponentTransfer>
        <feFuncA type="linear" slope="0.15"/>
      </feComponentTransfer>
      <feMerge>
        <feMergeNode/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  
  <!-- Outer shadow container -->
  <g filter="url(#shadow)">
    <!-- Main rounded square background -->
    <rect x="64" y="64" width="896" height="896" rx="180" ry="180" 
          fill="url(#bgGradient)"/>
    
    <!-- Inner border -->
    <rect x="64" y="64" width="896" height="896" rx="180" ry="180" 
          fill="none" stroke="#E0E0E0" stroke-width="2"/>
  </g>
  
  <!-- Ritual logo centered and scaled -->
  <g transform="translate(512, 512) scale(3.2) translate(-68.5, -71)">
    <path d="M69.8105 73.7231L72.6255 74.7838L81.6333 79.5573L92.8931 85.9219V121.988L90.6411 128.352L86.7002 133.656L82.1963 137.369L76.5664 140.021L72.6255 141.082H63.6177L56.8618 138.96L51.2319 135.247L46.728 130.474L43.9131 124.64L42.7871 118.275V115.093L57.4248 107.137L64.7437 102.894H66.4326L66.9956 118.806H69.2476L69.8105 73.7231Z" fill="black"/>
    <path d="M63.0547 0H73.1885L79.3813 2.12153L84.4482 5.30382L89.5151 10.6076L92.3301 16.4418L92.8931 18.5634V25.9887L85.5742 30.2318L71.4995 38.1875H69.8105L69.2476 22.276H66.9956L66.4326 25.9887V58.342L65.8696 66.8281L63.0547 65.7674L48.98 58.342L42.7871 54.6293V25.4583L43.3501 18.5634L45.6021 12.7292L48.98 7.95573L52.9209 4.24306L60.8027 0.530382L63.0547 0Z" fill="black"/>
    <path d="M108.094 23.3368H114.85L122.168 25.4584L128.361 29.171L132.302 33.4141L135.117 38.7179L136.243 42.961V50.9167L133.991 57.8116L129.487 63.6458L123.294 67.8889L121.042 68.4193L111.472 63.1155L99.0859 56.2205V55.1597L107.531 50.9167L112.598 47.7344L112.035 45.6129L109.783 46.1432L99.6489 51.4471L86.1372 58.8724L71.4995 66.8281L69.8105 67.3585V42.4306L74.8774 39.2483L85.0112 33.9445L98.5229 26.5191L104.716 23.8672L108.094 23.3368Z" fill="black"/>
    <path d="M94.582 57.8116L101.338 60.9939L110.909 66.2978L125.546 74.2535L130.613 78.4965L134.554 84.3307L136.243 90.1649V98.1207L133.991 105.016L130.613 109.259L127.798 111.911L124.983 114.032L119.354 116.684L114.287 117.745H109.22L101.901 116.154L96.834 113.502V88.0434L103.027 91.2257L110.909 95.4688L112.598 94.9384L113.161 92.8169L110.346 91.7561L81.0703 75.8446L72.0625 71.0712V70.0104L87.8262 61.5243L94.582 57.8116Z" fill="black"/>
    <path d="M21.3936 23.3368H28.1494L35.4683 25.4584L39.4092 27.5799V52.5078L36.5942 51.4471L25.3345 45.6129L23.6455 45.0825L23.0825 47.204L28.7124 50.9167L41.6611 57.8116L55.1729 65.237L64.1807 70.0104L62.4917 71.6016L48.98 79.0269L41.0981 83.27L32.0903 78.4966L18.5786 71.0712L8.44482 65.237L3.94092 60.4636L1.12598 55.1597L0 51.4471V42.4306L2.25195 36.066L6.19287 30.7622L11.8228 26.5191L18.5786 23.8672L21.3936 23.3368Z" fill="black"/>
    <path d="M13.5117 72.6623L15.7637 73.1927L29.8384 80.6181L37.1572 84.8611L35.4683 86.4523L23.6455 92.8168V95.9991L31.5273 92.2865L65.3066 73.7231H66.4326V90.6953L65.8696 99.1814L52.9209 106.076L39.4092 113.502L32.6533 116.684L27.0234 117.745H22.5195L15.7637 116.154L10.1338 113.502L5.62988 109.789L1.68896 103.955L0 98.651V89.6345L2.25195 83.27L6.19287 77.9661L10.6968 74.2535L13.5117 72.6623Z" fill="black"/>
  </g>
</svg>'''
    
    # Save the combined SVG
    with open('icon_combined.svg', 'w') as f:
        f.write(svg_content)
    
    print("Created combined SVG with your Ritual logo")
    return svg_content

def main():
    print("Creating Ritual app icon with actual logo...")
    
    # Create the combined SVG
    create_icon_with_svg_overlay(1024)
    
    print("\n✓ Created icon_combined.svg")
    print("\nTo convert to PNG, you can:")
    print("1. Use online converter (e.g., cloudconvert.com)")
    print("2. Install librsvg: brew install librsvg")
    print("   Then run: rsvg-convert -w 1024 -h 1024 icon_combined.svg -o icon_1024.png")
    print("3. Open in browser and screenshot at 1024x1024")

if __name__ == '__main__':
    main()

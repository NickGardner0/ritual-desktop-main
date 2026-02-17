#!/usr/bin/env python3
"""
Generate macOS .iconset from a 1024x1024 PNG source.
Creates all required sizes for a macOS .icns file.
"""
from PIL import Image
import os
import shutil

def generate_iconset(source_png='icon_1024.png', iconset_name='Ritual.iconset'):
    """
    Generate all required icon sizes for macOS .iconset
    
    Required sizes for macOS:
    - icon_16x16.png
    - icon_16x16@2x.png (32x32)
    - icon_32x32.png
    - icon_32x32@2x.png (64x64)
    - icon_128x128.png
    - icon_128x128@2x.png (256x256)
    - icon_256x256.png
    - icon_256x256@2x.png (512x512)
    - icon_512x512.png
    - icon_512x512@2x.png (1024x1024)
    """
    
    # Create iconset directory
    if os.path.exists(iconset_name):
        shutil.rmtree(iconset_name)
    os.makedirs(iconset_name)
    
    # Load source image
    print(f"Loading {source_png}...")
    source_img = Image.open(source_png)
    
    # Define all required sizes
    sizes = [
        ('icon_16x16.png', 16),
        ('icon_16x16@2x.png', 32),
        ('icon_32x32.png', 32),
        ('icon_32x32@2x.png', 64),
        ('icon_128x128.png', 128),
        ('icon_128x128@2x.png', 256),
        ('icon_256x256.png', 256),
        ('icon_256x256@2x.png', 512),
        ('icon_512x512.png', 512),
        ('icon_512x512@2x.png', 1024),
    ]
    
    print(f"Generating icons in {iconset_name}/...")
    for filename, size in sizes:
        # Resize image with high-quality resampling
        resized = source_img.resize((size, size), Image.Resampling.LANCZOS)
        
        # Save to iconset directory
        output_path = os.path.join(iconset_name, filename)
        resized.save(output_path, 'PNG')
        print(f"  ✓ {filename} ({size}x{size})")
    
    print(f"\n✓ Generated all icons in {iconset_name}/")
    print(f"\nNext step: Run the following command to create the .icns file:")
    print(f"  iconutil -c icns {iconset_name}")

def main():
    generate_iconset()

if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
Convert SVG to PNG using cairosvg or alternative methods
"""
import subprocess
import sys
import os

def convert_svg_to_png_sips(svg_path, png_path, size=1024):
    """Convert SVG to PNG using macOS sips command"""
    try:
        # First convert to a temporary PDF, then to PNG
        pdf_path = svg_path.replace('.svg', '_temp.pdf')
        
        # Convert SVG to PDF using qlmanage
        subprocess.run([
            'qlmanage', '-t', '-s', str(size), '-o', os.path.dirname(svg_path), svg_path
        ], check=True, capture_output=True)
        
        # The output will be named differently
        temp_png = svg_path.replace('.svg', '.svg.png')
        
        if os.path.exists(temp_png):
            # Resize to exact dimensions if needed
            subprocess.run([
                'sips', '-z', str(size), str(size), temp_png, '--out', png_path
            ], check=True, capture_output=True)
            
            # Clean up temp file
            os.remove(temp_png)
            return True
        return False
    except Exception as e:
        print(f"sips method failed: {e}")
        return False

def convert_svg_to_png_cairosvg(svg_path, png_path, size=1024):
    """Convert SVG to PNG using cairosvg"""
    try:
        import cairosvg
        cairosvg.svg2png(
            url=svg_path,
            write_to=png_path,
            output_width=size,
            output_height=size
        )
        return True
    except ImportError:
        print("cairosvg not available, trying alternative method...")
        return False
    except Exception as e:
        print(f"cairosvg method failed: {e}")
        return False

def main():
    svg_path = 'icon.svg'
    png_path = 'icon_1024.png'
    size = 1024
    
    # Try cairosvg first
    if convert_svg_to_png_cairosvg(svg_path, png_path, size):
        print(f"✓ Created {png_path} using cairosvg")
        return
    
    # Try sips method
    if convert_svg_to_png_sips(svg_path, png_path, size):
        print(f"✓ Created {png_path} using sips")
        return
    
    print("❌ Failed to convert SVG to PNG. Please install cairosvg:")
    print("   pip3 install cairosvg")
    sys.exit(1)

if __name__ == '__main__':
    main()

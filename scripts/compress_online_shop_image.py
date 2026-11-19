"""Compress uploaded Online Shop images while retaining readable report evidence."""
import sys
from PIL import Image, ImageOps

source, output = sys.argv[1:3]
with Image.open(source) as image:
    image = ImageOps.exif_transpose(image).convert("RGB")
    image.thumbnail((1920, 1920), Image.Resampling.LANCZOS)
    image.save(output, "JPEG", quality=74, optimize=True, progressive=True)

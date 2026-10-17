"""Profile photos: stored as resized JPEGs in uploads/, which git ignores."""
import io
import os
import secrets

from PIL import Image, ImageOps, UnidentifiedImageError

import database

UPLOADS = os.path.join(database.APP_DIR, 'uploads')
MAX_SIDE = 800  # plenty for a profile photo, and keeps files around 100 KB


def save(data, member_id):
    """Decode, straighten, shrink and store an uploaded image. Re-encoding
    means whatever was uploaded, only a plain JPEG ever reaches the disk."""
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError):
        raise ValueError('That file is not an image this app can read (use JPG, PNG or WebP)')
    img = ImageOps.exif_transpose(img).convert('RGB')
    img.thumbnail((MAX_SIDE, MAX_SIDE))

    os.makedirs(UPLOADS, exist_ok=True)
    name = f'{member_id}-{secrets.token_hex(6)}.jpg'
    img.save(os.path.join(UPLOADS, name), 'JPEG', quality=85, optimize=True)
    return name


def remove(name):
    if not name or os.path.basename(name) != name:
        return
    try:
        os.remove(os.path.join(UPLOADS, name))
    except FileNotFoundError:
        pass

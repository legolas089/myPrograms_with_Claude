"""
LaTeX OCR Server — converts math formula images to LaTeX using pix2tex.
Run: python server.py
First run downloads the model (~300MB), subsequent runs are instant.
"""

import io
import base64
import sys

from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image

app = Flask(__name__)
CORS(app)

# Lazy-load model (heavy import)
model = None

def get_model():
    global model
    if model is None:
        print("Loading pix2tex model (first time may download weights)...")
        from pix2tex.cli import LatexOCR
        model = LatexOCR()
        print("Model loaded successfully!")
    return model


@app.route("/ocr", methods=["POST"])
def ocr():
    """Accept an image (base64 or file upload) and return LaTeX."""
    try:
        img = None

        # Check for base64 data
        data = request.get_json(silent=True)
        if data and "image" in data:
            # base64 encoded image (data URL or raw base64)
            b64 = data["image"]
            if "," in b64:
                b64 = b64.split(",", 1)[1]  # strip data:image/...;base64,
            img_bytes = base64.b64decode(b64)
            img = Image.open(io.BytesIO(img_bytes))

        # Check for file upload
        elif "file" in request.files:
            f = request.files["file"]
            img = Image.open(f.stream)

        if img is None:
            return jsonify({"error": "No image provided"}), 400

        # Convert to RGB if needed
        if img.mode != "RGB":
            img = img.convert("RGB")

        # Run OCR
        latex = get_model()(img)

        return jsonify({"latex": latex})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "model_loaded": model is not None})


if __name__ == "__main__":
    # Pre-load model on startup
    if "--lazy" not in sys.argv:
        get_model()

    print("OCR server running on http://localhost:5000")
    app.run(host="0.0.0.0", port=5000, debug=False)

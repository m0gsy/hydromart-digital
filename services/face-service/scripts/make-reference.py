"""OpenCV's own embeddings of the self-test fixtures: test/fixtures/reference.json.

The image build compares face-service's pipeline with these (src/selftest.ts). Re-run only when
the fixtures change, with opencv-python 4.10+/5.x in a venv, and the two pinned models:

  python -I make-reference.py <models_dir> <out_dir> test/fixtures/*.jpg
  cp <out_dir>/python-ref.json test/fixtures/reference.json

YuNet detects on the image scaled to longest side 320 (the same input as the Node pipeline),
the face row is mapped back to original pixels (pixel-centre convention), then
FaceRecognizerSF.alignCrop on the ORIGINAL image, feature, L2-normalise.
"""
import json
import math
import os
import sys

import cv2
import numpy as np


def main():
    models, out, images = sys.argv[1], sys.argv[2], sys.argv[3:]
    det = cv2.FaceDetectorYN.create(os.path.join(models, "face_detection_yunet_2023mar.onnx"), "", (320, 320), score_threshold=0.9)
    rec = cv2.FaceRecognizerSF.create(os.path.join(models, "face_recognition_sface_2021dec.onnx"), "")
    res = {}
    for path in images:
        name = os.path.basename(path)
        img = cv2.imread(path, cv2.IMREAD_COLOR)  # BGR, EXIF orientation applied
        h, w = img.shape[:2]
        k = 320 / max(w, h)
        w2, h2 = max(1, math.floor(w * k + 0.5)), max(1, math.floor(h * k + 0.5))  # = JS Math.round
        small = cv2.resize(img, (w2, h2), interpolation=cv2.INTER_AREA)
        det.setInputSize((w2, h2))
        _, faces = det.detect(small)
        entry = {"size": [w, h], "det_size": [w2, h2], "face_count": 0 if faces is None else len(faces), "face": None}
        if faces is not None and len(faces):
            f = faces[int(np.argmax(faces[:, 14]))].astype(np.float64)
            entry["landmarks_det"] = f[4:14].reshape(5, 2).tolist()
            sx, sy = w / w2, h / h2
            xs, ys = [0, 4, 6, 8, 10, 12], [1, 5, 7, 9, 11, 13]
            f[xs] = (f[xs] + 0.5) * sx - 0.5
            f[ys] = (f[ys] + 0.5) * sy - 0.5
            f[2] *= sx
            f[3] *= sy
            crop = rec.alignCrop(img, f.astype(np.float32).reshape(1, -1))
            feat = rec.feature(crop).reshape(-1).astype(np.float64)
            feat /= np.linalg.norm(feat)
            cv2.imwrite(os.path.join(out, os.path.splitext(name)[0] + "_py.png"), crop)
            entry["face"] = {
                "score": float(f[14]),
                "box": f[0:4].tolist(),
                "landmarks": f[4:14].reshape(5, 2).tolist(),
                "embedding": feat.tolist(),
            }
        res[name] = entry
    with open(os.path.join(out, "python-ref.json"), "w") as fh:
        json.dump({"opencv": cv2.__version__, "images": res}, fh)


if __name__ == "__main__":
    main()

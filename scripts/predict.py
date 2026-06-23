"""
predict.py — Motor de Visión por Computadora para Smart Parking (Faster R-CNN)
================================================================
Uso:
    python predict.py <ruta_imagen> [ruta_modelo]

Salida (stdout, JSON estricto):
    {"espacios": [{"id": "A1", "estado": "ocupado"}, ...]}

En error (stdout, JSON):
    {"error": "descripción"}  + sys.exit(1)
"""

import sys
import json
import os
import warnings

# ──────────────────────────────────────────────────────────────
# SECCIÓN 1: IMPORTACIONES (con mensajes de error descriptivos)
# ──────────────────────────────────────────────────────────────
try:
    # pyrefly: ignore [missing-import]
    import torch
    # pyrefly: ignore [missing-import]
    import torchvision
    # pyrefly: ignore [missing-import]
    from torchvision.models.detection.faster_rcnn import FastRCNNPredictor
    # pyrefly: ignore [missing-import]
    from torchvision.transforms import functional as F
except ImportError:
    print(json.dumps({"error": "Librería 'torch' o 'torchvision' no instalada. Ejecuta: pip install torch torchvision"}))
    sys.exit(1)

try:
    # pyrefly: ignore [missing-import]
    import cv2
except ImportError:
    print(json.dumps({"error": "Librería 'opencv-python' no instalada. Ejecuta: pip install opencv-python-headless"}))
    sys.exit(1)

try:
    # pyrefly: ignore [missing-import]
    from shapely.geometry import Point, Polygon
except ImportError:
    print(json.dumps({"error": "Librería 'shapely' no instalada. Ejecuta: pip install shapely"}))
    sys.exit(1)


# ──────────────────────────────────────────────────────────────
# SECCIÓN 2: MAPA DE ROIs (Regiones de Interés por espacio)
# ──────────────────────────────────────────────────────────────
PARKING_ROIS: dict[str, list[tuple[int, int]]] = {
    # ── MAPEO INVERSO: Cámara lado IZQUIERDO → App lado DERECHO (9 espacios) ──────────────
    "Derecha_1": [(146, 476), (1, 473), (1, 380), (160, 403)],
    "Derecha_2": [(160, 403), (1, 380), (18, 338), (180, 359)],
    "Derecha_3": [(180, 359), (18, 338), (69, 309), (185, 332)],
    "Derecha_4": [(185, 332), (69, 309), (111, 300), (204, 301)],
    "Derecha_5": [(204, 301), (111, 300), (115, 286), (217, 291)],
    "Derecha_6": [(217, 291), (115, 286), (138, 266), (226, 270)],
    "Derecha_7": [(226, 270), (138, 266), (155, 259), (231, 260)],
    "Derecha_8": [(231, 260), (155, 259), (176, 249), (242, 254)],
    "Derecha_9": [(242, 254), (176, 249), (195, 237), (247, 237)],

    # ── MAPEO INVERSO: Cámara lado DERECHO → App lado IZQUIERDO (10 espacios) ─────────────
    "Izquierda_1": [(600, 455), (637, 449), (636, 404), (577, 410)],
    "Izquierda_2": [(577, 410), (636, 404), (635, 317), (530, 356)],
    "Izquierda_3": [(530, 356), (635, 317), (621, 290), (512, 334)],
    "Izquierda_4": [(512, 334), (621, 290), (583, 289), (488, 323)],
    "Izquierda_5": [(488, 323), (583, 289), (554, 260), (453, 289)],
    "Izquierda_6": [(453, 289), (554, 260), (523, 241), (442, 268)],
    "Izquierda_7": [(442, 268), (523, 241), (499, 230), (426, 258)],
    "Izquierda_8": [(426, 258), (499, 230), (478, 221), (417, 244)],
    "Izquierda_9": [(417, 244), (478, 221), (463, 218), (409, 235)],
    "Izquierda_10": [(409, 235), (463, 218), (452, 209), (405, 222)],
}

# Pre-compilar polígonos Shapely
_COMPILED_ROIS: dict[str, Polygon] = {
    space_id: Polygon(coords)
    for space_id, coords in PARKING_ROIS.items()
}

# Clases del modelo (Asumiendo 0=Fondo/Background, 1=Vehículo)
VEHICLE_CLASS_IDS: set[int] = {1}

# Umbral mínimo de confianza
CONFIDENCE_THRESHOLD: float = 0.40


# ──────────────────────────────────────────────────────────────
# SECCIÓN 3: LÓGICA PRINCIPAL (FASTER R-CNN)
# ──────────────────────────────────────────────────────────────

def get_bottom_centroid(x1: float, y1: float, x2: float, y2: float) -> tuple[float, float]:
    cx = (x1 + x2) / 2.0
    cy = y2  # borde inferior
    return cx, cy

def load_faster_rcnn_model(model_path: str):
    """Carga el modelo Faster R-CNN con resnet50_fpn y 2 clases."""
    device = torch.device('cuda') if torch.cuda.is_available() else torch.device('cpu')
    
    # Silenciar warnings de torchvision sobre weights deprecados
    warnings.filterwarnings("ignore", category=UserWarning)

    # 1. Instanciar la arquitectura base
    model = torchvision.models.detection.fasterrcnn_resnet50_fpn(weights=None)
    
    # 2. Modificar el clasificador (box_predictor) para 2 clases (Background + Vehículo)
    in_features = model.roi_heads.box_predictor.cls_score.in_features
    model.roi_heads.box_predictor = FastRCNNPredictor(in_features, 2)
    
    # 3. Cargar pesos desde el archivo .pth
    try:
        checkpoint = torch.load(model_path, map_location=device)
        
        # Flexibilidad: soportar tanto si guardaron el state_dict como si guardaron el modelo entero
        if isinstance(checkpoint, torch.nn.Module):
            model = checkpoint
        elif isinstance(checkpoint, dict) and "state_dict" in checkpoint:
            model.load_state_dict(checkpoint["state_dict"])
        else:
            model.load_state_dict(checkpoint)
            
    except Exception as e:
        raise ValueError(f"No se pudo cargar el modelo PyTorch desde {model_path}: {e}")
        
    model.to(device)
    model.eval()  # Modo inferencia
    return model, device

def analyze_image(image_path: str, model_path: str) -> dict:
    """Ejecuta inferencia con Faster R-CNN y mapea detecciones a espacios."""
    # 1. Cargar modelo
    model, device = load_faster_rcnn_model(model_path)
    
    # 2. Cargar imagen con OpenCV y validar
    image = cv2.imread(image_path)
    if image is None:
        raise ValueError(f"No se pudo leer la imagen en la ruta: {image_path}")

    # 3. Preprocesamiento: Convertir BGR a RGB y luego a Tensor
    image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    img_tensor = F.to_tensor(image_rgb).unsqueeze(0).to(device)
    
    # 4. Inferencia
    with torch.no_grad():
        predictions = model(img_tensor)[0]
        
    vehicle_points: list[Point] = []
    
    # Extraer las detecciones (Tensores -> Numpy)
    boxes = predictions['boxes'].cpu().numpy()
    scores = predictions['scores'].cpu().numpy()
    labels = predictions['labels'].cpu().numpy()
    
    # 5. Filtrar por clase y umbral de confianza
    for i in range(len(boxes)):
        cls_id = int(labels[i])
        conf = float(scores[i])
        
        if cls_id not in VEHICLE_CLASS_IDS or conf < CONFIDENCE_THRESHOLD:
            continue
            
        x1, y1, x2, y2 = boxes[i].tolist()
        
        # --- DIBUJAR EN LA IMAGEN ---
        # Dibujar el rectángulo (verde oscuro)
        cv2.rectangle(image, (int(x1), int(y1)), (int(x2), int(y2)), (0, 150, 0), 2)
        # Dibujar la etiqueta (ej: car 0.98)
        label_text = f"car {conf:.2f}"
        cv2.putText(image, label_text, (int(x1), int(y1) - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 150, 0), 2)
        
        cx, cy = get_bottom_centroid(x1, y1, x2, y2)
        vehicle_points.append(Point(cx, cy))

    # Guardar la imagen con escritura atómica para evitar que la app
    # lea una imagen a medio escribir. Se escribe a un temporal y luego
    # se renombra (os.replace es atómico en Linux).
    output_path = os.path.join(os.path.dirname(image_path), 'latest.jpg')
    temp_path = output_path + '.tmp'
    cv2.imwrite(temp_path, image)
    os.replace(temp_path, output_path)

    # 6. Point-in-Polygon: determinar qué espacios están ocupados
    occupied_spaces: set[str] = set()

    for space_id, polygon in _COMPILED_ROIS.items():
        for point in vehicle_points:
            if polygon.contains(point):
                occupied_spaces.add(space_id)
                break

    # 7. Construir respuesta JSON
    espacios_resultado = [
        {
            "id":     space_id,
            "estado": "ocupado" if space_id in occupied_spaces else "disponible",
        }
        for space_id in PARKING_ROIS.keys()
    ]

    return {"espacios": espacios_resultado}


# ──────────────────────────────────────────────────────────────
# SECCIÓN 4: ENTRYPOINT
# ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Uso: python predict.py <ruta_imagen> [ruta_modelo]"}))
        sys.exit(1)

    _image_path = sys.argv[1]
    _model_path = sys.argv[2] if len(sys.argv) >= 3 else "faster_rcnn_estacionamiento_real_10epochs.pth"

    try:
        output = analyze_image(_image_path, _model_path)
        # ⚠️ CRÍTICO: Debe ser el ÚNICO print en el flujo de éxito
        print(json.dumps(output))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)

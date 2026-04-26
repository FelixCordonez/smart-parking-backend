import sys
import json
import time

def analyze_image(image_path):
    # Simulacion de carga de modelo YOLO y extraccion de caracteristicas
    # En la vida real, aqui irian imports como:
    # from ultralytics import YOLO
    # model = YOLO('yolov8n.pt')
    # results = model(image_path)
    
    # Simulando tiempo de procesamiento asincrono (inferencia)
    time.sleep(2)
    
    # Supongamos que el modelo detecta un vehiculo en el espacio 1
    # Devolveremos un JSON simple para que Node.js lo parsee
    result = {
        "espacio_id": 1,
        "ocupado": True,
        "confianza": 0.95,
        "mensaje": "Vehículo detectado correctamente"
    }
    
    # Imprimir estrictamente JSON a stdout
    print(json.dumps(result))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No se proporciono ruta de imagen"}))
        sys.exit(1)
        
    image_path = sys.argv[1]
    
    try:
        analyze_image(image_path)
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

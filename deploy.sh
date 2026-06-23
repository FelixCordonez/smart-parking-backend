#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Script de despliegue para Smart Parking ESPOCH (VPS Ubuntu)
# =============================================================================
#
# USO:
#   chmod +x deploy.sh          # sólo la primera vez
#   ./deploy.sh                 # despliegue normal
#   ./deploy.sh --skip-install  # saltar npm install (dependencias sin cambios)
#
# REQUISITOS EN EL VPS:
#   - Node.js >= 18
#   - PM2 instalado globalmente: npm install -g pm2
#   - El archivo serviceAccountKey.json en la raíz del proyecto
#   - Archivo .env con las variables de entorno (PORT, ESP32_API_KEY, etc.)
#
# =============================================================================

set -euo pipefail   # Abortar en cualquier error no manejado

# ── Colores para los logs ─────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

log_info()    { echo -e "${CYAN}[INFO]${RESET}  $*"; }
log_ok()      { echo -e "${GREEN}[OK]${RESET}    $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
log_error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }
log_section() { echo -e "\n${BOLD}══════════════════════════════════════${RESET}"; echo -e "${BOLD} $*${RESET}"; echo -e "${BOLD}══════════════════════════════════════${RESET}"; }

# ── Configuración ─────────────────────────────────────────────────────────────
PROJECT_DIR="/var/www/html/smartparkingespoch"   # Raíz del proyecto en el VPS
PM2_APP_NAME="smartparking-backend"              # Nombre del proceso en PM2
SKIP_INSTALL=false

# Procesar argumentos de línea de comandos
for arg in "$@"; do
  case $arg in
    --skip-install) SKIP_INSTALL=true ;;
    --help|-h)
      echo "Uso: $0 [--skip-install]"
      echo "  --skip-install  Omite 'npm install' (útil si solo cambió el código fuente)"
      exit 0
      ;;
    *)
      log_warn "Argumento desconocido: $arg (ignorado)"
      ;;
  esac
done

# ── Verificaciones previas ────────────────────────────────────────────────────
log_section "🔍 Verificando entorno"

if [ ! -d "$PROJECT_DIR" ]; then
  log_error "El directorio del proyecto no existe: $PROJECT_DIR"
  exit 1
fi

if ! command -v node &>/dev/null; then
  log_error "Node.js no está instalado. Instálalo con: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
  exit 1
fi

if ! command -v pm2 &>/dev/null; then
  log_error "PM2 no está instalado. Instálalo con: npm install -g pm2"
  exit 1
fi

if [ ! -f "$PROJECT_DIR/serviceAccountKey.json" ]; then
  log_warn "No se encontró serviceAccountKey.json en $PROJECT_DIR"
  log_warn "Si usas la variable FIREBASE_SERVICE_ACCOUNT en .env, puedes ignorar esto."
fi

log_ok "Node.js $(node --version) | PM2 $(pm2 --version)"

# ── Ir al directorio del proyecto ─────────────────────────────────────────────
cd "$PROJECT_DIR"
log_info "Directorio de trabajo: $(pwd)"

# ── Paso 1: Instalar dependencias ─────────────────────────────────────────────
log_section "📦 Paso 1 — Instalando dependencias"

if [ "$SKIP_INSTALL" = true ]; then
  log_warn "Instalación de dependencias omitida (--skip-install)."
else
  # --omit=dev instala sólo las dependencias de producción en el VPS.
  # Si necesitas ts-node-dev u otras devDependencies en el VPS, quita --omit=dev.
  npm install --omit=dev
  log_ok "Dependencias de producción instaladas."

  # Los tipos de TypeScript y el compilador sí son necesarios para 'npm run build'
  log_info "Instalando devDependencies necesarias para compilar..."
  npm install --save-dev typescript @types/node @types/express @types/cors @types/multer
  log_ok "DevDependencies del compilador instaladas."
fi

# ── Paso 2: Compilar TypeScript ───────────────────────────────────────────────
log_section "🔨 Paso 2 — Compilando TypeScript"

# Limpiar la carpeta dist/ antes de compilar para evitar artefactos obsoletos
if [ -d "dist" ]; then
  log_info "Limpiando dist/ anterior..."
  rm -rf dist
fi

npm run build

if [ ! -f "dist/server.js" ]; then
  log_error "La compilación falló: dist/server.js no existe."
  log_error "Revisa los errores de TypeScript arriba."
  exit 1
fi

log_ok "Compilación exitosa → dist/server.js"

# ── Paso 3: Reiniciar con PM2 ─────────────────────────────────────────────────
log_section "🚀 Paso 3 — Gestionando proceso en PM2"

if pm2 describe "$PM2_APP_NAME" &>/dev/null; then
  # ── El proceso ya existe: recargar en caliente (sin downtime) ──────────────
  log_info "Proceso '$PM2_APP_NAME' encontrado. Recargando..."
  pm2 reload "$PM2_APP_NAME" --update-env
  log_ok "Proceso recargado sin tiempo de inactividad."
else
  # ── Primera vez: arrancar con el script 'start' de package.json ────────────
  log_info "Proceso '$PM2_APP_NAME' no existe. Iniciando por primera vez..."
  pm2 start npm \
    --name "$PM2_APP_NAME" \
    --cwd  "$PROJECT_DIR"  \
    -- run start
  log_ok "Proceso iniciado."
fi

# Guardar la lista de procesos de PM2 para que sobreviva reinicios del VPS
pm2 save
log_ok "Estado de PM2 guardado (pm2 save)."

# ── Paso 4: Estado final ──────────────────────────────────────────────────────
log_section "📊 Estado del proceso"
pm2 show "$PM2_APP_NAME"

echo ""
log_ok "════════════════════════════════════════"
log_ok "  ✅ Despliegue completado exitosamente"
log_ok "════════════════════════════════════════"
echo ""
log_info "Comandos útiles post-despliegue:"
echo "  pm2 logs $PM2_APP_NAME          # Ver logs en tiempo real"
echo "  pm2 monit                       # Monitor de recursos"
echo "  pm2 restart $PM2_APP_NAME       # Reinicio duro (con downtime)"
echo ""

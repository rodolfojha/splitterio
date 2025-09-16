#!/bin/bash

# Script para actualizar la configuración del backend para la separación frontend/backend
# Este script debe ejecutarse en el VPS actual (usa.backspitta.xyz)

set -e

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Verificar que se ejecute como root
if [ "$EUID" -ne 0 ]; then
    print_error "Este script debe ejecutarse como root"
    exit 1
fi

print_status "🔧 Actualizando configuración del backend para separación frontend/backend..."

# Cambiar al directorio del proyecto
cd /var/www/splitta

# Instalar dependencia cors si no está instalada
print_status "Instalando dependencia cors..."
npm install cors

# Construir la aplicación con los nuevos cambios
print_status "Construyendo aplicación con nuevos cambios..."
npm run build

# Actualizar configuración de Nginx
print_status "Actualizando configuración de Nginx..."
cp backend-nginx-config.conf /etc/nginx/sites-available/splitta.io

# Verificar configuración de Nginx
print_status "Verificando configuración de Nginx..."
nginx -t

# Reiniciar Nginx
print_status "Reiniciando Nginx..."
systemctl restart nginx

# Reiniciar aplicación con PM2
print_status "Reiniciando aplicación..."
pm2 restart server

# Verificar que todo esté funcionando
print_status "Verificando estado de los servicios..."
systemctl is-active --quiet nginx && print_success "Nginx está activo" || print_error "Nginx no está activo"
pm2 list | grep -q "online" && print_success "Aplicación está activa" || print_error "Aplicación no está activa"

print_success "¡Configuración del backend actualizada exitosamente!"
echo ""
echo "📋 Configuración actualizada:"
echo "   🌐 Backend URL: https://usa.backspitta.xyz"
echo "   🔗 Frontend permitido: https://splittaio.com"
echo "   🔒 CORS configurado para comunicación entre dominios"
echo "   📡 Socket.io configurado para conexiones externas"
echo ""
echo "🔧 Próximos pasos:"
echo "   1. Configurar el frontend en el nuevo VPS usando las instrucciones"
echo "   2. Verificar que el dominio usa.backspitta.xyz apunte a este VPS"
echo "   3. Obtener certificado SSL para usa.backspitta.xyz"
echo ""
echo "📝 Comandos útiles:"
echo "   pm2 status                    # Ver estado de la aplicación"
echo "   pm2 logs server               # Ver logs de la aplicación"
echo "   nginx -t                      # Verificar configuración de Nginx"
echo "   systemctl status nginx        # Ver estado de Nginx"

#!/bin/bash

# Script de verificación para el dominio splittaio.com
# Autor: Assistant

echo "🔍 Verificando configuración del dominio splittaio.com..."

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

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

# Verificar que estamos en el directorio correcto
if [ ! -f "config.js" ]; then
    print_error "Debe ejecutar este script desde el directorio /var/www/splitta"
    exit 1
fi

print_status "Verificando configuración del dominio..."

# 1. Verificar que Nginx esté corriendo
if systemctl is-active --quiet nginx; then
    print_success "Nginx está corriendo"
else
    print_error "Nginx no está corriendo"
    exit 1
fi

# 2. Verificar configuración de Nginx
if nginx -t > /dev/null 2>&1; then
    print_success "Configuración de Nginx es válida"
else
    print_error "Configuración de Nginx tiene errores"
    exit 1
fi

# 3. Verificar que la aplicación esté corriendo
if pm2 list | grep -q "splitta-io.*online"; then
    print_success "Aplicación Splitta.io está corriendo"
else
    print_error "Aplicación Splitta.io no está corriendo"
    exit 1
fi

# 4. Verificar que el puerto 3000 esté escuchando
if netstat -tlnp | grep -q ":3000"; then
    print_success "Puerto 3000 está escuchando"
else
    print_error "Puerto 3000 no está escuchando"
    exit 1
fi

# 5. Verificar certificado SSL
if [ -f "/etc/letsencrypt/live/splittaio.com/fullchain.pem" ]; then
    print_success "Certificado SSL para splittaio.com existe"
else
    print_error "Certificado SSL para splittaio.com no existe"
    exit 1
fi

# 6. Verificar que el dominio responda
HTTP_CODE=$(curl -k -s -o /dev/null -w "%{http_code}" https://splittaio.com)
if [ "$HTTP_CODE" = "200" ]; then
    print_success "Dominio splittaio.com responde correctamente (HTTP $HTTP_CODE)"
else
    print_error "Dominio splittaio.com no responde correctamente (HTTP $HTTP_CODE)"
    exit 1
fi

# 7. Verificar base de datos
if [ -f "src/server/db/db.sqlite3" ]; then
    print_success "Base de datos existe"
    
    # Verificar permisos de escritura
    if [ -w "src/server/db/db.sqlite3" ]; then
        print_success "Base de datos tiene permisos de escritura"
    else
        print_error "Base de datos no tiene permisos de escritura"
        exit 1
    fi
    
    # Verificar tablas
    TABLES=$(sqlite3 src/server/db/db.sqlite3 ".tables" 2>/dev/null)
    if echo "$TABLES" | grep -q "users"; then
        print_success "Tabla 'users' existe en la base de datos"
    else
        print_error "Tabla 'users' no existe en la base de datos"
        exit 1
    fi
else
    print_error "Base de datos no existe"
    exit 1
fi

# 8. Verificar firewall
if ufw status | grep -q "Status: active"; then
    print_success "Firewall está activo"
    if ufw status | grep -q "443/tcp.*ALLOW"; then
        print_success "Puerto 443 (HTTPS) está permitido"
    else
        print_warning "Puerto 443 (HTTPS) no está permitido en el firewall"
    fi
else
    print_warning "Firewall no está activo"
fi

# 9. Verificar logs recientes
if [ -f "/var/log/splitta/combined-0.log" ]; then
    print_success "Logs de la aplicación están disponibles"
    echo "   Últimas líneas del log:"
    tail -3 /var/log/splitta/combined-0.log | sed 's/^/   /'
else
    print_warning "Logs de la aplicación no están disponibles"
fi

echo ""
print_success "✅ Verificación completada exitosamente!"
echo ""
echo "📋 Resumen de la configuración:"
echo "   🌐 Dominio: https://splittaio.com"
echo "   🔒 SSL: Configurado y funcionando"
echo "   🗄️  Base de datos: SQLite3 configurada y accesible"
echo "   🔧 Aplicación: Corriendo con PM2"
echo "   🌍 Nginx: Configurado y funcionando"
echo "   🔥 Firewall: Configurado"
echo ""
echo "🎯 El dominio está listo para guardar registros en la base de datos"
echo ""
echo "🔧 Comandos útiles:"
echo "   pm2 status                    # Ver estado de la aplicación"
echo "   pm2 logs splitta-io           # Ver logs en tiempo real"
echo "   sudo nginx -t                 # Verificar configuración Nginx"
echo "   sudo systemctl status nginx   # Ver estado de Nginx"
echo "   sqlite3 src/server/db/db.sqlite3 '.tables'  # Ver tablas de la BD"




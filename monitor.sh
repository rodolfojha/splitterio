#!/bin/bash

# Script de monitoreo para Splitta.io
# Autor: Assistant

echo "🔍 Monitoreo de Splitta.io"
echo "=========================="

# Colores
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Verificar PM2
echo ""
print_status "Verificando PM2..."
if pm2 status | grep -q "online"; then
    print_success "PM2 está funcionando correctamente"
    pm2 status
else
    print_error "PM2 no está funcionando"
fi

# Verificar Nginx
echo ""
print_status "Verificando Nginx..."
if systemctl is-active --quiet nginx; then
    print_success "Nginx está funcionando"
else
    print_error "Nginx no está funcionando"
fi

# Verificar puerto 3000
echo ""
print_status "Verificando puerto 3000..."
if netstat -tlnp | grep -q ":3000"; then
    print_success "Puerto 3000 está abierto"
else
    print_error "Puerto 3000 no está abierto"
fi

# Verificar SSL
echo ""
print_status "Verificando certificado SSL..."
if curl -s -I https://splittaio.com | grep -q "200 OK"; then
    print_success "SSL está funcionando correctamente"
else
    print_error "SSL no está funcionando"
fi

# Verificar dominio
echo ""
print_status "Verificando dominio..."
if curl -s -I https://splittaio.com | grep -q "200 OK"; then
    print_success "Dominio splittaio.com responde correctamente"
else
    print_error "Dominio splittaio.com no responde"
fi

# Verificar logs
echo ""
print_status "Últimas líneas de logs de PM2:"
pm2 logs --lines 5

echo ""
print_status "Información del sistema:"
echo "CPU: $(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1)%"
echo "Memoria: $(free -m | awk 'NR==2{printf "%.1f%%", $3*100/$2}')"
echo "Disco: $(df -h / | awk 'NR==2{print $5}')"

echo ""
print_success "Monitoreo completado!"

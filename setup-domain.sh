#!/bin/bash

# Script para configurar dominio y SSL - Splitta.io
# Autor: Assistant

echo "🌐 Configurando dominio y SSL para Splitta.io..."

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

# Verificar si estamos como root
if [ "$EUID" -ne 0 ]; then
    print_warning "Este script debe ejecutarse como root o con sudo"
    exit 1
fi

# Solicitar el dominio
read -p "Ingresa tu dominio (ej: splitta.io): " DOMAIN

if [ -z "$DOMAIN" ]; then
    print_error "Debes ingresar un dominio válido"
    exit 1
fi

print_status "Configurando dominio: $DOMAIN"

# Instalar Certbot
print_status "Instalando Certbot..."
apt install -y certbot python3-certbot-nginx

# Actualizar configuración de Nginx con el dominio
print_status "Actualizando configuración de Nginx..."
cat > /etc/nginx/sites-available/splitta.io << EOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }

    # Configuración para archivos estáticos
    location /img/ {
        alias /var/www/splitta/src/client/img/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location /audio/ {
        alias /var/www/splitta/src/client/audio/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location /css/ {
        alias /var/www/splitta/src/client/css/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location /js/ {
        alias /var/www/splitta/bin/client/js/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
EOF

# Reiniciar Nginx
print_status "Reiniciando Nginx..."
systemctl restart nginx

# Obtener certificado SSL
print_status "Obteniendo certificado SSL..."
certbot --nginx -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN

# Verificar renovación automática
print_status "Configurando renovación automática..."
crontab -l 2>/dev/null | { cat; echo "0 12 * * * /usr/bin/certbot renew --quiet"; } | crontab -

# Mostrar información final
print_success "¡Dominio y SSL configurados exitosamente!"
echo ""
echo "📋 Información del dominio:"
echo "   🌐 URL: https://$DOMAIN"
echo "   🔒 SSL: Configurado con Let's Encrypt"
echo "   🔄 Renovación: Automática (cada 12 horas)"
echo ""
echo "🔧 Comandos útiles:"
echo "   sudo certbot certificates    # Ver certificados"
echo "   sudo certbot renew          # Renovar manualmente"
echo "   sudo nginx -t               # Verificar configuración Nginx"
echo "   sudo systemctl reload nginx # Recargar Nginx"
echo ""
print_warning "Asegúrate de que tu dominio apunte a la IP: 128.254.207.105"

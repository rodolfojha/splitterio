#!/bin/bash

# Script para desplegar solo el frontend en un VPS separado
# Este script debe ejecutarse en el VPS del frontend (splittaio.com)

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

print_status "🚀 Iniciando despliegue del frontend de Splitta.io..."

# Actualizar sistema
print_status "Actualizando sistema..."
apt update && apt upgrade -y

# Instalar dependencias
print_status "Instalando dependencias..."
apt install -y nginx nodejs npm git curl wget

# Crear usuario para la aplicación
print_status "Creando usuario splitta-frontend..."
useradd -m -s /bin/bash splitta-frontend || true

# Crear directorio de la aplicación
print_status "Creando directorio de la aplicación..."
mkdir -p /var/www/splitta-frontend
chown splitta-frontend:splitta-frontend /var/www/splitta-frontend

# Descargar código fuente (solo frontend)
print_status "Descargando código fuente..."
cd /var/www/splitta-frontend
sudo -u splitta-frontend git clone https://github.com/rodolfojha/splitterio.git .

# Instalar dependencias de Node.js
print_status "Instalando dependencias de Node.js..."
sudo -u splitta-frontend npm install

# Construir frontend
print_status "Construyendo frontend..."
sudo -u splitta-frontend npm run build

# Configurar Nginx para servir archivos estáticos
print_status "Configurando Nginx..."
cat > /etc/nginx/sites-available/splitta-frontend << 'EOF'
server {
    listen 80;
    server_name splittaio.com www.splittaio.com;

    # Configuración para archivos estáticos del frontend
    root /var/www/splitta-frontend/bin/client;
    index index.html;

    # Configuración para archivos estáticos
    location / {
        try_files $uri $uri/ /index.html;
        
        # Headers de seguridad
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "no-referrer-when-downgrade" always;
        add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'" always;
    }

    # Configuración para archivos estáticos con cache
    location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Proxy para API calls al backend
    location /api/ {
        proxy_pass https://usa.backspitta.xyz;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Server $host;
    }

    # Proxy para Socket.io
    location /socket.io/ {
        proxy_pass https://usa.backspitta.xyz;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

# Habilitar el sitio
ln -sf /etc/nginx/sites-available/splitta-frontend /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Verificar configuración de Nginx
print_status "Verificando configuración de Nginx..."
nginx -t

# Reiniciar Nginx
print_status "Reiniciando Nginx..."
systemctl restart nginx
systemctl enable nginx

# Configurar firewall
print_status "Configurando firewall..."
ufw allow ssh
ufw allow 'Nginx Full'
ufw --force enable

# Instalar Certbot para SSL
print_status "Instalando Certbot para SSL..."
apt install -y certbot python3-certbot-nginx

# Obtener certificado SSL
print_status "Obteniendo certificado SSL..."
certbot --nginx -d splittaio.com -d www.splittaio.com --non-interactive --agree-tos --email admin@splittaio.com

# Configurar renovación automática
print_status "Configurando renovación automática..."
crontab -l 2>/dev/null | { cat; echo "0 12 * * * /usr/bin/certbot renew --quiet"; } | crontab -

# Mostrar información final
print_success "¡Frontend desplegado exitosamente!"
echo ""
echo "📋 Información del despliegue:"
echo "   🌐 URL Frontend: https://splittaio.com"
echo "   🔗 Backend: https://usa.backspitta.xyz"
echo "   📁 Directorio: /var/www/splitta-frontend"
echo "   👤 Usuario: splitta-frontend"
echo ""
echo "🔧 Comandos útiles:"
echo "   sudo systemctl status nginx    # Ver estado de Nginx"
echo "   sudo nginx -t                  # Verificar configuración"
echo "   sudo certbot certificates      # Ver certificados SSL"
echo ""
echo "📝 Para actualizar el frontend:"
echo "   cd /var/www/splitta-frontend"
echo "   sudo -u splitta-frontend git pull"
echo "   sudo -u splitta-frontend npm run build"
echo "   sudo systemctl reload nginx"

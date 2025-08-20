#!/bin/bash

# Script de despliegue para VPS - Splitta.io
# Autor: Assistant
# Fecha: $(date)

echo "🚀 Iniciando despliegue de Splitta.io en VPS..."

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Función para imprimir mensajes
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

# Actualizar el sistema
print_status "Actualizando el sistema..."
apt update && apt upgrade -y

# Instalar dependencias básicas
print_status "Instalando dependencias básicas..."
apt install -y curl wget git unzip software-properties-common apt-transport-https ca-certificates gnupg lsb-release

# Instalar Node.js (versión LTS)
print_status "Instalando Node.js..."
curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
apt install -y nodejs

# Verificar versiones
print_status "Verificando versiones instaladas..."
node --version
npm --version

# Instalar PM2 globalmente
print_status "Instalando PM2..."
npm install -g pm2

# Crear usuario para la aplicación
print_status "Creando usuario para la aplicación..."
useradd -m -s /bin/bash splitta
usermod -aG sudo splitta

# Crear directorio de la aplicación
print_status "Creando directorio de la aplicación..."
mkdir -p /var/www/splitta
chown splitta:splitta /var/www/splitta

# Cambiar al usuario splitta y ejecutar comandos
print_status "Cambiando al usuario splitta..."

# Crear script temporal para el usuario splitta
cat > /tmp/splitta_setup.sh << 'EOF'
#!/bin/bash

# Clonar el repositorio
echo "Clonando repositorio desde GitHub..."
cd /var/www/splitta
git clone https://github.com/rodolfojha/splitterio.git .

# Instalar dependencias
echo "Instalando dependencias del proyecto..."
npm install

# Construir el proyecto
echo "Construyendo el proyecto..."
npm run build

# Crear archivo de configuración PM2
echo "Creando configuración PM2..."
cat > ecosystem.config.js << 'PM2CONFIG'
module.exports = {
  apps: [{
    name: 'splitta-io',
    script: './bin/server/server.js',
    cwd: '/var/www/splitta',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: '/var/log/splitta/err.log',
    out_file: '/var/log/splitta/out.log',
    log_file: '/var/log/splitta/combined.log',
    time: true
  }]
};
PM2CONFIG

# Crear directorio de logs
sudo mkdir -p /var/log/splitta
sudo chown splitta:splitta /var/log/splitta

# Iniciar la aplicación con PM2
echo "Iniciando la aplicación con PM2..."
pm2 start ecosystem.config.js
pm2 save
pm2 startup
EOF

# Dar permisos y ejecutar el script
chmod +x /tmp/splitta_setup.sh
su - splitta -c "/tmp/splitta_setup.sh"

# Limpiar script temporal
rm /tmp/splitta_setup.sh

# Instalar Nginx
print_status "Instalando Nginx..."
apt install -y nginx

# Configurar Nginx
print_status "Configurando Nginx..."
cat > /etc/nginx/sites-available/splitta.io << 'NGINXCONFIG'
server {
    listen 80;
    server_name 128.254.207.105; # Cambiar por tu dominio cuando esté listo

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
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
NGINXCONFIG

# Habilitar el sitio
ln -sf /etc/nginx/sites-available/splitta.io /etc/nginx/sites-enabled/
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

# Mostrar información final
print_success "¡Despliegue completado!"
echo ""
echo "📋 Información del despliegue:"
echo "   🌐 URL: http://128.254.207.105"
echo "   📁 Directorio: /var/www/splitta"
echo "   👤 Usuario: splitta"
echo "   🔧 PM2: pm2 status"
echo "   📝 Logs: /var/log/splitta/"
echo ""
echo "🔧 Comandos útiles:"
echo "   pm2 status                    # Ver estado de la aplicación"
echo "   pm2 logs splitta-io          # Ver logs de la aplicación"
echo "   pm2 restart splitta-io       # Reiniciar la aplicación"
echo "   sudo systemctl status nginx  # Ver estado de Nginx"
echo ""
print_warning "Recuerda configurar tu dominio y SSL cuando esté listo"
